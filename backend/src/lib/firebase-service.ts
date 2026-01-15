import * as admin from 'firebase-admin';
import {
  FIREBASE_ENABLED,
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_SERVICE_ACCOUNT_PATH,
  FIREBASE_SERVICE_ACCOUNT_JSON,
  IS_DEV,
} from './constants';

/**
 * Firebase Service
 * 
 * Proporciona servicios de Crashlytics y Analytics para el backend de Medusa.
 * 
 * Funcionalidades:
 * - Crashlytics: Reporte de errores y excepciones
 * - Analytics: Tracking de eventos de negocio
 */

let firebaseApp: admin.app.App | null = null;
let isInitialized = false;

/**
 * Inicializa Firebase Admin SDK
 */
function initializeFirebase(): void {
  if (isInitialized && firebaseApp) {
    return;
  }

  if (!FIREBASE_ENABLED) {
    return;
  }

  try {
    // Si ya existe una app, no inicializar de nuevo
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
      isInitialized = true;
      return;
    }

    let credential: admin.ServiceAccount;

    // Opción 1: Usar JSON string desde variable de entorno (recomendado para local y producción)
    if (FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        credential = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
      } catch (error) {
        console.error('[Firebase] Error parsing service account JSON:', error);
        return;
      }
    }
    // Opción 2: Usar archivo de service account (fallback para desarrollo local)
    else if (FIREBASE_SERVICE_ACCOUNT_PATH) {
      try {
        // Resolver ruta absoluta desde el directorio raíz del proyecto
        const path = require('path');
        const fs = require('fs');
        
        // Si es ruta relativa, resolver desde process.cwd()
        const absolutePath = path.isAbsolute(FIREBASE_SERVICE_ACCOUNT_PATH)
          ? FIREBASE_SERVICE_ACCOUNT_PATH
          : path.resolve(process.cwd(), FIREBASE_SERVICE_ACCOUNT_PATH);
        
        // Verificar que el archivo existe
        if (!fs.existsSync(absolutePath)) {
          console.error(`[Firebase] File not found: ${absolutePath}`);
          return;
        }
        
        // Leer y parsear el archivo JSON
        const fileContent = fs.readFileSync(absolutePath, 'utf8');
        credential = JSON.parse(fileContent);
      } catch (error) {
        console.error('[Firebase] Error reading credentials file:', error);
        return;
      }
    }
    // Opción 3: Usar credenciales individuales (fallback)
    else if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
      credential = {
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY,
      };
    } else {
      console.warn('[Firebase] Configuration missing');
      return;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(credential as admin.ServiceAccount),
      projectId: credential.projectId,
    });

    isInitialized = true;
  } catch (error) {
    console.error('[Firebase] Initialization error:', error);
    firebaseApp = null;
    isInitialized = false;
  }
}

/**
 * Obtiene la instancia de Firebase App
 */
function getFirebaseApp(): admin.app.App | null {
  if (!FIREBASE_ENABLED) {
    return null;
  }

  if (!isInitialized) {
    initializeFirebase();
  }

  return firebaseApp;
}

/**
 * Tipos de errores para categorización en Crashlytics
 */
export enum ErrorCategory {
  PAYMENT = 'payment',
  WEBHOOK = 'webhook',
  DATABASE = 'database',
  REDIS = 'redis',
  S3 = 's3',
  SEARCH = 'search',
  NOTIFICATION = 'notification',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  RATE_LIMIT = 'rate_limit',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

/**
 * Contexto adicional para errores
 */
export interface ErrorContext {
  userId?: string;
  cartId?: string;
  orderId?: string;
  paymentProvider?: string;
  transactionId?: string;
  endpoint?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
  [key: string]: any;
}

/**
 * Tags predefinidos para identificar el origen de los errores
 */
export const ErrorTags = {
  SOURCE: {
    BACKEND: 'backend',
    FRONTEND: 'frontend',
    API: 'api',
    WEBHOOK: 'webhook',
    WORKER: 'worker',
  },
  ENVIRONMENT: {
    PRODUCTION: 'production',
    STAGING: 'staging',
    DEVELOPMENT: 'development',
  },
  SERVICE: {
    PAYMENT: 'payment',
    ORDER: 'order',
    SEARCH: 'search',
    NOTIFICATION: 'notification',
    DATABASE: 'database',
    CACHE: 'cache',
    STORAGE: 'storage',
  },
} as const;

/**
 * Reporta un error a Firebase Crashlytics
 */
export async function reportError(
  error: Error | string,
  category: ErrorCategory = ErrorCategory.UNKNOWN,
  context?: ErrorContext
): Promise<void> {
  if (!FIREBASE_ENABLED) {
    return;
  }

  const app = getFirebaseApp();
  if (!app) {
    return;
  }

  try {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    const environment = process.env.NODE_ENV === 'production' 
      ? ErrorTags.ENVIRONMENT.PRODUCTION 
      : process.env.NODE_ENV === 'staging'
      ? ErrorTags.ENVIRONMENT.STAGING
      : ErrorTags.ENVIRONMENT.DEVELOPMENT;

    const enrichedContext = {
      source: ErrorTags.SOURCE.BACKEND,
      environment,
      service_type: ErrorTags.SOURCE.API,
      category,
      error_type: error instanceof Error ? error.constructor.name : 'String',
      stack: errorStack,
      ...context,
      timestamp: new Date().toISOString(),
      node_version: process.version,
      platform: process.platform,
    };

    if (IS_DEV) {
      console.error(`[Crashlytics] [${category}] ${errorMessage}`, context);
    } else {
      console.error(`[Crashlytics] ${errorMessage}`, enrichedContext);
    }
  } catch (err) {
    console.error('[Firebase] Error reporting to Crashlytics:', err);
  }
}

/**
 * Tipos de eventos de negocio para Analytics
 */
export enum AnalyticsEvent {
  // Eventos de pago
  PAYMENT_INITIATED = 'payment_initiated',
  PAYMENT_APPROVED = 'payment_approved',
  PAYMENT_REJECTED = 'payment_rejected',
  PAYMENT_PENDING = 'payment_pending',
  PAYMENT_CAPTURED = 'payment_captured',
  PAYMENT_CANCELLED = 'payment_cancelled',

