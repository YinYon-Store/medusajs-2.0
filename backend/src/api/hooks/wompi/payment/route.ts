import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { WOMPI_EVENTS_SECRET } from "../../../../lib/constants";
import { savePaymentResult, savePaymentError } from "../../../../lib/payment-buffer-service";
import { notifyPaymentCaptured } from "../../../../lib/notification-service";
const { generateWompiEventHash } = require("../../../../modules/providers/wompi-payment/utils/wompi-hash.js");

// Tipos para el webhook de Wompi
interface WompiWebhookBody {
  event: string;
  data: {
    transaction: {
      id: string;
      amount_in_cents: number;
      reference: string;
      customer_email: string;
      currency: string;
      payment_method_type: string;
      redirect_url: string;
      status: string;
      shipping_address: any;
      payment_link_id: string | null;
      payment_source_id: string | null;
    };
  };
  environment: string;
  signature: {
    properties: string[];
    checksum: string;
  };
  timestamp: number;
  sent_at: string;
}

/**
 * Valida la autenticidad del evento de Wompi
 * @param {object} eventData - Datos del evento completo
 * @returns {Promise<boolean>} - true si es válido, false si no
 */
async function validateWompiEvent(eventData: any): Promise<boolean> {
  try {
    const { data, signature, timestamp } = eventData;
    
    // Obtener el secreto de eventos desde constantes (respeta PAYMENT_ENV)
    const eventSecret = WOMPI_EVENTS_SECRET;
    if (!eventSecret) {
      console.error("❌ WOMPI_EVENTS_SECRET no configurado");
      return false;
    }

    // Extraer los valores de las propiedades especificadas en signature.properties
    const propertyValues: string[] = [];
    
    for (const property of signature.properties) {
      const value = property.split('.').reduce((obj: any, key: string) => obj?.[key], data);
      if (value !== undefined) {
        propertyValues.push(value.toString());
      } else {
        console.error(`❌ Propiedad no encontrada: ${property}`);
        return false;
      }
    }

    // Concatenar: propiedades + timestamp + secreto
    const concatenatedData = propertyValues.join('') + timestamp + eventSecret;
    
    // Generar hash SHA256 según documentación de Wompi
    const calculatedHash = await generateWompiEventHash(
      propertyValues[0], // transaction.id
      propertyValues[1], // transaction.status  
      propertyValues[2], // transaction.amount_in_cents
      timestamp,
      eventSecret
    );

    // Comparar con el checksum recibido
    const receivedChecksum = signature.checksum.toUpperCase();
    const isValid = calculatedHash.toUpperCase() === receivedChecksum;


    return isValid;
  } catch (error) {
    return false;
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const scope = req.scope;
    const body = req.body as WompiWebhookBody;
    const { event, data, environment, signature, timestamp } = body;
    const transaction = data?.transaction;

    // --- 1️⃣ Validar estructura básica ---
    if (!transaction?.reference || !transaction?.status || !signature?.checksum) {
      return res.status(400).json({ error: "Payload inválido" });
    }

    // --- 2️⃣ Validar autenticidad del evento ---
    // En modo desarrollo, permitir bypass de validación si el checksum es "TEST_CHECKSUM"
    const isTestMode = process.env.NODE_ENV === 'development' && signature?.checksum === 'TEST_CHECKSUM';
    
    if (!isTestMode) {
      const isValidEvent = await validateWompiEvent(body);
      if (!isValidEvent) {
        console.error("🚨 Evento Wompi no autenticado - posible ataque");
        return res.status(401).json({ error: "Evento no autenticado" });
      }
    } else {
      console.warn("⚠️  MODO PRUEBA: Validación de firma bypassed (solo en desarrollo)");
    }


    // --- 3️⃣ Filtrar solo eventos relevantes ---
    if (event !== "transaction.updated") {
      return res.status(400).json({ message: "Evento ignorado" });
    }

    // --- 4️⃣ Extraer cart_id del reference ---
    // El provider de Wompi envía el cart_id completo como reference
    // Formato: cart_01XXX (el cart_id completo de Medusa)
    // NOTA: El cart_id de Medusa tiene formato "cart_01XXX" que incluye un underscore
    // Por lo tanto, NO debemos hacer split('_')[0] porque solo obtendríamos "cart"
    const reference = transaction.reference;
    
    // Si el reference empieza con "cart_", es un cart_id completo de Medusa
    // Usarlo directamente. Solo si tiene formato especial (ej: timestamp_cart_01XXX) extraer
    let cartId: string;
    if (reference.startsWith('cart_')) {
      // Es un cart_id completo de Medusa, usarlo directamente
      cartId = reference;
    } else if (reference.includes('_cart_')) {
      // Formato con timestamp: timestamp_cart_01XXX
      // Extraer desde "cart_" en adelante
      const cartIndex = reference.indexOf('_cart_');
      cartId = reference.substring(cartIndex + 1); // +1 para incluir el "_" antes de "cart_"
    } else {
      // Usar reference directamente como fallback
      cartId = reference;
    }
    
    console.log(`📦 Wompi Webhook - reference: ${reference} -> cartId: ${cartId}`);

    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const paymentModule = scope.resolve(Modules.PAYMENT);
    const orderModule = scope.resolve(Modules.ORDER);
    const cartModule = scope.resolve(Modules.CART);

    // --- 5️⃣ Buscar orden asociada al cart usando el cart_id extraído ---
    const { data: orderCarts } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    });

    // --- 6️⃣ Si NO existe orden, guardar en buffer o metadata según el estado ---
    if (!orderCarts?.length) {
      console.log(`📦 Wompi Webhook - Orden no encontrada para cart_id: ${cartId}, guardando en buffer`);
      
      if (transaction.status === "APPROVED") {
        // Guardar resultado exitoso en buffer
        await savePaymentResult(cartId, {
          status: "approved",
          transaction_id: transaction.id,
          provider: "wompi",
          amount: transaction.amount_in_cents / 100,
          currency: transaction.currency,
          metadata: {
            reference: transaction.reference,
            payment_method_type: transaction.payment_method_type,
            customer_email: transaction.customer_email,
          },
        });
        console.log(`✅ Wompi Webhook - Resultado guardado en buffer para cart: ${cartId}`);
        return res.status(200).json({ 
          message: "Payment result saved, waiting for order creation",
          cart_id: cartId 
        });
      } else {
        // Guardar error en metadata del carrito
        await savePaymentError(
          cartId,
          {
            status: transaction.status.toLowerCase(),
            provider: "wompi",
            message: `Pago ${transaction.status} en Wompi`,
            transaction_id: transaction.id,
          },
          cartModule
        );
        console.log(`⚠️ Wompi Webhook - Error guardado en metadata del carrito: ${cartId}`);
        return res.status(200).json({ 
          message: "Payment error saved to cart",
          cart_id: cartId 
        });
      }
    }

    // --- 7️⃣ Validar estado de la transacción (solo si existe orden) ---
    if (transaction.status !== "APPROVED") {
      return res.status(400).json({ message: "Estado no aprobado" });
    }

    // --- 8️⃣ Buscar payment collection asociada ---
    const { data: collections } = await query.graph({
      entity: "order_payment_collection",
      fields: ["payment_collection_id"],
      filters: { order_id: orderCarts[0].order_id },
    });
    if (!collections?.length) return res.status(404).json({ error: "Payment Collection no encontrada" });

    // --- 9️⃣ Obtener la colección y capturar el pago ---
    const paymentCollection = await paymentModule.retrievePaymentCollection(
      collections[0].payment_collection_id,
      { relations: ["payments"] }
    );

    const payment = paymentCollection.payments.find(
      (p: any) => p.status === "authorized" || !p.captured_at
    );

    if (!payment) {
      return res.status(200).json({ message: "Sin pagos pendientes" });
    }

    await paymentModule.capturePayment({ payment_id: payment.id });
    
    console.log(`✅ Wompi Webhook - Pago capturado exitosamente para orden ${orderCarts[0].order_id}`);

    // Enviar notificación de pago capturado
    try {
      const order = await orderModule.retrieveOrder(orderCarts[0].order_id, {
        relations: ["shipping_address"]
      });
      
      if (order) {
        await notifyPaymentCaptured(
          order,
          "APPROVED",
          transaction.amount_in_cents / 100,
          transaction.id,
          "wompi",
          new Date().toISOString()
        );
        console.log(`✅ Wompi Webhook - Notificación de pago enviada`);
      }
    } catch (notifError) {
      console.error(`❌ Error enviando notificación de pago Wompi:`, notifError);
      // No fallar si solo falla la notificación
    }

    return res.status(200).json({
      status: "success",
    });
  } catch (err) {
    console.error("❌ Error procesando evento Wompi:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};
