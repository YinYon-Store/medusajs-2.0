import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
    try {
        const { display_id, email } = req.query;

        // Validate required parameters
        if (!display_id || !email) {
            res.status(400).json({
                error: "Se requieren los parámetros 'display_id' y 'email'",
                message: "Por favor proporciona el número de orden (display_id) y el email del usuario"
            });
            return;
        }

        // Resolve required modules
        const orderModuleService = req.scope.resolve(Modules.ORDER);
        const customerModuleService = req.scope.resolve(Modules.CUSTOMER);
        const paymentModule = req.scope.resolve(Modules.PAYMENT);
        const fulfillmentModule = req.scope.resolve(Modules.FULFILLMENT);
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

        // Find customer by email
        const customers = await customerModuleService.listCustomers({ email: email as string });
        if (!customers || customers.length === 0) {
            res.status(404).json({
                error: "Cliente no encontrado",
                message: "No se encontró un cliente con ese email"
            });
            return;
        }

        const customer = customers[0];

        // Find order by display_id
        const orders = await orderModuleService.listOrders(
            { customer_id: customer.id },
            { relations: ["shipping_address", "billing_address"] }
        );

        const order = orders.find(order => order.display_id === Number(display_id));
        if (!order) {
            res.status(404).json({
                error: "Orden no encontrada",
                message: "No se encontró una orden con ese número"
            });
            return;
        }

        // Retrieve full order details
        const finalOrder = await orderModuleService.retrieveOrder(
            order.id,
            { relations: ["shipping_address", "billing_address", "items", "transactions", "summary"] }
        );

        if (!finalOrder) {
            res.status(404).json({
                error: "Orden no encontrada",
                message: "No se encontró una orden con ese número"
            });
            return;
        }

        // Get payment collection
        let payments = { status: "pending", payments: [] };
        const { data: collections } = await query.graph({
            entity: "order_payment_collection",
            fields: ["payment_collection_id"],
            filters: { order_id: order.id },
        });

        if (collections && collections.length > 0) {
            const paymentCollection = await paymentModule.retrievePaymentCollection(
                collections[0].payment_collection_id,
                { relations: ["payments"] }
            );

            if (paymentCollection) {
                payments = {
                    status: paymentCollection.status,
                    payments: paymentCollection.payments
                };
            }
        }

        // Filter order fields
        const filteredOrder = {
            id: finalOrder.id,
            display_id: finalOrder.display_id,
            metadata: finalOrder.metadata,
            version: finalOrder.version,
            status: finalOrder.status,
            is_draft_order: finalOrder.is_draft_order,
            email: finalOrder.email,
            currency_code: finalOrder.currency_code,
            canceled_at: finalOrder.canceled_at,
            shipping_address: finalOrder.shipping_address ? {
                company: finalOrder.shipping_address.company,
                first_name: finalOrder.shipping_address.first_name,
                last_name: finalOrder.shipping_address.last_name,
                address_1: finalOrder.shipping_address.address_1,
                address_2: finalOrder.shipping_address.address_2,
                city: finalOrder.shipping_address.city,
                country_code: finalOrder.shipping_address.country_code,
                province: finalOrder.shipping_address.province,
                postal_code: finalOrder.shipping_address.postal_code,
                phone: finalOrder.shipping_address.phone,
                created_at: finalOrder.shipping_address.created_at,
                updated_at: finalOrder.shipping_address.updated_at
            } : null,
            billing_address: finalOrder.billing_address ? {
                company: finalOrder.billing_address.company,
                first_name: finalOrder.billing_address.first_name,
                last_name: finalOrder.billing_address.last_name,
                address_1: finalOrder.billing_address.address_1,
                address_2: finalOrder.billing_address.address_2,
                city: finalOrder.billing_address.city,
                country_code: finalOrder.billing_address.country_code,
                province: finalOrder.billing_address.province,
                postal_code: finalOrder.billing_address.postal_code,
                phone: finalOrder.billing_address.phone,
                created_at: finalOrder.billing_address.created_at,
                updated_at: finalOrder.billing_address.updated_at
            } : null,
            created_at: finalOrder.created_at,
            updated_at: finalOrder.updated_at,
            deleted_at: finalOrder.deleted_at,
            summary: finalOrder.summary ? {
                paid_total: finalOrder.summary.paid_total,
                refunded_total: finalOrder.summary.refunded_total,
                accounting_total: finalOrder.summary.accounting_total,
                credit_line_total: finalOrder.summary.credit_line_total,
                transaction_total: finalOrder.summary.transaction_total,
                pending_difference: finalOrder.summary.pending_difference,
                current_order_total: finalOrder.summary.current_order_total,
                original_order_total: finalOrder.summary.original_order_total
            } : null,
            items: finalOrder.items?.map(item => ({
                title: item.title,
                subtitle: item.subtitle,
                thumbnail: item.thumbnail,
                product_type: item.product_type,
                product_type_id: item.product_type_id,
                product_collection: item.product_collection,
                product_handle: item.product_handle,
                variant_sku: item.variant_sku,
                variant_title: item.variant_title,
                variant_option_values: item.variant_option_values,
                unit_price: item.unit_price,
                quantity: item.quantity
            })) || []
        };

        // Filter payment fields
        const filteredPayments = {
            status: payments.status,
            payments: payments.payments.map(payment => ({
                currency_code: payment.currency_code,
                provider_id: payment.provider_id,
                captured_at: payment.captured_at,
                canceled_at: payment.canceled_at,
                raw_amount: payment.raw_amount,
                created_at: payment.created_at,
                updated_at: payment.updated_at,
                deleted_at: payment.deleted_at
            }))
        };

        // Get fulfillment data (only for version >= 2)
        let filteredFulfillment = null;
        if (order.version >= 2) {
            const { data: fulfillments } = await query.graph({
                entity: "order_fulfillment",
                fields: ["fulfillment_id"],
                filters: { order_id: order.id },
            });

            if (fulfillments && fulfillments.length > 0) {
                const fullFulfillment = await fulfillmentModule.retrieveFulfillment(
                    fulfillments[0].fulfillment_id,
                    { relations: ["items", "labels"] }
                );

                if (fullFulfillment) {
                    filteredFulfillment = {
                        id: fullFulfillment.id,
                        delivered_at: fullFulfillment.delivered_at,
                        shipped_at: fullFulfillment.shipped_at,
                        canceled_at: fullFulfillment.canceled_at,
                        data: fullFulfillment.data
                    };
                }
            }
        }

        res.status(200).json({
            success: true,
            data: {
                order: filteredOrder,
                payments: filteredPayments,
                fulfillment: filteredFulfillment
            }
        });

    } catch (error) {
        console.error("Error fetching order status:", error);

        if (error.message?.includes("Order with display_id")) {
            res.status(404).json({
                error: "Orden no encontrada",
                message: "No se encontró una orden con ese número"
            });
            return;
        }

        res.status(500).json({
            error: "Error interno del servidor",
            message: "Ocurrió un error al procesar la solicitud"
        });
    }
}