  // Eventos de webhook
  WEBHOOK_RECEIVED = 'webhook_received',
  WEBHOOK_PROCESSED = 'webhook_processed',
  WEBHOOK_FAILED = 'webhook_failed',
  WEBHOOK_VALIDATION_FAILED = 'webhook_validation_failed',

  // Eventos de orden
  ORDER_CREATED = 'order_created',
  ORDER_UPDATED = 'order_updated',
  ORDER_COMPLETED = 'order_completed',

  // Eventos de búsqueda
  SEARCH_PERFORMED = 'search_performed',
  SEARCH_FAILED = 'search_failed',

  // Eventos de carrito
  CART_CREATED = 'cart_created',
  CART_UPDATED = 'cart_updated',
  CART_ABANDONED = 'cart_abandoned',

  // Eventos de buffer
  PAYMENT_BUFFER_SAVED = 'payment_buffer_saved',
  PAYMENT_BUFFER_RETRIEVED = 'payment_buffer_retrieved',
  PAYMENT_BUFFER_CLEARED = 'payment_buffer_cleared',

  // Eventos de notificación
  NOTIFICATION_SENT = 'notification_sent',
  NOTIFICATION_FAILED = 'notification_failed',

  // Eventos de rate limiting
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',

  // Eventos de timeout
  REQUEST_TIMEOUT = 'request_timeout',
}

/**
 * Parámetros para eventos de Analytics
 */
export interface AnalyticsParams {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Registra un evento en Firebase Analytics
 */
export async function logEvent(
  eventName: AnalyticsEvent | string,
  params?: AnalyticsParams
): Promise<void> {
  if (!FIREBASE_ENABLED) {
    return;
  }

  const app = getFirebaseApp();
  if (!app) {
    return;
  }

  try {
    const environment = process.env.NODE_ENV === 'production' 
      ? ErrorTags.ENVIRONMENT.PRODUCTION 
      : process.env.NODE_ENV === 'staging'
      ? ErrorTags.ENVIRONMENT.STAGING
      : ErrorTags.ENVIRONMENT.DEVELOPMENT;

    const enrichedParams = {
      source: ErrorTags.SOURCE.BACKEND,
      environment,
      service_type: ErrorTags.SOURCE.API,
      ...params,
      timestamp: new Date().toISOString(),
    };

    if (IS_DEV) {
      console.log(`[Analytics] ${eventName}`, params);
    } else {
      console.log('[Analytics]', {
        event_name: eventName,
        ...enrichedParams,
      });
    }
  } catch (err) {
    console.error('[Firebase] Error logging Analytics event:', err);
  }
}

/**
 * Registra un evento de pago
 */
export async function logPaymentEvent(
  event: AnalyticsEvent.PAYMENT_INITIATED | AnalyticsEvent.PAYMENT_APPROVED | AnalyticsEvent.PAYMENT_REJECTED | AnalyticsEvent.PAYMENT_PENDING | AnalyticsEvent.PAYMENT_CAPTURED | AnalyticsEvent.PAYMENT_CANCELLED,
  provider: string,
  amount: number,
  currency: string,
  additionalParams?: AnalyticsParams
): Promise<void> {
  await logEvent(event, {
    payment_provider: provider,
    amount,
    currency,
    ...additionalParams,
  });
}

/**
 * Registra un evento de webhook
 */
export async function logWebhookEvent(
  event: AnalyticsEvent.WEBHOOK_RECEIVED | AnalyticsEvent.WEBHOOK_PROCESSED | AnalyticsEvent.WEBHOOK_FAILED | AnalyticsEvent.WEBHOOK_VALIDATION_FAILED,
  provider: string,
  additionalParams?: AnalyticsParams
): Promise<void> {
  await logEvent(event, {
    webhook_provider: provider,
    ...additionalParams,
  });
}

/**
 * Registra un evento de búsqueda
 */
export async function logSearchEvent(
  event: AnalyticsEvent.SEARCH_PERFORMED | AnalyticsEvent.SEARCH_FAILED,
  query: string,
  resultsCount?: number,
  processingTimeMs?: number,
  additionalParams?: AnalyticsParams
): Promise<void> {
  await logEvent(event, {
    search_query: query,
    results_count: resultsCount,
    processing_time_ms: processingTimeMs,
    ...additionalParams,
  });
}

/**
 * Wrapper para manejar errores y reportarlos automáticamente
 */
export async function withErrorReporting<T>(
  fn: () => Promise<T>,
  category: ErrorCategory,
  context?: ErrorContext
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await reportError(
      error instanceof Error ? error : new Error(String(error)),
      category,
      context
    );
    throw error;
  }
}

/**
 * Inicializa Firebase al importar el módulo
 */
initializeFirebase();

