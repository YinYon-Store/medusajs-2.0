import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { WOMPI_EVENTS_SECRET } from "../../../../lib/constants";
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
    const isValidEvent = await validateWompiEvent(body);
    if (!isValidEvent) {
      console.error("🚨 Evento Wompi no autenticado - posible ataque");
      return res.status(401).json({ error: "Evento no autenticado" });
    }


    // --- 3️⃣ Filtrar solo eventos relevantes ---
    if (event !== "transaction.updated") {
      return res.status(400).json({ message: "Evento ignorado" });
    }

    // --- 4️⃣ Validar estado de la transacción ---
    if (transaction.status !== "APPROVED") {
      return res.status(400).json({ message: "Estado no aprobado" });
    }

     // Extraer cart_id del reference
    // El reference puede venir en formato: cart_id_timestamp para identificar intentos únicos
    // O en formato antiguo: solo cart_id
    const reference = transaction.reference;
    const cartId = reference.includes('_') 
      ? reference.split('_')[0] 
      : reference;

    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const paymentModule = scope.resolve(Modules.PAYMENT);

    // --- 5️⃣ Buscar orden asociada al cart usando el cart_id extraído ---
    const { data: orderCarts } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    });
    if (!orderCarts?.length) return res.status(404).json({ error: "Orden no encontrada" });

    // --- 6️⃣ Buscar payment collection asociada ---
    const { data: collections } = await query.graph({
      entity: "order_payment_collection",
      fields: ["payment_collection_id"],
      filters: { order_id: orderCarts[0].order_id },
    });
    if (!collections?.length) return res.status(404).json({ error: "Payment Collection no encontrada" });

    // --- 7️⃣ Obtener la colección y capturar el pago ---
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


    return res.status(200).json({
      status: "success",
    });
  } catch (err) {
    console.error("❌ Error procesando evento Wompi:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};
