import { createClient, RedisClientType } from "redis";
import { REDIS_URL, DATABASE_URL } from "./constants";
import { Modules } from "@medusajs/framework/utils";
import { reportError, ErrorCategory, logEvent, AnalyticsEvent } from "./firebase-service";

/**
 * Interface para el resultado de pago almacenado en el buffer
 */
export interface PaymentResult {
  cart_id: string;
  status: "approved" | "rejected" | "failed";
  transaction_id: string;
  provider: "wompi" | "bold" | "addi";
  amount: number;
  currency: string;
  metadata?: Record<string, any>;
  timestamp: string;
  webhook_received_at: string;
}

/**
 * Interface para errores de pago guardados en metadata del carrito
 */
export interface PaymentError {
  status: string;
  provider: string;
  message: string;
  transaction_id: string;
  timestamp: string;
}

/**
 * TTL para resultados en buffer: 30 minutos (1800 segundos)
 */
const BUFFER_TTL_SECONDS = 1800;

/**
 * Crea la tabla pending_payment_results si no existe
 * Se ejecuta automáticamente la primera vez que se usa PostgreSQL
 */
async function ensureTableExists(): Promise<void> {
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_payment_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cart_id VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL,
        transaction_id VARCHAR(255) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        amount INTEGER,
        currency VARCHAR(10),
        metadata JSONB,
        webhook_received_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Crear índices si no existen
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_payment_results_cart_id 
      ON pending_payment_results(cart_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_payment_results_expires_at 
      ON pending_payment_results(expires_at)
    `);

    await pool.end();
    console.log("✅ pending_payment_results table ensured");
  } catch (error) {
    console.error("Error ensuring pending_payment_results table:", error);
    // No lanzar error, solo loguear
  }
}

/**
 * Cliente Redis singleton
 */
let redisClient: RedisClientType | null = null;
let redisConnected = false;

/**
 * Inicializa el cliente Redis si está disponible
 */
async function getRedisClient(): Promise<RedisClientType | null> {
  if (!REDIS_URL) {
    return null;
  }

  if (redisClient && redisConnected) {
    return redisClient;
  }

  try {
    const client = createClient({
      url: REDIS_URL,
    });

    client.on("error", (err) => {
      console.error("Redis Client Error:", err);
      redisConnected = false;
      
      // Reportar error de Redis
      reportError(
        err instanceof Error ? err : new Error(String(err)),
        ErrorCategory.REDIS,
        { action: 'redis_connection_error' }
      ).catch(() => {
        // Ignorar errores de reporte
      });
    });

    client.on("connect", () => {
      console.log("Redis Client Connected");
      redisConnected = true;
    });

    await client.connect();
    redisClient = client as RedisClientType;
    redisConnected = true;
    return redisClient;
  } catch (error) {
    console.warn("Failed to connect to Redis, will use PostgreSQL fallback:", error);
    redisConnected = false;
    return null;
  }
}

/**
 * Guarda un resultado de pago en el buffer
 * Usa Redis si está disponible, sino PostgreSQL
 */
export async function savePaymentResult(
  cartId: string,
  result: Omit<PaymentResult, "cart_id" | "timestamp" | "webhook_received_at">
): Promise<void> {
  const paymentResult: PaymentResult = {
    ...result,
    cart_id: cartId,
    timestamp: new Date().toISOString(),
    webhook_received_at: new Date().toISOString(),
  };

  // Intentar usar Redis primero
  const redis = await getRedisClient();
  if (redis) {
    try {
      const key = `payment_result:${cartId}`;
      await redis.setEx(key, BUFFER_TTL_SECONDS, JSON.stringify(paymentResult));
      console.log(`✅ Payment result saved to Redis buffer for cart: ${cartId}`);
      return;
    } catch (error) {
      console.error("Error saving to Redis, falling back to PostgreSQL:", error);
      // Continuar con fallback a PostgreSQL
    }
  }

  // Fallback a PostgreSQL
  try {
    // Asegurar que la tabla existe
    await ensureTableExists();

    // Usar query directo a PostgreSQL
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO pending_payment_results 
       (cart_id, status, transaction_id, provider, amount, currency, metadata, webhook_received_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '30 minutes')
       ON CONFLICT (cart_id) DO UPDATE SET
         status = EXCLUDED.status,
         transaction_id = EXCLUDED.transaction_id,
         provider = EXCLUDED.provider,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         metadata = EXCLUDED.metadata,
         webhook_received_at = EXCLUDED.webhook_received_at,
         expires_at = NOW() + INTERVAL '30 minutes'`,
      [
        cartId,
        paymentResult.status,
        paymentResult.transaction_id,
        paymentResult.provider,
        paymentResult.amount,
        paymentResult.currency,
        JSON.stringify(paymentResult.metadata || {}),
        paymentResult.webhook_received_at,
      ]
    );

    await pool.end();
    console.log(`✅ Payment result saved to PostgreSQL buffer for cart: ${cartId}`);
    
    // Log evento de buffer guardado
    await logEvent(AnalyticsEvent.PAYMENT_BUFFER_SAVED, {
      cart_id: cartId,
      provider: paymentResult.provider,
      status: paymentResult.status,
      storage: 'postgresql',
    });
  } catch (error) {
    console.error("Error saving payment result to PostgreSQL:", error);
    
    await reportError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorCategory.DATABASE,
      {
        cart_id: cartId,
        provider: paymentResult.provider,
        action: 'save_payment_buffer',
      }
    );
    
    throw error;
  }
}

