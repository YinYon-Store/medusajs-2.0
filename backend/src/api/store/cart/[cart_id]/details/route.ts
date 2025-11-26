import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

/**
 * GET /store/cart/:cart_id/details
 * 
 * Endpoint interno para obtener datos completos del carrito
 * Usado por providers de pago que no pueden acceder directamente a los módulos
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const { cart_id } = req.params;

        if (!cart_id) {
            return res.status(400).json({ error: "cart_id es requerido" });
        }

        // Usar el módulo de Cart directamente
        const cartModuleService = req.scope.resolve(Modules.CART);
        const cart = await cartModuleService.retrieveCart(cart_id,
            {
                relations: [
                    "shipping_address",
                    "billing_address",
                    "items"
                ],
            }
        );
        
        if (!cart) {
            return res.status(404).json({ error: "Carrito no encontrado" });
        }
        if(!cart.customer_id) {
            return res.status(400).json({ error: "Customer ID is required" });
        }

        const customerModuleService = req.scope.resolve(Modules.CUSTOMER);
        const customer = await customerModuleService.retrieveCustomer(cart.customer_id);

        if(!customer) {
            return res.status(400).json({ error: "Customer not found" });
        }

        return res.status(200).json({
            cart,
            customer,
        });

    } catch (error) {
        console.error("Error obteniendo detalles del carrito:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
};
