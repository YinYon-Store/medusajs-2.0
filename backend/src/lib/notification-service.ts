import { BACKEND_URL, NOTIFICATION_DRY_RUN } from './constants'

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8080'
const NOTIFICATION_API_KEY = process.env.NOTIFICATION_API_KEY

/**
 * Helper function to format phone number for WhatsApp
 * Ensures phone number is in format: 573001234567 (Colombia format with country code)
 */
function formatPhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '')
  
  // If it starts with 57 (Colombia country code), return as is
  if (cleaned.startsWith('57')) {
    return cleaned
  }
  
  // If it starts with 0, remove it and add 57
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1)
  }
  
  // Add country code if not present
  if (cleaned.length === 10) {
    return `57${cleaned}`
  }
  
  // If already has country code or other format, return as is
  return cleaned
}

/**
 * Get customer name from order
 */
function getCustomerName(order: any): string {
  if (order.shipping_address?.first_name || order.shipping_address?.last_name) {
    const firstName = order.shipping_address.first_name || ''
    const lastName = order.shipping_address.last_name || ''
    return `${firstName} ${lastName}`.trim()
  }
  return 'Cliente'
}

/**
 * Call notification service endpoint
 */
async function callNotificationService(
  endpoint: string,
  payload: any
): Promise<void> {
  // Log the notification payload
  console.log('\n📤 ===== NOTIFICATION SERVICE REQUEST =====')
  console.log(`📍 Endpoint: ${NOTIFICATION_SERVICE_URL}${endpoint}`)
  console.log(`📋 Method: POST`)
  console.log(`📦 Payload:`)
  console.log(JSON.stringify(payload, null, 2))
  console.log('==========================================\n')

  // In dry run mode, don't actually call the service
  if (NOTIFICATION_DRY_RUN) {
    console.log('🧪 DRY RUN MODE: Notification logged but NOT sent to service')
    return
  }

  if (!NOTIFICATION_API_KEY) {
    console.warn('⚠️ NOTIFICATION_API_KEY not configured, skipping notification')
    return
  }

  try {
    const response = await fetch(`${NOTIFICATION_SERVICE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': NOTIFICATION_API_KEY,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(
        `❌ Notification service error (${response.status}):`,
        errorText
      )
      throw new Error(`Notification service returned ${response.status}: ${errorText}`)
    }

    console.log(`✅ Notification sent successfully to ${endpoint}`)
  } catch (error) {
    console.error(`❌ Error calling notification service ${endpoint}:`, error)
    // Don't throw - we don't want notification failures to break the main flow
  }
}

/**
 * Send order created notification
 */
export async function notifyOrderCreated(order: any): Promise<void> {
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  
  if (!customerPhone) {
    console.warn('⚠️ No customer phone found, skipping order created notification')
    return
  }

  const backofficeUrl = `${BACKEND_URL}/app/orders/${order.id}`
  const customerName = getCustomerName(order)

  await callNotificationService('/events/order-created', {
    order_id: order.id,
    tenant_id: 'aura_perfumeria',
    customer_name: customerName,
    customer_phone: customerPhone,
    backoffice_url: backofficeUrl,
  })
}

/**
 * Send payment captured notification
 */
export async function notifyPaymentCaptured(
  order: any,
  status: string,
  amount: number,
  reference: string,
  provider: 'bold' | 'addi',
  time?: string
): Promise<void> {
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  
  if (!customerPhone) {
    console.warn('⚠️ No customer phone found, skipping payment captured notification')
    return
  }

  const backofficeUrl = `${BACKEND_URL}/app/orders/${order.id}`

  // Map status to notification service format
  // Approved statuses: APPROVED, SALE_APPROVED, VOID_APPROVED, CAPTURED
  // Rejected statuses: SALE_REJECTED, VOID_REJECTED, REJECTED, DECLINED, ABANDONED, INTERNAL_ERROR
  const isApproved = ['APPROVED', 'SALE_APPROVED', 'VOID_APPROVED', 'CAPTURED'].includes(status)
  const isRejected = ['SALE_REJECTED', 'VOID_REJECTED', 'REJECTED', 'DECLINED', 'ABANDONED', 'INTERNAL_ERROR'].includes(status)

  // Only send notification for approved or rejected statuses
  if (!isApproved && !isRejected) {
    console.log(`ℹ️ Payment status ${status} does not require notification`)
    return
  }

  await callNotificationService('/events/payment-captured', {
    order_id: order.id,
    tenant_id: 'aura_perfumeria',
    status: status,
    customer_phone: customerPhone,
    amount: amount,
    reference: reference,
    provider: provider,
    time: time || new Date().toISOString(),
    backoffice_url: backofficeUrl,
  })
}

/**
 * Send order shipped notification
 */
export async function notifyOrderShipped(
  order: any,
  courierName: string,
  trackingNumber: string,
  trackingUrl?: string
): Promise<void> {
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  
  if (!customerPhone) {
    console.warn('⚠️ No customer phone found, skipping order shipped notification')
    return
  }

  await callNotificationService('/events/order-shipped', {
    order_id: order.id,
    tenant_id: 'aura_perfumeria',
    customer_phone: customerPhone,
    courier_name: courierName,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl || '',
  })
}

