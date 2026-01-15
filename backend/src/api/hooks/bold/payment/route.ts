import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { BOLD_SECRET_KEY } from "../../../../lib/constants";
import { notifyPaymentCaptured } from "../../../../lib/notification-service";
import { savePaymentResult, savePaymentError } from "../../../../lib/payment-buffer-service";
import { reportError, ErrorCategory, logWebhookEvent, logPaymentEvent, AnalyticsEvent } from "../../../../lib/firebase-service";
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
    const secretKey = BOLD_SECRET_KEY;
    
    if (!secretKey) {
      console.error("[Bold] Secret key not configured");
      return false;
    }

    if (!signature) {
      console.error("[Bold] Signature header missing");
      return false;
    }

    return validateBoldWebhookSignature(rawBody, signature, secretKey);
  } catch (error) {
    console.error("[Bold] Validation error:", error);
    return false;
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Parsear el cuerpo
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const webhookData = body as BoldWebhookBody;
    const { type, data } = webhookData;

    // Log webhook recibido
    await logWebhookEvent(AnalyticsEvent.WEBHOOK_RECEIVED, 'bold', {
      event_type: type,
      payment_id: data?.payment_id,
    });

    // --- 1️⃣ Validar estructura básica del payload ---
    if (!data?.metadata?.reference || !data?.payment_id || !type) {
      console.error("[Bold] Invalid payload");
      
      await reportError(
        new Error("Bold webhook payload inválido"),
        ErrorCategory.WEBHOOK,
        {
          provider: 'bold',
          hasReference: !!data?.metadata?.reference,
          hasPaymentId: !!data?.payment_id,
          hasType: !!type,
        }
      );
      
      await logWebhookEvent(AnalyticsEvent.WEBHOOK_VALIDATION_FAILED, 'bold', {
        reason: 'invalid_payload',
      });
      
      return res.status(400).json({ error: "Payload inválido" });
    }

    const reference = data.metadata.reference;
    
    if (!reference) {
      console.warn("[Bold] Missing reference");
      return res.status(400).json({ error: "Reference no proporcionado" });
    }

    const cartId = "cart_" + reference.split("_")[1];

    const scope = req.scope;
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const paymentModule = scope.resolve(Modules.PAYMENT);
    const orderModule = scope.resolve(Modules.ORDER);
    const cartModule = scope.resolve(Modules.CART);

    // --- 2️⃣ Buscar orden asociada al cart_id ---
    const { data: orderCarts } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    });

    // --- 3️⃣ Si NO existe orden, guardar en buffer o metadata según el tipo de evento ---
    if (!orderCarts?.length) {
      
      if (type === "SALE_APPROVED") {
        // Guardar resultado exitoso en buffer
        await savePaymentResult(cartId, {
          status: "approved",
          transaction_id: data.payment_id,
          provider: "bold",
          amount: data.amount?.total || 0,
          currency: data.amount?.currency || "COP",
          metadata: {
            reference: reference,
            bold_code: data.bold_code,
            payer_email: data.payer_email,
            payment_method: data.payment_method,
            card: data.card,
          },
        });
        return res.status(200).json({ 
          status: "received",
          message: "Payment result saved, waiting for order creation",
          cart_id: cartId 
        });
      } else {
        // Guardar error en metadata del carrito para eventos rechazados
        await savePaymentError(
          cartId,
          {
            status: type.toLowerCase(),
            provider: "bold",
            message: `Pago ${type} en Bold`,
            transaction_id: data.payment_id,
          },
          cartModule
        );
        return res.status(200).json({ 
          status: "received",
          message: "Payment error saved to cart",
          cart_id: cartId 
        });
      }
    }

    // --- ✅ Orden existe, responder 200 y continuar procesamiento ---
    res.status(200).json({ status: "received" });

    // --- 5️⃣ Obtener orderId antes de validar autenticidad ---
    const orderId = orderCarts[0].order_id;

    // --- 4️⃣ Validar autenticidad del evento (después de confirmar que la orden existe) ---
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
      console.error("[Bold] Unauthenticated event - possible attack");
      
      await reportError(
        new Error("Bold webhook no autenticado - posible ataque"),
        ErrorCategory.AUTHENTICATION,
        {
          provider: 'bold',
          payment_id: data?.payment_id,
          order_id: orderId,
        }
      );
      
      await logWebhookEvent(AnalyticsEvent.WEBHOOK_VALIDATION_FAILED, 'bold', {
        reason: 'authentication_failed',
        order_id: orderId,
      });
      
      return; // Ya respondimos con 200, solo logueamos el error
    }

    // --- 6️⃣ Buscar payment collection asociada ---

    const { data: collections } = await query.graph({
      entity: "order_payment_collection",
      fields: ["payment_collection_id"],
      filters: { order_id: orderId },
    });

    if (!collections?.length) {
      console.error(`[Bold] Payment collection not found: ${orderId}`);
      return;
    }

    const paymentCollectionId = collections[0].payment_collection_id;

    // Get order for notifications
    let order;
    try {
      order = await orderModule.retrieveOrder(orderId, {
        relations: ["shipping_address"]
      });
    } catch (error) {
      console.warn(`[Bold] Could not retrieve order for notifications: ${orderId}`);
    }

    // --- 6️⃣ Manejar cada tipo de evento ---
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
            console.log(`[Bold] Payment captured: ${data.payment_id}`);
            
            // Log evento de pago capturado
            await logPaymentEvent(
              AnalyticsEvent.PAYMENT_CAPTURED,
              'bold',
              data.amount?.total || 0,
              data.amount?.currency || 'COP',
              {
                payment_id: data.payment_id,
                order_id: orderId,
                bold_code: data.bold_code,
              }
            );
          } else {
          }
        } catch (error) {
          console.error(`[Bold] Error capturing payment ${data.payment_id}:`, error);
          
          await reportError(
            error instanceof Error ? error : new Error(String(error)),
            ErrorCategory.PAYMENT,
            {
              provider: 'bold',
              payment_id: data.payment_id,
              order_id: orderId,
              action: 'capture_payment',
            }
          );
        }

        // Send notification
        if (order) {
          try {
            const amount = data.amount?.total || 0;
            const reference = data.metadata?.reference || data.payment_id;
            const time = data.created_at || new Date(webhookData.time * 1000).toISOString();
            await notifyPaymentCaptured(order, type, amount, reference, 'bold', time);
            
            await logWebhookEvent(AnalyticsEvent.WEBHOOK_PROCESSED, 'bold', {
              event_type: type,
              order_id: orderId,
              payment_id: data.payment_id,
            });
          } catch (error) {
            console.error(`❌ Error sending payment notification:`, error);
            
            await reportError(
              error instanceof Error ? error : new Error(String(error)),
              ErrorCategory.NOTIFICATION,
              {
                provider: 'bold',
                order_id: orderId,
                payment_id: data.payment_id,
              }
            );
          }
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
            
            // Log evento de pago rechazado
            await logPaymentEvent(
              AnalyticsEvent.PAYMENT_REJECTED,
              'bold',
              data.amount?.total || 0,
              data.amount?.currency || 'COP',
              {
                payment_id: data.payment_id,
                order_id: orderId,
              }
            );
          } else {
          }
        } catch (error) {
          console.error(`[Bold] Error canceling payment ${data.payment_id}:`, error);
          
          await reportError(
            error instanceof Error ? error : new Error(String(error)),
            ErrorCategory.PAYMENT,
            {
              provider: 'bold',
              payment_id: data.payment_id,
              order_id: orderId,
              action: 'cancel_payment',
            }
          );
        }

        // Send notification
        if (order) {
          try {
            const amount = data.amount?.total || 0;
            const reference = data.metadata?.reference || data.payment_id;
            const time = data.created_at || new Date(webhookData.time * 1000).toISOString();
            await notifyPaymentCaptured(order, type, amount, reference, 'bold', time);
          } catch (error) {
            console.error(`❌ Error sending payment notification:`, error);
            
            await reportError(
              error instanceof Error ? error : new Error(String(error)),
              ErrorCategory.NOTIFICATION,
              {
                provider: 'bold',
                order_id: orderId,
                payment_id: data.payment_id,
              }
            );
          }
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
          }
        } catch (error) {
          console.error(`[Bold] Error processing void ${data.payment_id}:`, error);
        }
        break;

      case "VOID_REJECTED":
        break;

      default:
        console.warn(`[Bold] Unknown event type: ${type}`);
        break;
    }

  } catch (err) {
    console.error("[Bold] Error processing event:", err);
    
    await reportError(
      err instanceof Error ? err : new Error(String(err)),
      ErrorCategory.WEBHOOK,
      {
        provider: 'bold',
        endpoint: req.url,
        method: req.method,
      }
    );
    
    await logWebhookEvent(AnalyticsEvent.WEBHOOK_FAILED, 'bold', {
      error: err instanceof Error ? err.message : String(err),
    });
    
    // Si aún no hemos respondido, enviar error 500
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error interno procesando el webhook" });
    }
  }
};

