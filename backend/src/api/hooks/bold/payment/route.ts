import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
const { validateBoldWebhookSignature } = require("../../../../modules/providers/bold-payment/utils/bold-hash.js");

// Tipos para el webhook de Bold
interface BoldWebhookBody {
  id: string;
  type: "SALE_APPROVED" | "SALE_REJECTED" | "VOID_APPROVED" | "VOID_REJECTED";
  subject: string;
  source: string;
  spec_version: string;
  time: number;
  data: {
    payment_id: string;
    merchant_id: string;
    created_at: string;
    amount: {
      currency: string;
      total: number;
      taxes: Array<{
        base: number;
        type: "VAT" | "CONSUMPTION";
        value: number;
      }>;
      tip: number;
    };
    user_id: string;
    metadata: {
      reference: string | null;
    };
    bold_code: string;
    payer_email: string;
    payment_method: string;
    card?: {
      capture_mode?: string;
      brand?: string;
      cardholder_name?: string;
      terminal_id?: string;
      masked_pan?: string;
      installments?: number;
      card_type?: string;
    };
    approval_number?: string;
    integration?: string;
  };
  datacontenttype: string;
}

/**
 * Valida la autenticidad del webhook de Bold
 * @param {string} rawBody - Cuerpo crudo de la petición
 * @param {string} signature - Firma recibida en el header
 * @returns {boolean} - true si es válido, false si no
 */
function validateBoldEvent(rawBody: string, signature: string): boolean {
  try {
    const secretKey = process.env.BOLD_SECRET_KEY;
    
    if (!secretKey) {
      console.error("❌ BOLD_SECRET_KEY no configurado");
      return false;
    }

    if (!signature) {
      console.error("❌ x-bold-signature no presente en el header");
      return false;
    }

    const isValid = validateBoldWebhookSignature(rawBody, signature, secretKey);
    return isValid;
  } catch (error) {
    console.error("Error validando evento de Bold:", error);
    return false;
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Parsear el cuerpo
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const webhookData = body as BoldWebhookBody;
    const { type, data } = webhookData;

    // --- 1️⃣ Validar estructura básica del payload ---
    if (!data?.metadata?.reference || !data?.payment_id || !type) {
      console.error("❌ Payload inválido de Bold:", { 
        hasReference: !!data?.metadata?.reference,
        hasPaymentId: !!data?.payment_id,
        hasType: !!type
      });
      return res.status(400).json({ error: "Payload inválido" });
    }

    const reference = data.metadata.reference;
    
    if (!reference) {
      console.warn("⚠️ Webhook de Bold sin reference");
      return res.status(400).json({ error: "Reference no proporcionado" });
    }

    // Extraer cart_id del reference
    // El reference viene en formato: timestamp_XXXXXXXX (reemplazando "cart_" por timestamp + "_")
    // Para reconstruir el cart_id: "cart_" + la parte después del primer "_"
    const cartId = "cart_" + reference.split("_")[1];
    console.log("📦 Bold Webhook - reference:", reference, "-> cartId:", cartId);

    const scope = req.scope;
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const paymentModule = scope.resolve(Modules.PAYMENT);

    // --- 2️⃣ Validar que la orden del reference exista (ANTES de responder 200) ---
    const { data: orderCarts } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    });

    if (!orderCarts?.length) {
      console.error(`❌ Orden no encontrada para cart_id: ${cartId} (reference recibido: ${reference})`);
      return res.status(400).json({ error: "Orden no encontrada para el reference proporcionado" });
    }

    // --- ✅ Orden existe, responder 200 y continuar procesamiento ---
    res.status(200).json({ status: "received" });

    // --- 3️⃣ Validar autenticidad del evento (después de confirmar que la orden existe) ---
    let rawBody: string;
    const originalReq = (req as any).raw || req;
    if (originalReq.rawBody) {
      rawBody = originalReq.rawBody.toString('utf-8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      rawBody = JSON.stringify(req.body);
    }
    
    const signature = req.headers['x-bold-signature'] as string;
    const isValidEvent = validateBoldEvent(rawBody, signature);
    if (!isValidEvent) {
      console.error("🚨 Evento Bold no autenticado - posible ataque");
      return; // Ya respondimos con 200, solo logueamos el error
    }

    // --- 4️⃣ Buscar payment collection asociada ---
    const orderId = orderCarts[0].order_id;

    const { data: collections } = await query.graph({
      entity: "order_payment_collection",
      fields: ["payment_collection_id"],
      filters: { order_id: orderId },
    });

    if (!collections?.length) {
      console.error(`❌ Payment Collection no encontrada para order_id: ${orderId}`);
      return;
    }

    const paymentCollectionId = collections[0].payment_collection_id;

    // --- 5️⃣ Manejar cada tipo de evento ---
    switch (type) {
      case "SALE_APPROVED":
        // Venta aprobada - capturar el pago
        try {
          const paymentCollection = await paymentModule.retrievePaymentCollection(
            paymentCollectionId,
            { relations: ["payments"] }
          );

          const payment = paymentCollection.payments.find(
            (p: any) => p.status === "authorized" || !p.captured_at
          );

          if (payment) {
            await paymentModule.capturePayment({ payment_id: payment.id });
            console.log(`✅ Pago capturado exitosamente para Bold payment_id: ${data.payment_id}`);
          } else {
            console.log(`ℹ️ Sin pagos pendientes para capturar (payment_id: ${data.payment_id})`);
          }
        } catch (error) {
          console.error(`❌ Error capturando pago de Bold (payment_id: ${data.payment_id}):`, error);
        }
        break;

      case "SALE_REJECTED":
        // Venta rechazada - cancelar el pago
        try {
          const paymentCollection = await paymentModule.retrievePaymentCollection(
            paymentCollectionId,
            { relations: ["payments"] }
          );

          const payment = paymentCollection.payments.find(
            (p: any) => p.status === "authorized" || p.status === "pending"
          );

          if (payment) {
            await paymentModule.cancelPayment(payment.id);
            console.log(`⚠️ Pago cancelado por rechazo de Bold (payment_id: ${data.payment_id})`);
          } else {
            console.log(`ℹ️ Sin pagos pendientes para cancelar (payment_id: ${data.payment_id})`);
          }
        } catch (error) {
          console.error(`❌ Error cancelando pago de Bold (payment_id: ${data.payment_id}):`, error);
        }
        break;

      case "VOID_APPROVED":
        // Anulación aprobada - cancelar el pago
        try {
          const paymentCollection = await paymentModule.retrievePaymentCollection(
            paymentCollectionId,
            { relations: ["payments"] }
          );

          const payment = paymentCollection.payments.find(
            (p: any) => p.status === "authorized" || p.captured_at
          );

          if (payment) {
            await paymentModule.cancelPayment(payment.id);
            console.log(`✅ Anulación procesada exitosamente para Bold payment_id: ${data.payment_id}`);
          } else {
            console.log(`ℹ️ Sin pagos para anular (payment_id: ${data.payment_id})`);
          }
        } catch (error) {
          console.error(`❌ Error procesando anulación de Bold (payment_id: ${data.payment_id}):`, error);
        }
        break;

      case "VOID_REJECTED":
        // Anulación rechazada - solo loguear
        console.log(`⚠️ Anulación rechazada por Bold (payment_id: ${data.payment_id})`);
        break;

      default:
        console.warn(`⚠️ Tipo de evento Bold no reconocido: ${type}`);
        break;
    }

  } catch (err) {
    console.error("❌ Error procesando evento Bold:", err);
    // Si aún no hemos respondido, enviar error 500
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error interno procesando el webhook" });
    }
  }
};

