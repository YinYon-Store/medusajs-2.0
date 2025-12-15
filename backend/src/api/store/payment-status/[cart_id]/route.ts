import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getPaymentResult } from "../../../../lib/payment-buffer-service";

/**
 * GET /store/payment-status/:cart_id
 * 
 * Consulta el resultado de pago pendiente en el buffer
 * Retorna el resultado si existe y no ha expirado
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { cart_id } = req.params;

    if (!cart_id) {
      return res.status(400).json({ error: "cart_id es requerido" });
    }

    // Consultar buffer de resultados de pago
    const paymentResult = await getPaymentResult(cart_id);

    if (!paymentResult) {
      return res.status(404).json({
        has_payment_result: false,
        message: "No pending payment result found",
      });
    }

    return res.status(200).json({
      has_payment_result: true,
      payment_result: {
        status: paymentResult.status,
        transaction_id: paymentResult.transaction_id,
        provider: paymentResult.provider,
        amount: paymentResult.amount,
        currency: paymentResult.currency,
        webhook_received_at: paymentResult.webhook_received_at,
      },
    });
  } catch (error) {
    console.error("Error in GET /store/payment-status/:cart_id:", error);
    return res.status(500).json({
      message: "Error retrieving payment status",
    });
  }
};


