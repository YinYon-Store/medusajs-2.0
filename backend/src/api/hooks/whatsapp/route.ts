import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import twilio from "twilio";
import {
    WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_ACCESS_TOKEN,
    TWILIO_AUTH_TOKEN,
    TWILIO_WEBHOOK_BASE_URL,
} from "../../../lib/constants";

// ---------------------------------------------------------------------------
// GET: Verificación de webhook de Meta (legacy). Twilio no usa GET.
// ---------------------------------------------------------------------------
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
            console.log("WEBHOOK_VERIFIED (Meta)");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

// ---------------------------------------------------------------------------
// POST: Webhooks de mensajes. Origen: Twilio (auth por firma) o Meta (legacy).
// ---------------------------------------------------------------------------
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const twilioSignature = (req.headers["x-twilio-signature"] ?? req.headers["X-Twilio-Signature"]) as string | undefined;

    if (twilioSignature && TWILIO_AUTH_TOKEN && TWILIO_WEBHOOK_BASE_URL) {
        return handleTwilioWebhook(req, res, twilioSignature);
    }

    return handleMetaWebhook(req, res);
};

/**
 * Webhook desde Twilio: validación por X-Twilio-Signature y body form-urlencoded.
 */
async function handleTwilioWebhook(
    req: MedusaRequest,
    res: MedusaResponse,
    twilioSignature: string
) {
    // Twilio firma usando la URL exacta configurada en la consola (sin query salvo bodySHA256 en JSON)
    const webhookUrl = TWILIO_WEBHOOK_BASE_URL!.replace(/\/$/, "");

    let params: Record<string, string>;
    if (typeof req.body === "string") {
        params = parseFormUrlEncoded(req.body);
    } else if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
        params = req.body as Record<string, string>;
    } else {
        console.error("WhatsApp (Twilio): body vacío o inválido");
        res.sendStatus(400);
        return;
    }

    const isValid = twilio.validateRequest(
        TWILIO_AUTH_TOKEN!,
        twilioSignature,
        webhookUrl,
        params
    );

    if (!isValid) {
        console.error("WhatsApp (Twilio): firma inválida - rechazando webhook");
        res.sendStatus(403);
        return;
    }

    try {
        const from = params.From || "";   // ej. "whatsapp:+573001234567"
        const body = params.Body || "";
        const messageSid = params.MessageSid || "";

        console.log(`WhatsApp (Twilio) message received from ${from}, sid: ${messageSid}`);

        // Aquí puedes enviar auto-respuesta vía Twilio si lo necesitas
        // await sendTwilioAutoReply(from);

        res.status(200).contentType("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
    } catch (error) {
        console.error("Error processing Twilio WhatsApp webhook:", error);
        res.sendStatus(500);
    }
}

/**
 * Webhook desde Meta (Cloud API): body JSON con object / entry / changes.
 */
async function handleMetaWebhook(req: MedusaRequest, res: MedusaResponse) {
    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

        if (body.object) {
            if (body.entry && body.entry.length > 0) {
                for (const entry of body.entry) {
                    if (entry.changes && entry.changes.length > 0) {
                        for (const change of entry.changes) {
                            const value = change.value;
                            if (value.messages && value.messages.length > 0) {
                                const message = value.messages[0];
                                const from = message.from;
                                console.log(`WhatsApp (Meta) message received from ${from}`);
                                await sendMetaAutoReply(from);
                            }
                        }
                    }
                }
            }
            res.status(200).send("EVENT_RECEIVED");
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error("Error processing Meta WhatsApp webhook:", error);
        res.sendStatus(500);
    }
}

function parseFormUrlEncoded(raw: string): Record<string, string> {
    const params: Record<string, string> = {};
    const searchParams = new URLSearchParams(raw);
    searchParams.forEach((value, key) => {
        params[key] = value;
    });
    return params;
}

async function sendMetaAutoReply(to: string) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        console.error("Missing WhatsApp (Meta) credentials for auto-reply");
        return;
    }

    const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        to: to,
        text: {
            body: "Este medio es solo para notificaciones; para preguntas, pedidos e inquietudes, contactar a +57 312 6742478.",
        },
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("WhatsApp (Meta) API error:", errorData);
            return;
        }
        console.log(`Meta auto-reply sent to ${to}`);
    } catch (error) {
        console.error("Failed to send Meta auto-reply:", error);
    }
}
