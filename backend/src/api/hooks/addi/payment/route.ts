import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { ADDI_CALLBACK_USERNAME, ADDI_CALLBACK_PASSWORD } from "../../../../lib/constants";
import { notifyPaymentCaptured } from "../../../../lib/notification-service";

// Tipos para el webhook de ADDI
interface AddiWebhookBody {
    orderId: string;        // En realidad es el cartId que enviamos
    applicationId: string;  // ID de la aplicación de crédito en ADDI
    approvedAmount: string; // Monto aprobado (0 si no es APPROVED)
    currency: string;       // COP
    status: "APPROVED" | "PENDING" | "REJECTED" | "ABANDONED" | "DECLINED" | "INTERNAL_ERROR";
    statusTimestamp: string; // Unix timestamp
}

/**
 * Valida la autenticación básica HTTP
 * ADDI envía las credenciales en el header Authorization como Basic base64(username:password)
 */
function validateBasicAuth(authHeader: string | undefined): boolean {
    // Verificar que las credenciales estén configuradas
    if (!ADDI_CALLBACK_PASSWORD) {
        console.error("❌ ADDI Webhook - ADDI_CALLBACK_PASSWORD no configurado");
        return false;
    }

    if (!authHeader) {
        console.error("❌ ADDI Webhook - No Authorization header presente");
        return false;
    }

    // El header debe ser "Basic base64(username:password)"
    if (!authHeader.startsWith("Basic ")) {
        console.error("❌ ADDI Webhook - Authorization header no es Basic");
        return false;
    }

    try {
        const base64Credentials = authHeader.slice(6); // Remover "Basic "
        const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
        const [username, password] = credentials.split(":");

        const isValid = username === ADDI_CALLBACK_USERNAME && password === ADDI_CALLBACK_PASSWORD;
        
        if (!isValid) {
            console.error("❌ ADDI Webhook - Credenciales inválidas");
        }

        return isValid;
    } catch (error) {
        console.error("❌ ADDI Webhook - Error decodificando credenciales:", error);
        return false;
    }
}

/**
 * Mapea el status de ADDI a un mensaje legible para metadata
 */
