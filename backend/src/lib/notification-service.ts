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
 * Create a mock response object for dry run mode
 */
function createMockResponse(status: number): Response {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    redirected: false,
    type: 'default',
    url: '',
    clone: function() { return this },
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => '',
  } as Response
}

/**
 * Call notification service endpoint
 * Returns the response object to check status
 */
async function callNotificationService(
  endpoint: string,
  payload: any
): Promise<Response | null> {
  // Log the notification payload - ALWAYS log first
  console.log('\n📤 ===== NOTIFICATION SERVICE REQUEST =====')
  console.log(`📍 Endpoint: ${NOTIFICATION_SERVICE_URL}${endpoint}`)
  console.log(`📋 Method: POST`)
  console.log(`🔑 API Key configured: ${NOTIFICATION_API_KEY ? 'YES' : 'NO'}`)
  console.log(`🧪 Dry Run Mode: ${NOTIFICATION_DRY_RUN ? 'YES' : 'NO'}`)
  console.log(`📦 Payload:`)
  console.log(JSON.stringify(payload, null, 2))
  console.log('==========================================\n')

  // In dry run mode, don't actually call the service but return a mock success response
  if (NOTIFICATION_DRY_RUN) {
    console.log('🧪 DRY RUN MODE: Notification logged but NOT sent to service')
    return createMockResponse(200)
  }

  if (!NOTIFICATION_API_KEY) {
    console.warn('⚠️ NOTIFICATION_API_KEY not configured, skipping notification')
    return null
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
      // Return the response even if not ok, so caller can check status
      return response
    }

    console.log(`✅ Notification sent successfully to ${endpoint}`)
    console.log('response', response)
    return response
  } catch (error) {
    console.error(`❌ Error calling notification service ${endpoint}:`, error)
    // Return null on network errors
    return null
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
  provider: 'bold' | 'addi' | 'wompi',
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
 * Returns the response to check status (200 = success, otherwise error)
 */
export async function notifyOrderShipped(
  order: any,
  courierName: string,
  trackingNumber: string,
  trackingUrl?: string
): Promise<Response | null> {
  console.log('\n🚀 ===== notifyOrderShipped CALLED =====')
  console.log(`Order ID: ${order?.id}`)
  console.log(`Courier: ${courierName}`)
  console.log(`Tracking Number: ${trackingNumber}`)
  console.log(`Tracking URL: ${trackingUrl || 'N/A'}`)
  
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  console.log(`Customer Phone: ${customerPhone || 'NOT FOUND'}`)
  
  if (!customerPhone) {
    console.warn('⚠️ No customer phone found, skipping order shipped notification')
    console.log('==========================================\n')
    return null
  }

  console.log('📞 Calling notification service...')
  const result = await callNotificationService('/events/order-shipped', {
    order_id: order.id,
    tenant_id: 'aura_perfumeria',
    customer_phone: customerPhone,
    courier_name: courierName,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl || '',
  })
  
  console.log(`📥 Notification service result: ${result ? `Response status ${result.status}` : 'null'}`)
  console.log('==========================================\n')
  
  return result
}

