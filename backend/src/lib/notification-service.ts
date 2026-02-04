import { BACKEND_URL, NOTIFICATION_DRY_RUN } from './constants'

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8080'
const NOTIFICATION_API_KEY = process.env.NOTIFICATION_API_KEY

/**
 * Log to stdout (bypasses framework console overrides - ensures visibility in Medusa)
 */
function logNotification(msg: string, data?: object): void {
  const line = data ? `${msg} ${JSON.stringify(data)}` : msg
  process.stdout.write(`[Notification] ${line}\n`)
}

function logNotificationError(msg: string, err?: unknown): void {
  const line = err !== undefined ? `${msg} ${String(err)}` : msg
  process.stderr.write(`[Notification] ${line}\n`)
}

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
  // Log notification call and payload
  logNotification(`Calling ${endpoint}`, payload)

  if (NOTIFICATION_DRY_RUN) {
    logNotification(`DRY RUN: ${endpoint}`)
    return createMockResponse(200)
  }

  if (!NOTIFICATION_API_KEY) {
    logNotification('API key not configured')
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
      logNotificationError(`Error ${response.status}: ${endpoint}`, errorText)
      return response
    }

    logNotification(`Success: ${endpoint} (HTTP ${response.status})`)
    return response
  } catch (error) {
    logNotificationError(`Network error: ${endpoint}`, error)
    return null
  }
}

/**
 * Get order_id (Display ID) and tenant_id (Database Order ID) per API spec.
 * - order_id: Short identifier visible to customer (e.g., "1234", "#65")
 * - tenant_id: Internal database ID for URLs and system logic
 */
function getOrderIds(order: any): { order_id: string; tenant_id: string } {
  const order_id = order.display_id
  const tenant_id = order.id
  return { order_id, tenant_id }
}

/**
 * Send order created notification
 */
export async function notifyOrderCreated(order: any): Promise<void> {
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  
  if (!customerPhone) {
    logNotification('Skipped order-created: no customer_phone', { order_id: order.display_id ?? order.id })
    return
  }

  const { order_id, tenant_id } = getOrderIds(order)
  const backofficeUrl = `${BACKEND_URL}/app/orders/${tenant_id}`
  const customerName = getCustomerName(order)

  logNotification('Order created', { order_id, tenant_id, customerName, customerPhone, backofficeUrl })
  await callNotificationService('/events/order-created', {
    order_id,
    tenant_id,
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
    logNotification('Skipped payment-captured: no customer_phone', { order_id: order.display_id ?? order.id, status })
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
    logNotification('Skipped payment-captured: status not approved/rejected', { order_id: order.display_id ?? order.id, status })
    return
  }

  const { order_id, tenant_id } = getOrderIds(order)
  logNotification('Payment captured', { order_id, tenant_id, status, customerPhone, amount, reference, provider, time, backofficeUrl })
  await callNotificationService('/events/payment-captured', {
    order_id,
    tenant_id,
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
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  
  if (!customerPhone) {
    logNotification('Skipped order-shipped: no customer_phone', { order_id: order.display_id ?? order.id })
    return null
  }

  const { order_id, tenant_id } = getOrderIds(order)
  logNotification('Order shipped', { order_id, tenant_id, customerPhone, courierName, trackingNumber, trackingUrl })
  return await callNotificationService('/events/order-shipped', {
    order_id,
    tenant_id,
    customer_phone: customerPhone,
    courier_name: courierName,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl || '',
  })
}

/**
 * Send order delivered notification
 */
export async function notifyOrderDelivered(order: any): Promise<Response | null> {
  const customerPhone = formatPhoneNumber(order.shipping_address?.phone)
  
  if (!customerPhone) {
    logNotification('Skipped order-delivered: no customer_phone', { order_id: order.display_id ?? order.id })
    return null
  }

  const { order_id, tenant_id } = getOrderIds(order)
  logNotification('Order delivered', { order_id, tenant_id, customerPhone })
  return await callNotificationService('/events/order-delivered', {
    order_id,
    tenant_id,
    customer_phone: customerPhone,
  })
}