function getStatusMessage(status: AddiWebhookBody["status"]): string {
    const messages: Record<AddiWebhookBody["status"], string> = {
        APPROVED: "Crédito ADDI aprobado",
        PENDING: "Crédito ADDI en proceso de validación",
        REJECTED: "Crédito ADDI rechazado - Cliente no aprobado",
        ABANDONED: "Crédito ADDI abandonado - Tiempo límite excedido",
        DECLINED: "Crédito ADDI declinado por el cliente",
        INTERNAL_ERROR: "Error interno en ADDI - Seleccionar otro método de pago"
    };
    return messages[status] || `Estado ADDI desconocido: ${status}`;
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    console.log("📥 ADDI Webhook - Recibiendo callback...");

    try {
        // --- 1️⃣ Validar autenticación básica ---
        const authHeader = req.headers.authorization as string | undefined;
        if (!validateBasicAuth(authHeader)) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        // --- 2️⃣ Parsear y validar el body ---
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        const webhookData = body as AddiWebhookBody;

        console.log("📦 ADDI Webhook - Payload recibido:", {
            orderId: webhookData.orderId,
            applicationId: webhookData.applicationId,
            status: webhookData.status,
            approvedAmount: webhookData.approvedAmount,
            currency: webhookData.currency
        });

        // Validar campos requeridos
        if (!webhookData.orderId || !webhookData.applicationId || !webhookData.status) {
            console.error("❌ ADDI Webhook - Payload inválido:", {
                hasOrderId: !!webhookData.orderId,
                hasApplicationId: !!webhookData.applicationId,
                hasStatus: !!webhookData.status
            });
            return res.status(400).json({ error: "Payload inválido - campos requeridos faltantes" });
        }

        // El orderId de ADDI es realmente el cartId que enviamos
        const cartId = webhookData.orderId;

        const scope = req.scope;
        const query = scope.resolve(ContainerRegistrationKeys.QUERY);
        const paymentModule = scope.resolve(Modules.PAYMENT);
        const orderModule = scope.resolve(Modules.ORDER);
        const cartModule = scope.resolve(Modules.CART);

        // --- 3️⃣ Verificar que el carrito exista ---
        let cart;
        try {
            cart = await cartModule.retrieveCart(cartId);
        } catch (error) {
            console.error(`❌ ADDI Webhook - Carrito no encontrado: ${cartId}`);
            return res.status(400).json({ error: `Carrito no encontrado: ${cartId}` });
        }

        if (!cart) {
            console.error(`❌ ADDI Webhook - Carrito no encontrado: ${cartId}`);
            return res.status(400).json({ error: `Carrito no encontrado: ${cartId}` });
        }

        console.log(`✅ ADDI Webhook - Carrito encontrado: ${cartId}`);

        // --- 4️⃣ Buscar la orden asociada al carrito ---
        const { data: orderCarts } = await query.graph({
            entity: "order_cart",
            fields: ["order_id"],
            filters: { cart_id: cartId },
        });

        if (!orderCarts?.length) {
            console.error(`❌ ADDI Webhook - Orden no encontrada para cart_id: ${cartId}`);
            return res.status(400).json({ error: `Orden no encontrada para el carrito: ${cartId}` });
        }

        const orderId = orderCarts[0].order_id;
        console.log(`✅ ADDI Webhook - Orden encontrada: ${orderId}`);

        // --- 5️⃣ Manejar estado PENDING con error 402 ---
        if (webhookData.status === "PENDING") {
            console.log(`⏳ ADDI Webhook - Estado PENDING, retornando 402`);
            return res.status(402).json({
                ...webhookData,
                message: "Pago pendiente de validación"
            });
        }

        // --- 6️⃣ Buscar payment collection asociada ---
        const { data: collections } = await query.graph({
            entity: "order_payment_collection",
            fields: ["payment_collection_id"],
            filters: { order_id: orderId },
        });

        if (!collections?.length) {
            console.error(`❌ ADDI Webhook - Payment Collection no encontrada para order_id: ${orderId}`);
            // Aún así respondemos 200 con el body para no causar reintentos innecesarios
            return res.status(200).json(webhookData);
        }

        const paymentCollectionId = collections[0].payment_collection_id;

        // Get order for notifications
        let order;
        try {
            order = await orderModule.retrieveOrder(orderId, {
                relations: ["shipping_address"]
            });
        } catch (error) {
            console.warn(`⚠️ Could not retrieve order ${orderId} for notifications:`, error);
        }

        // --- 7️⃣ Procesar según el status ---
        switch (webhookData.status) {
            case "APPROVED":
                // Capturar el pago
                try {
                    const paymentCollection = await paymentModule.retrievePaymentCollection(
                        paymentCollectionId,
                        { relations: ["payments"] }
                    );

                    const payment = paymentCollection.payments?.find(
                        (p: any) => p.status === "authorized" || !p.captured_at
                    );

                    if (payment) {
                        await paymentModule.capturePayment({ payment_id: payment.id });
                        console.log(`✅ ADDI Webhook - Pago capturado exitosamente`);
                        console.log(`   Application ID: ${webhookData.applicationId}`);
                        console.log(`   Monto aprobado: ${webhookData.approvedAmount} ${webhookData.currency}`);
                    } else {
                        console.log(`ℹ️ ADDI Webhook - Sin pagos pendientes para capturar`);
                    }

                    // Actualizar metadata de la orden con info de ADDI
                    try {
                        await orderModule.updateOrders([{
                            id: orderId,
                            metadata: {
                                addi_status: "APPROVED",
                                addi_application_id: webhookData.applicationId,
                                addi_approved_amount: webhookData.approvedAmount,
                                addi_status_timestamp: webhookData.statusTimestamp,
                                addi_status_message: getStatusMessage("APPROVED")
                            }
                        }]);
                    } catch (metaError) {
                        console.warn(`⚠️ ADDI Webhook - Error actualizando metadata:`, metaError);
                    }
                } catch (error) {
                    console.error(`❌ ADDI Webhook - Error capturando pago:`, error);
                }

                // Send notification
                if (order) {
                    try {
                        const amount = parseFloat(webhookData.approvedAmount) || 0;
                        const reference = webhookData.applicationId;
                        const time = new Date(parseInt(webhookData.statusTimestamp) * 1000).toISOString();
                        await notifyPaymentCaptured(order, "APPROVED", amount, reference, 'addi', time);
                    } catch (error) {
                        console.error(`❌ Error sending payment notification:`, error);
                    }
                }
                break;

            case "REJECTED":
            case "ABANDONED":
            case "DECLINED":
            case "INTERNAL_ERROR":
                // No capturar el pago, solo actualizar metadata
                try {
                    await orderModule.updateOrders([{
                        id: orderId,
                        metadata: {
                            addi_status: webhookData.status,
                            addi_application_id: webhookData.applicationId,
                            addi_status_timestamp: webhookData.statusTimestamp,
                            addi_status_message: getStatusMessage(webhookData.status)
                        }
                    }]);
                    console.log(`⚠️ ADDI Webhook - Orden actualizada con estado: ${webhookData.status}`);
                    console.log(`   Mensaje: ${getStatusMessage(webhookData.status)}`);
                } catch (error) {
                    console.error(`❌ ADDI Webhook - Error actualizando metadata de orden:`, error);
                }

                // Send notification
                if (order) {
                    try {
                        const amount = parseFloat(webhookData.approvedAmount) || 0;
                        const reference = webhookData.applicationId;
                        const time = new Date(parseInt(webhookData.statusTimestamp) * 1000).toISOString();
                        await notifyPaymentCaptured(order, webhookData.status, amount, reference, 'addi', time);
                    } catch (error) {
                        console.error(`❌ Error sending payment notification:`, error);
                    }
                }
                break;

            default:
                console.warn(`⚠️ ADDI Webhook - Estado no reconocido: ${webhookData.status}`);
                break;
        }

        // --- 8️⃣ Responder con el mismo objeto recibido (requerido por ADDI) ---
        console.log(`✅ ADDI Webhook - Procesamiento completado, respondiendo 200`);
        return res.status(200).json(webhookData);

    } catch (err) {
        console.error("❌ ADDI Webhook - Error procesando:", err);
        
        if (!res.headersSent) {
            return res.status(500).json({ error: "Error interno procesando el webhook" });
        }
    }
};
