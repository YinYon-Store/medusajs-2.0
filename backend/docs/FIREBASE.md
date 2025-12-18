# Firebase Crashlytics y Analytics - Documentación Técnica

## 📋 Resumen Técnico

Integración de Firebase Admin SDK en el backend de Medusa JS 2.0 para reporte automático de errores (Crashlytics) y tracking de eventos de negocio (Analytics). La implementación es **no bloqueante** y funciona mediante Cloud Logging, permitiendo monitoreo completo del sistema sin afectar el rendimiento.

### Características Principales

- ✅ Reporte automático de errores con categorización
- ✅ Tracking de eventos de negocio críticos
- ✅ Tags automáticos para distinguir backend/frontend
- ✅ Contexto enriquecido para debugging
- ✅ No bloquea el flujo si Firebase falla
- ✅ En desarrollo solo loguea (no envía a Firebase)

---

## 🔧 Configuración

### Variables de Entorno

```bash
# Habilitar/deshabilitar Firebase
FIREBASE_ENABLED=true

# JSON string del service account (recomendado - mismo formato para local y producción)
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"tu-project-id",...}'
```

**Nota**: El JSON debe estar en **una sola línea** (sin saltos de línea). Puedes usar un [JSON Minifier](https://jsonformatter.org/json-minify) para convertir el archivo JSON a una línea.

#### Alternativas (solo para desarrollo local)

```bash
# Opción 2: Archivo JSON (solo desarrollo local)
FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json

# Opción 3: Credenciales individuales (fallback)
FIREBASE_PROJECT_ID=tu-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@tu-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Obtener y Configurar Credenciales

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Project Settings > Service Accounts
3. Generate New Private Key
4. Descarga el archivo JSON y guárdalo en `config/firebase-service-account.json` (no subir a Git)

5. **Convierte el JSON a una sola línea:**

   **Windows (PowerShell):**
   ```powershell
   .\scripts\convert-firebase-json.ps1
   ```
   
   **Linux/Mac (Bash):**
   ```bash
   ./scripts/convert-firebase-json.sh
   ```
   
   El script generará la línea completa lista para copiar.

   **O manualmente:**
   - Usa un [JSON Minifier](https://jsonformatter.org/json-minify)
   - O ejecuta: `node -e "console.log(JSON.stringify(require('./config/firebase-service-account.json')))"`

6. **Agrega a tu `.env` local:**
   ```bash
   FIREBASE_ENABLED=true
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   ```

7. **Agrega la misma variable en Railway** (mismo valor, misma configuración)

---

## 🎯 Errores Mapeados y su Importancia

### Categorías de Errores

| Categoría | Descripción | Importancia | Puntos de Integración |
|-----------|-------------|-------------|----------------------|
| **PAYMENT** | Errores de captura/cancelación de pagos | 🔴 **CRÍTICO** - Afecta ingresos directamente | Webhooks Bold, Addi, Wompi |
| **WEBHOOK** | Errores en webhooks de proveedores | 🔴 **CRÍTICO** - Puede causar pérdida de pagos | Todos los webhooks de pago |
| **DATABASE** | Errores de PostgreSQL | 🔴 **CRÍTICO** - Afecta persistencia de datos | Payment buffer, queries |
| **REDIS** | Errores de conexión/operaciones | 🟡 **ALTO** - Afecta cache y rate limiting | Payment buffer, rate limiting |
| **S3** | Errores de almacenamiento | 🟡 **ALTO** - Afecta upload de archivos | S3 file service |
| **SEARCH** | Errores de búsqueda (Meilisearch) | 🟡 **MEDIO** - Afecta experiencia de usuario | Endpoint de búsqueda |
| **NOTIFICATION** | Errores de notificaciones | 🟢 **BAJO** - No bloquea flujo principal | WhatsApp, email |
| **VALIDATION** | Errores de validación de payloads | 🟡 **MEDIO** - Previene datos inválidos | Webhooks, endpoints |
| **AUTHENTICATION** | Errores de autenticación | 🔴 **CRÍTICO** - Seguridad | Validación de webhooks |
| **RATE_LIMIT** | Rate limits excedidos | 🟢 **INFORMATIVO** - Protección activa | Middlewares |
| **TIMEOUT** | Timeouts de requests | 🟡 **MEDIO** - Indica problemas de rendimiento | Middlewares |
| **UNKNOWN** | Errores no categorizados | 🟡 **MEDIO** - Requiere investigación | Catch-all |

### Puntos de Integración

#### Webhooks de Pago
- **Bold** (`src/api/hooks/bold/payment/route.ts`): Validación, autenticación, captura, cancelación
- **Addi** (`src/api/hooks/addi/payment/route.ts`): Validación, autenticación, captura
- **Wompi** (`src/api/hooks/wompi/payment/route.ts`): Preparado para cuando se reactive

#### Endpoints
- **Búsqueda** (`src/api/store/search/route.ts`): Búsquedas exitosas y fallidas

#### Servicios
- **Payment Buffer** (`src/lib/payment-buffer-service.ts`): Errores de Redis/PostgreSQL
- **S3 File Storage** (`src/modules/s3-file/service.ts`): Errores de operaciones de archivos
- **Subscribers** (`src/subscribers/order-created-payment-buffer.ts`): Errores de procesamiento

---

## 📊 Eventos de Analytics y su Importancia

### Eventos de Pago

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `payment_initiated` | Pago iniciado | 🟡 **MEDIO** | Tracking de inicio de flujo |
| `payment_approved` | Pago aprobado | 🔴 **CRÍTICO** | Métrica de éxito |
| `payment_rejected` | Pago rechazado | 🔴 **CRÍTICO** | Análisis de rechazos |
| `payment_pending` | Pago pendiente | 🟡 **MEDIO** | Tracking de estados intermedios |
| `payment_captured` | Pago capturado | 🔴 **CRÍTICO** | Confirmación de captura |
| `payment_cancelled` | Pago cancelado | 🟡 **MEDIO** | Tracking de cancelaciones |

**Importancia**: Los eventos de pago son **críticos** para entender la salud financiera del sistema y detectar problemas en el flujo de pagos.

### Eventos de Webhook

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `webhook_received` | Webhook recibido | 🟡 **MEDIO** | Volumen de webhooks |
| `webhook_processed` | Webhook procesado | 🔴 **CRÍTICO** | Tasa de éxito |
| `webhook_failed` | Webhook fallido | 🔴 **CRÍTICO** | Detección de problemas |
| `webhook_validation_failed` | Validación fallida | 🔴 **CRÍTICO** | Seguridad y autenticación |

**Importancia**: Los webhooks son **críticos** porque son la única forma de confirmar pagos desde proveedores externos. Un fallo puede resultar en pérdida de ingresos.

### Eventos de Orden

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `order_created` | Orden creada | 🔴 **CRÍTICO** | Métrica principal de negocio |
| `order_updated` | Orden actualizada | 🟡 **MEDIO** | Tracking de cambios |
| `order_completed` | Orden completada | 🔴 **CRÍTICO** | Finalización del ciclo |

**Importancia**: Las órdenes son el **core del negocio**. Tracking completo del ciclo de vida.

### Eventos de Búsqueda

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `search_performed` | Búsqueda realizada | 🟡 **MEDIO** | UX y popularidad de términos |
| `search_failed` | Búsqueda fallida | 🟡 **MEDIO** | Problemas de búsqueda |

**Importancia**: Afecta la **experiencia de usuario** y puede impactar conversión.

### Eventos de Buffer

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `payment_buffer_saved` | Resultado guardado | 🟡 **MEDIO** | Tracking de uso del buffer |
| `payment_buffer_retrieved` | Resultado recuperado | 🟡 **MEDIO** | Efectividad del buffer |
| `payment_buffer_cleared` | Buffer limpiado | 🟢 **BAJO** | Limpieza automática |

**Importancia**: El buffer es **crítico** para manejar race conditions entre webhooks y creación de órdenes.

### Eventos de Notificación

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `notification_sent` | Notificación enviada | 🟢 **BAJO** | Tracking de comunicaciones |
| `notification_failed` | Notificación fallida | 🟡 **MEDIO** | Problemas de comunicación |

**Importancia**: **Baja** - No bloquea el flujo principal, pero afecta experiencia del cliente.

### Eventos de Sistema

| Evento | Descripción | Importancia | Uso |
|--------|-------------|-------------|-----|
| `rate_limit_exceeded` | Rate limit excedido | 🟢 **INFORMATIVO** | Protección activa |
| `request_timeout` | Timeout de request | 🟡 **MEDIO** | Problemas de rendimiento |

---

## 🏷️ Tags Automáticos

Todos los errores y eventos del backend incluyen automáticamente los siguientes tags para distinguirlos del frontend:

### Tags de Identificación

| Tag | Valor | Descripción |
|-----|-------|-------------|
| `source` | `"backend"` | Identifica que viene del backend |
| `service_type` | `"api"` | Tipo de servicio |
| `environment` | `"production"` / `"staging"` / `"development"` | Ambiente según `NODE_ENV` |

### Tags Adicionales

| Tag | Descripción |
|-----|-------------|
| `category` | Categoría del error (payment, webhook, etc.) |
| `error_type` | Tipo de error (Error, TypeError, etc.) |
| `timestamp` | Timestamp ISO del evento |
| `node_version` | Versión de Node.js |
| `platform` | Plataforma del servidor (win32, linux, darwin) |

### Ejemplo de Payload

```json
{
  "source": "backend",
  "environment": "production",
  "service_type": "api",
  "category": "payment",
  "error_type": "Error",
  "provider": "bold",
  "payment_id": "pay_123",
  "order_id": "order_456",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "node_version": "v22.x",
  "platform": "linux"
}
```

---

## 🔍 Guía de Filtrado

### En Firebase Crashlytics

1. Ve a [Firebase Console](https://console.firebase.google.com/) > **Crashlytics**
2. Usa filtros por **Custom Key**:
   - `source = "backend"` - Solo errores del backend
   - `environment = "production"` - Solo producción
   - `category = "payment"` - Solo errores de pago
   - `category = "webhook"` - Solo errores de webhook

### En Cloud Logging

1. Ve a [Cloud Logging](https://console.cloud.google.com/logs)
2. Selecciona tu proyecto (ej: **aura-logs**)
3. Usa queries:

#### Errores del Backend en Producción
```
jsonPayload.source="backend"
jsonPayload.environment="production"
severity>=ERROR
```

#### Errores de Pago
```
jsonPayload.source="backend"
jsonPayload.category="payment"
severity>=ERROR
```

#### Errores de Webhook
```
jsonPayload.source="backend"
jsonPayload.category="webhook"
severity>=ERROR
```

#### Eventos de Pago
```
jsonPayload.event_name="payment_captured"
jsonPayload.source="backend"
jsonPayload.environment="production"
```

#### Comparar Frontend vs Backend
```
jsonPayload.event_name="payment_initiated"
(jsonPayload.source="backend" OR jsonPayload.source="frontend")
```

#### Errores por Proveedor
```
jsonPayload.source="backend"
jsonPayload.payment_provider="bold"
severity>=ERROR
```

### En BigQuery (si exportas Cloud Logging)

```sql
-- Errores del backend por categoría
SELECT 
  json_extract_scalar(jsonPayload, '$.category') as category,
  COUNT(*) as error_count
FROM `tu-project-id.cloud_logging`
WHERE 
  json_extract_scalar(jsonPayload, '$.source') = 'backend'
  AND json_extract_scalar(jsonPayload, '$.environment') = 'production'
  AND severity >= 'ERROR'
GROUP BY category
ORDER BY error_count DESC;

-- Eventos de pago por proveedor
SELECT 
  json_extract_scalar(jsonPayload, '$.payment_provider') as provider,
  json_extract_scalar(jsonPayload, '$.event_name') as event,
  COUNT(*) as count
FROM `tu-project-id.cloud_logging`
WHERE 
  json_extract_scalar(jsonPayload, '$.source') = 'backend'
  AND json_extract_scalar(jsonPayload, '$.event_name') LIKE 'payment_%'
GROUP BY provider, event
ORDER BY count DESC;
```

---

## 📈 Dashboards Recomendados

### Dashboard 1: Errores por Categoría
- **Métrica**: Errores totales
- **Filtro**: `source = "backend"`, `environment = "production"`
- **Agrupación**: Por `category`
- **Alerta**: Si `payment` o `webhook` > 10 errores/hora

### Dashboard 2: Eventos de Pago
- **Métrica**: Eventos de pago
- **Filtro**: `event_name LIKE "payment_%"`
- **Agrupación**: Por `source`, `payment_provider`, `event_name`
- **KPI**: Tasa de éxito = `payment_captured / payment_initiated`

### Dashboard 3: Performance de Webhooks
- **Métrica**: Tasa de éxito de webhooks
- **Filtro**: `event_name LIKE "webhook_%"`
- **Agrupación**: Por `webhook_provider`
- **Alerta**: Si `webhook_failed` > 5% del total

---

## 💻 Uso en el Código

### Reportar un Error

```typescript
import { reportError, ErrorCategory } from '../lib/firebase-service';

try {
  // Tu código aquí
} catch (error) {
  await reportError(
    error instanceof Error ? error : new Error(String(error)),
    ErrorCategory.PAYMENT,
    {
      provider: 'bold',
      payment_id: 'pay_123',
      order_id: 'order_456',
    }
  );
  throw error;
}
```

### Registrar un Evento

```typescript
import { logEvent, AnalyticsEvent } from '../lib/firebase-service';

await logEvent(AnalyticsEvent.PAYMENT_CAPTURED, {
  provider: 'bold',
  amount: 100000,
  currency: 'COP',
  payment_id: 'pay_123',
});
```

### Registrar Evento de Pago

```typescript
import { logPaymentEvent, AnalyticsEvent } from '../lib/firebase-service';

await logPaymentEvent(
  AnalyticsEvent.PAYMENT_CAPTURED,
  'bold',
  100000,
  'COP',
  {
    payment_id: 'pay_123',
    order_id: 'order_456',
  }
);
```

---

## ⚠️ Notas Importantes

1. **Desarrollo**: En `NODE_ENV=development`, los errores y eventos solo se loguean en consola, no se envían a Firebase.

2. **No Bloqueante**: Si Firebase falla, la aplicación continúa funcionando normalmente. Los errores de Firebase se loguean pero no afectan el flujo.

3. **Privacidad**: No se envían datos sensibles (números de tarjeta, passwords, etc.) a Firebase. Solo IDs y metadatos.

4. **Cloud Logging**: Firebase Admin SDK usa Cloud Logging. Los eventos aparecen en [Cloud Logging](https://console.cloud.google.com/logs), no directamente en Firebase Analytics.

5. **Costos**: Firebase tiene límites gratuitos generosos. Revisa la documentación de Firebase para más detalles.

---

## 🔗 Referencias

- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Firebase Crashlytics](https://firebase.google.com/docs/crashlytics)
- [Cloud Logging](https://console.cloud.google.com/logs?project=tu-project-id)
- [Cloud Logging Query Syntax](https://cloud.google.com/logging/docs/view/logging-query-language)

