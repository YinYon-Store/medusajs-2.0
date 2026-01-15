import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { notifyOrderShipped } from "../../../../../lib/notification-service"

/**
 * Build tracking URL based on courier name
 * Uses environment variables for each courier's tracking URL template
 * - COORDINADORA and MANUAL: concatenate tracking number to the URL
 * - SERVIENTREGA and INTERRAPIDISIMO: use only the URL from env (no tracking number concatenation)
 */
function buildTrackingUrl(courierName: string, trackingNumber: string): string {
  const normalizedCourier = courierName.toUpperCase()
  
  let trackingUrlTemplate = ''
  
  switch (normalizedCourier) {
    case 'COORDINADORA':
      trackingUrlTemplate = process.env.TRACKING_URL_COORDINADORA
      break
    case 'INTERRAPIDISIMO':
      trackingUrlTemplate = process.env.TRACKING_URL_INTERRAPIDISIMO
      break
    case 'SERVIENTREGA':
      trackingUrlTemplate = process.env.TRACKING_URL_SERVIENTREGA
      break
    case 'MANUAL':
      trackingUrlTemplate = process.env.TRACKING_URL_MANUAL || ''
      break
    default:
      trackingUrlTemplate = ''
  }
  
  if (!trackingUrlTemplate) {
    return ''
  }
  
  // For COORDINADORA and MANUAL: concatenate tracking number to the URL
  if (normalizedCourier === 'COORDINADORA' || normalizedCourier === 'MANUAL') {
    // Remove trailing slash if present, then concatenate tracking number
    const baseUrl = trackingUrlTemplate.replace(/\/$/, '')
    return `${baseUrl}${trackingNumber}`
  }
  
  // For SERVIENTREGA and INTERRAPIDISIMO: return only the URL from env
  return trackingUrlTemplate
}

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

    // Build tracking URL based on courier name
    const trackingUrl = tracking_url || buildTrackingUrl(carrier_name, tracking_number)

    // Send WhatsApp notification and capture response
    let notificationStatus = 'notificacion erronea'
    try {
      const notificationResponse = await notifyOrderShipped(order, carrier_name, tracking_number, trackingUrl)
      
      // Check if response is 200 (success)
      if (notificationResponse && notificationResponse.status === 200) {
        notificationStatus = 'notificacion exitosa'
      } else if (notificationResponse) {
        console.error(`[Admin] Notification failed: status ${notificationResponse.status}`)
        notificationStatus = 'notificacion erronea'
      } else {
        console.warn('[Admin] Notification service returned null')
        notificationStatus = 'notificacion erronea'
      }
    } catch (error) {
      console.error('[Admin] Error sending notification:', error)
      notificationStatus = 'notificacion erronea'
    }

    // Update order metadata with notification status and tracking URL
    await orderModuleService.updateOrders([{
      id: order_id,
      metadata: {
        ...(order.metadata || {}),
        whatsapp_notification_status: notificationStatus,
        whatsapp_notification_sent_at: new Date().toISOString(),
        tracking_url: trackingUrl
      }
    }])
    
    // Return success response
    res.status(200).json({
      success: true,
      notification_status: notificationStatus,
      order_id: order_id,
      display_id: order.display_id,
      tracking_url: trackingUrl
    })

  } catch (error) {
    console.error("[Admin] Error sending shipping notification:", error)
    res.status(500).json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    })
  }
}
