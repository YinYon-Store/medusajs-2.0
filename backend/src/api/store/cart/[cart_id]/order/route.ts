import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * GET /store/cart/:cart_id/order
 * 
 * Consulta si un carrito tiene una orden asociada
 * Retorna información básica de la orden si existe
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { cart_id } = req.params;

    if (!cart_id) {
      return res.status(400).json({ error: "cart_id es requerido" });
    }

    const scope = req.scope;
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const orderModule = scope.resolve(Modules.ORDER);
    const paymentModule = scope.resolve(Modules.PAYMENT);

    // Buscar orden asociada al cart_id usando order_cart table
    const { data: orderCarts } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cart_id },
    });

    if (!orderCarts || orderCarts.length === 0) {
      return res.status(404).json({
        message: "No order found for this cart",
      });
    }

    const orderId = orderCarts[0].order_id;

    // Obtener información de la orden
    try {
      const order = await orderModule.retrieveOrder(orderId);

      // Obtener payment_status de la payment collection
      let paymentStatus = "pending";
      try {
        const { data: collections } = await query.graph({
          entity: "order_payment_collection",
          fields: ["payment_collection_id"],
          filters: { order_id: orderId },
        });

        if (collections && collections.length > 0) {
          const paymentCollection = await paymentModule.retrievePaymentCollection(
            collections[0].payment_collection_id
          );
          if (paymentCollection) {
            paymentStatus = paymentCollection.status || "pending";
          }
        }
      } catch (paymentError) {
        console.warn("Error retrieving payment status:", paymentError);
        // Continuar con payment_status = "pending"
      }

      return res.status(200).json({
        order: {
          id: order.id,
          display_id: order.display_id,
          payment_status: paymentStatus,
          status: order.status,
          created_at: order.created_at,
        },
      });
    } catch (error) {
      console.error("Error retrieving order:", error);
      return res.status(500).json({
        message: "Error retrieving order",
      });
    }
  } catch (error) {
    console.error("Error in GET /store/cart/:cart_id/order:", error);
    return res.status(500).json({
      message: "Error retrieving order",
    });
  }
};