/**
 * Obtiene un resultado de pago del buffer
 * Retorna null si no existe o ha expirado
 */
export async function getPaymentResult(cartId: string): Promise<PaymentResult | null> {
  // Intentar usar Redis primero
  const redis = await getRedisClient();
  if (redis) {
    try {
      const key = `payment_result:${cartId}`;
      const data = await redis.get(key);
      if (data && typeof data === "string") {
        const result = JSON.parse(data) as PaymentResult;
        console.log(`✅ Payment result retrieved from Redis buffer for cart: ${cartId}`);
        return result;
      }
      return null;
    } catch (error) {
      console.error("Error reading from Redis, falling back to PostgreSQL:", error);
      // Continuar con fallback a PostgreSQL
    }
  }

  // Fallback a PostgreSQL
  try {
    // Asegurar que la tabla existe
    await ensureTableExists();

    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL });

    const result = await pool.query(
      `SELECT * FROM pending_payment_results 
       WHERE cart_id = $1 AND expires_at > NOW()`,
      [cartId]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const paymentResult: PaymentResult = {
      cart_id: row.cart_id,
      status: row.status,
      transaction_id: row.transaction_id,
      provider: row.provider,
      amount: row.amount,
      currency: row.currency,
      metadata: row.metadata || {},
      timestamp: row.created_at.toISOString(),
      webhook_received_at: row.webhook_received_at.toISOString(),
    };

    console.log(`✅ Payment result retrieved from PostgreSQL buffer for cart: ${cartId}`);
    return paymentResult;
  } catch (error) {
    console.error("Error reading payment result from PostgreSQL:", error);
    return null;
  }
}

/**
 * Limpia un resultado de pago del buffer después de procesarlo
 */
export async function clearPaymentResult(cartId: string): Promise<void> {
  // Intentar usar Redis primero
  const redis = await getRedisClient();
  if (redis) {
    try {
      const key = `payment_result:${cartId}`;
      await redis.del(key);
      console.log(`✅ Payment result cleared from Redis buffer for cart: ${cartId}`);
      return;
    } catch (error) {
      console.error("Error clearing from Redis, falling back to PostgreSQL:", error);
      // Continuar con fallback a PostgreSQL
    }
  }

  // Fallback a PostgreSQL
  try {
    // Asegurar que la tabla existe
    await ensureTableExists();

    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `UPDATE pending_payment_results 
       SET processed_at = NOW() 
       WHERE cart_id = $1`,
      [cartId]
    );

    await pool.end();
    console.log(`✅ Payment result cleared from PostgreSQL buffer for cart: ${cartId}`);
  } catch (error) {
    console.error("Error clearing payment result from PostgreSQL:", error);
    // No lanzar error, solo loguear
  }
}

/**
 * Guarda un error de pago en la metadata del carrito
 */
export async function savePaymentError(
  cartId: string,
  error: Omit<PaymentError, "timestamp">,
  cartModule?: any
): Promise<void> {
  const paymentError: PaymentError = {
    ...error,
    timestamp: new Date().toISOString(),
  };

  try {
    // Si se proporciona el módulo de cart, usarlo directamente
    if (cartModule) {
      const cart = await cartModule.retrieveCart(cartId);
      await cartModule.updateCarts([
        {
          id: cartId,
          metadata: {
            ...cart.metadata,
            payment_error: paymentError,
          },
        },
      ]);
      console.log(`✅ Payment error saved to cart metadata for cart: ${cartId}`);
      return;
    }

    // Fallback: usar query directo a PostgreSQL
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: DATABASE_URL });

    // Obtener metadata actual del carrito
    const cartResult = await pool.query(
      `SELECT metadata FROM cart WHERE id = $1`,
      [cartId]
    );

    if (cartResult.rows.length === 0) {
      throw new Error(`Cart not found: ${cartId}`);
    }

    const currentMetadata = cartResult.rows[0].metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      payment_error: paymentError,
    };

    await pool.query(
      `UPDATE cart SET metadata = $1 WHERE id = $2`,
      [JSON.stringify(updatedMetadata), cartId]
    );

    await pool.end();
    console.log(`✅ Payment error saved to cart metadata for cart: ${cartId}`);
  } catch (error) {
    console.error("Error saving payment error to cart metadata:", error);
    throw error;
  }
}

/**
 * Cierra la conexión Redis si está abierta
 * Útil para cleanup en tests o shutdown
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient && redisConnected) {
    try {
      await redisClient.quit();
      redisConnected = false;
      redisClient = null;
      console.log("Redis connection closed");
    } catch (error) {
      console.error("Error closing Redis connection:", error);
    }
  }
}

