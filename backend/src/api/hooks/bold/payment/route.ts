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
  // Responder inmediatamente con 200 (antes de 2 segundos)
  // Esto confirma que el evento fue recibido correctamente
  res.status(200).json({ status: "received" });

  try {
    // Intentar obtener el raw body de diferentes formas
    // En Medusa, el body puede venir parseado, así que intentamos obtenerlo del request original
    let rawBody: string;
    
    // Intentar obtener rawBody del request original (si está disponible)
    const originalReq = (req as any).raw || req;
    if (originalReq.rawBody) {
      rawBody = originalReq.rawBody.toString('utf-8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      // Si no tenemos el raw body, reconstruirlo desde el objeto parseado
      // Nota: Esto puede fallar si el formato JSON cambia (espacios, orden)
      rawBody = JSON.stringify(req.body);
    }
    
    const signature = req.headers['x-bold-signature'] as string;

    // --- 1️⃣ Validar autenticidad del evento ---
    const isValidEvent = validateBoldEvent(rawBody, signature);
    if (!isValidEvent) {
      console.error("🚨 Evento Bold no autenticado - posible ataque");
      return; // Ya respondimos con 200, solo logueamos el error
    }

    // Parsear el cuerpo
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const webhookData = body as BoldWebhookBody;
    const { type, data } = webhookData;

    // --- 2️⃣ Validar estructura básica ---
    if (!data?.metadata?.reference || !data?.payment_id || !type) {
      console.error("❌ Payload inválido de Bold:", { 
        hasReference: !!data?.metadata?.reference,
        hasPaymentId: !!data?.payment_id,
        hasType: !!type
      });
      return;
    }

    // --- 3️⃣ Procesar según el tipo de evento ---
    const reference = data.metadata.reference;
    
    if (!reference) {
      console.warn("⚠️ Webhook de Bold sin reference, ignorando");
      return;
    }

    // Extraer cart_id del reference
    // El reference puede venir en formato: cart_id_timestamp para identificar intentos únicos
    // O en formato antiguo: solo cart_id
    const cartId = reference.includes('_') 
      ? reference.split('_')[0] 
      : reference;

    const scope = req.scope;
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const paymentModule = scope.resolve(Modules.PAYMENT);

    // Buscar orden asociada al cart usando el cart_id extraído
    const { data: orderCarts } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    });

    if (!orderCarts?.length) {
      console.error(`❌ Orden no encontrada para cart_id: ${cartId} (reference recibido: ${reference})`);
      return;
    }

    const orderId = orderCarts[0].order_id;

    // Buscar payment collection asociada
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

    // --- 4️⃣ Manejar cada tipo de evento ---
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
    // Ya respondimos con 200, solo logueamos el error
  }
};

