import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const { fulfillment_id } = req.params
    const { tracking_number } = req.body as { tracking_number: string }

    if (!fulfillment_id) {
      res.status(400).json({ error: "Fulfillment ID is required" })
      return
    }

    if (!tracking_number) {
      res.status(400).json({ error: "Tracking number is required" })
      return
    }

    // Resolver el servicio de fulfillment
    const fulfillmentModuleService = req.scope.resolve(Modules.FULFILLMENT)

    // Obtener el fulfillment actual
    const fulfillment = await fulfillmentModuleService.retrieveFulfillment(fulfillment_id)

    if (!fulfillment) {
      res.status(404).json({ error: "Fulfillment not found" })
      return
    }

    // Actualizar el fulfillment con el nuevo tracking number
    const updatedFulfillment = await fulfillmentModuleService.updateFulfillment(fulfillment_id, {
      data: {
        ...fulfillment.data,
        tracking_number: tracking_number
      },
      labels: [
        {
          tracking_number: tracking_number,
          tracking_url: `https://www.google.com/search?q=${tracking_number}`,
          label_url: `https://www.google.com/search?q=${tracking_number}`,
        }
      ]
    })

    res.status(200).json({
      success: true,
      fulfillment: updatedFulfillment
    })

  } catch (error) {
    console.error("Error updating fulfillment tracking:", error)
    res.status(500).json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    })
  }
}
