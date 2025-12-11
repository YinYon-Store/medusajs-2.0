import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { notifyOrderShipped } from "../../../../../lib/notification-service"

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const { order_id } = req.params
    const { carrier_name, tracking_number, tracking_url } = req.body as { carrier_name: string, tracking_number: string, tracking_url?: string }

    if (!order_id) {
      res.status(400).json({ error: "Order ID is required" })
      return
    }

    if (!carrier_name || !tracking_number) {
      res.status(400).json({ error: "Carrier name and tracking number are required" })
      return
    }

    // Resolve order module service
    const orderModuleService = req.scope.resolve(Modules.ORDER)

    // Retrieve full order with shipping address
    const order = await orderModuleService.retrieveOrder(order_id, {
      relations: ["shipping_address"]
    })

    if (!order) {
      res.status(404).json({ error: "Order not found" })
      return
    }

    // Generate notification message
    const message = generateNotificationMessage({
      display_id: order.display_id,
      shipping_address: order.shipping_address,
      carrier_name,
      tracking_number
    })

    // Update order metadata with the notification message
    await orderModuleService.updateOrders([{
      id: order_id,
      metadata: {
        ...(order.metadata || {}),
        whatsapp_notification_message: message,
        whatsapp_notification_sent_at: new Date().toISOString()
      }
    }])

    // Send WhatsApp notification
    try {
      // Generate tracking URL if not provided (optional, can be empty string)
      const trackingUrl = tracking_url || ''
      await notifyOrderShipped(order, carrier_name, tracking_number, trackingUrl)
    } catch (error) {
      console.error('Error sending WhatsApp shipping notification:', error)
      // Don't fail the request if notification fails
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: message,
      order_id: order_id,
      display_id: order.display_id
    })

  } catch (error) {
    console.error("Error sending shipping notification:", error)
    res.status(500).json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    })
  }
}

// Generate notification message with data masking
function generateNotificationMessage({
  display_id,
  shipping_address,
  carrier_name,
  tracking_number
}: {
  display_id: number
  shipping_address: any
  carrier_name: string
  tracking_number: string
}): string {
  // Get template from environment variables based on carrier type
  const template = carrier_name === "MANUAL" 
    ? process.env.WHATSAPP_TEMPLATE_MANUAL
    : process.env.WHATSAPP_TEMPLATE_CARRIER

  if (!template) {
    throw new Error("WhatsApp template not configured in environment variables")
  }

  // Mask sensitive data with random percentage between 40-60% visible
  const maskData = (data: string | null | undefined): string => {
    if (!data) return "***"
    if (data.length <= 2) return "*".repeat(data.length)
    
    // Calculate random percentage between 60-80%
    const randomPercentage = 0.6 + Math.random() * 0.2 
    const visibleChars = Math.max(1, Math.floor(data.length * randomPercentage))
    
    // Select random positions to display
    const positions = Array.from({ length: data.length }, (_, i) => i)
    const visiblePositions = positions
      .sort(() => Math.random() - 0.5) // Shuffle randomly
      .slice(0, visibleChars) // Take only needed chars
      .sort((a, b) => a - b) // Sort to maintain structure
    
    let result = ""
    for (let i = 0; i < data.length; i++) {
      result += visiblePositions.includes(i) ? data[i] : "*"
    }
    
    return result
  }

  // Mask sensitive customer data for security
  const maskedData = {
    first_name: maskData(shipping_address?.first_name),
    last_name: maskData(shipping_address?.last_name),
    address_1: maskData(shipping_address?.address_1)
  }

  // Replace placeholders in template
  let message = template
    .replace(/{display_id}/g, display_id.toString())
    .replace(/{carrier_name}/g, carrier_name)
    .replace(/{tracking_number}/g, tracking_number)
    .replace(/{shipping_address\.first_name}/g, maskedData.first_name)
    .replace(/{shipping_address\.first_lastname}/g, maskedData.last_name)
    .replace(/{shipping_address\.address_1}/g, maskedData.address_1)

  return message
}
