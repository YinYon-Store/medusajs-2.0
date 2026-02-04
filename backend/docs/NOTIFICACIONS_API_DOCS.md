# Notification Service API Documentation

This microservice handles sending WhatsApp notifications for various e-commerce events using the WhatsApp Cloud API.

## Base URL

The service runs on port `8080` by default.

## Authentication

All endpoints are protected by an API Key. You must include the `X-API-Key` header in every request.

**Header:** `X-API-Key: <YOUR_SECURE_KEY>`

## Endpoints

### Field Definitions

Important clarification on how to key identifiers are used in this API:

- **`order_id`**: The known **Display ID** of the order (e.g., `1234`, `#65`). This is the short identifier visible to the customer.
- **`tenant_id`**: The **Database Order ID** (e.g., `order_01KG64DVTPY79YFS8Q8557KEN7`). Despite the name, this field carries the internal unique identifier of the order used for URLs and system logic.

### 1. Health Check (Public)

Used to verify if the service is running.

**Endpoint:** `GET /health`

**Payload:** None

**Response:**
```json
{
  "status": "ok",
  "service": "notification-service"
}
```

### 2. Order Created

Triggered when a new order is placed.

**Endpoint:** `POST /events/order-created`

**Payload:**

```json
{
  "order_id": "12345",
  "tenant_id": "order_01KG64DVTPY79YFS8Q8557KEN7",
  "customer_name": "John Doe",
  "customer_phone": "573001234567",
  "backoffice_url": "https://admin.example.com/orders/12345"
}
```

**Notifications Sent:**
- **Customer:** `order_created_customer_new`
  - Params: `order_id`, `tenant_id`
  - Button: Link to order tracking (using `order_id`)
- **Admin:** `order_created_admin`
  - Params: `order_id`, `tenant_id`

---

### 2. Payment Captured

Triggered when a payment is successfully captured or rejected.

**Endpoint:** `POST /events/payment-captured`

**Payload:**

```json
{
  "order_id": "12345",
  "tenant_id": "order_01KG64DVTPY79YFS8Q8557KEN7",
  "status": "APPROVED", // or REJECTED, DECLINED, etc.
  "customer_phone": "573001234567",
  "amount": 770000,
  "reference": "ref_123",
  "provider": "bold",
  "time": "2025-04-12T19:00:00Z",
  "backoffice_url": "https://admin.example.com/orders/12345"
}
```

**Possible `status` values:**

| Status Type | Values |
|---|---|
| **Approved** | `APPROVED`, `SALE_APPROVED`, `VOID_APPROVED`, `CAPTURED` |
| **Rejected** | `SALE_REJECTED`, `VOID_REJECTED`, `REJECTED`, `DECLINED`, `ABANDONED`, `INTERNAL_ERROR` |

**Notifications Sent:**
- **Customer (Approved):** `payment_approved_customer`
  - Params: `order_id`, `tenant_id`
  - Button: Link to order (using `order_id`)
- **Customer (Rejected):** `payment_rejected_customer`
  - Params: `order_id`
- **Admin:** `payment_update_admin`
  - Params: `order_id`, `payment_status`, `payment_ref`, `provider_name`, `total_amount`, `transaction_time`, `tenant_id`
  - Button: Link to order (using `order_id`)

---

### 3. Order Shipped

Triggered when an order is shipped.

**Endpoint:** `POST /events/order-shipped`

**Payload:**

```json
{
  "order_id": "12345",
  "tenant_id": "order_01KG64DVTPY79YFS8Q8557KEN7",
  "customer_phone": "573001234567",
  "courier_name": "Coordinadora",
  "tracking_number": "987654321",
  "tracking_url": "https://coordinadora.com/rastreo/..."
}
```

**Notifications Sent:**
- **Customer:** `order_shipped_customer`
  - Params: `order_id`, `courier_name`, `tracking_number`, `tracking_url`
- **Admin:** `order_shipped_admin`
  - Params: `order_id`, `courier_name`, `tracking_number`, `tracking_url`

---

### 4. Order Delivered

Triggered when an order is delivered.

**Endpoint:** `POST /events/order-delivered`

**Payload:**

```json
{
  "order_id": "12345",
  "tenant_id": "order_01KG64DVTPY79YFS8Q8557KEN7",
  "customer_phone": "573001234567"
}
```

**Notifications Sent:**
- **Customer:** `order_delivered_customer`
  - Params: `order_id`

---

## Templates & Parameters

The service uses the following WhatsApp templates. Ensure these are created and approved in your WhatsApp Business Manager.

| Template Name | Language | Category | Parameters |
|---|---|---|---|
| `pending_order_shipped` | `en` | UTILITY | `order_list` |
| `pending_order_ready_to_ship` | `es_CO` | UTILITY | `order_list` |
| `pending_order_payments` | `es_CO` | UTILITY | `order_list` |
| `order_shipped_admin` | `es_CO` | UTILITY | `order_id`, `courier_name`, `tracking_number`, `tracking_url` |
| `payment_update_admin` | `es_CO` | UTILITY | `order_id`, `payment_status`, `payment_ref`, `provider_name`, `total_amount`, `transaction_time`, `tenant_id` |
| `order_created_admin` | `es_CO` | UTILITY | `order_id`, `tenant_id` |
| `order_delivered_customer` | `es_CO` | UTILITY | `order_id` |
| `order_shipped_customer` | `es_CO` | UTILITY | `order_id`, `courier_name`, `tracking_number`, `tracking_url` |
| `payment_rejected_customer` | `es_CO` | UTILITY | `order_id` |
| `payment_approved_customer` | `es_CO` | UTILITY | `order_id`, `tenant_id` |
| `order_created_customer_new` | `es_CO` | UTILITY | `order_id`, `tenant_id` |

### Parameter Format
All templates use **NAMED** parameters. The service automatically maps the event data to these parameter names.

## Environment Variables

- `PORT`: Server port (default 8080)
- `DATABASE_URL`: PostgreSQL connection string
- `WHATSAPP_API_URL`: WhatsApp Cloud API URL
- `WHATSAPP_TOKEN`: Permanent or temporary access token
- `ADMIN_PHONES`: Comma-separated list of admin phone numbers (e.g., `573001234567,573109876543`)
