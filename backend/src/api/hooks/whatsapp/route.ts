import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
    WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_ACCESS_TOKEN
} from "../../../lib/constants";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
            console.log("WEBHOOK_VERIFIED");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        // Log incoming webhook for debugging
        // console.log("WhatsApp Webhook received:", JSON.stringify(body, null, 2));

        // Check if this is an event from a page subscription
        if (body.object) {
            // Iterate over each entry - there may be multiple if batched
            if (body.entry && body.entry.length > 0) {
                for (const entry of body.entry) {
                    // Iterate over each change - there may be multiple
                    if (entry.changes && entry.changes.length > 0) {
                        for (const change of entry.changes) {
                            const value = change.value;

                            // Check if it's a message
                            if (value.messages && value.messages.length > 0) {
                                const message = value.messages[0];
                                const from = message.from;

                                // Only reply to text messages or simple interactions to avoid loops or errors
                                // You might want to check message.type

                                console.log(`WhatsApp message received from ${from}`);

                                // Send auto-reply
                                await sendAutoReply(from);
                            }
                        }
                    }
                }
            }

            // Return a '200 OK' response to all requests
            res.status(200).send("EVENT_RECEIVED");
        } else {
            // Return a '404 Not Found' if event is not from a WhatsApp API
            res.sendStatus(404);
        }
    } catch (error) {
        console.error("Error processing WhatsApp webhook:", error);
        res.sendStatus(500);
    }
};

async function sendAutoReply(to: string) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        console.error("Missing WhatsApp credentials for auto-reply");
        return;
    }

    const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: "whatsapp",
        to: to,
        text: {
            body: "Este medio es solo para notificaciones; para preguntas, pedidos e inquietudes, contactar a +57 312 6742478."
        }
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("WhatsApp API error response:", errorData);
            throw new Error(`WhatsApp API error: ${response.statusText}`);
        }

        console.log(`Auto-reply sent successfully to ${to}`);
    } catch (error) {
        console.error("Failed to send auto-reply:", error);
    }
}
