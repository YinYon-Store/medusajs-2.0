import { loadEnv } from '@medusajs/framework/utils'

import { assertValue } from 'utils/assert-value'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Is development environment
 */
export const IS_DEV = process.env.NODE_ENV === 'development'

/**
 * Public URL for the backend
 */
export const BACKEND_URL = process.env.BACKEND_PUBLIC_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN_VALUE ?? 'http://localhost:9000'

/**
 * Database URL for Postgres instance used by the backend
 */
export const DATABASE_URL = assertValue(
  process.env.DATABASE_URL,
  'Environment variable for DATABASE_URL is not set',
)

/**
 * (optional) Redis URL for Redis instance used by the backend
 */
export const REDIS_URL = process.env.REDIS_URL;

/**
 * Admin CORS origins
 */
export const ADMIN_CORS = process.env.ADMIN_CORS;

/**
 * Auth CORS origins
 */
export const AUTH_CORS = process.env.AUTH_CORS;

/**
 * Store/frontend CORS origins
 */
export const STORE_CORS = process.env.STORE_CORS;

/**
 * JWT Secret used for signing JWT tokens
 */
export const JWT_SECRET = assertValue(
  process.env.JWT_SECRET,
  'Environment variable for JWT_SECRET is not set',
)

/**
 * Cookie secret used for signing cookies
 */
export const COOKIE_SECRET = assertValue(
  process.env.COOKIE_SECRET,
  'Environment variable for COOKIE_SECRET is not set',
)

/**
 * (optional) S3 configuration for file storage
 * Note: S3_ENDPOINT must include protocol (https://)
 * Example: S3_ENDPOINT=https://s3.amazonaws.com
 */
export const S3_FILE_URL = process.env.S3_FILE_URL;
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
export const S3_REGION = process.env.S3_REGION;
export const S3_BUCKET = process.env.S3_BUCKET;
export const S3_ENDPOINT = process.env.S3_ENDPOINT;

/**
 * (optional) Minio configuration for file storage
 */
export const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
export const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
export const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const MINIO_BUCKET = process.env.MINIO_BUCKET; // Optional, if not set bucket will be called: medusa-media

/**
 * (optional) Resend API Key and from Email - do not set if using SendGrid
 */
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM;

/**
 * (optionl) SendGrid API Key and from Email - do not set if using Resend
 */
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
export const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM;

/**
 * (optional) Stripe API key and webhook secret
 */
export const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * (optional) Meilisearch configuration
 */
export const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST;
export const MEILISEARCH_ADMIN_KEY = process.env.MEILISEARCH_ADMIN_KEY;

/**
 * Cash on Delivery (COD) payment configuration
 */
export const COD_ENABLED = process.env.COD_ENABLED !== 'false'; // Enabled by default
export const COD_DESCRIPTION = process.env.COD_DESCRIPTION || 'Pago contra entrega al recibir el producto';

/**
 * Wompi payment configuration
 */
export const WOMPI_ENABLED = process.env.WOMPI_ENABLED !== 'false'; // Enabled by default
export const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
export const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY;
export const WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY;
export const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;
export const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET;
export const WOMPI_ENVIRONMENT = process.env.WOMPI_ENVIRONMENT || 'sandbox';
export const WOMPI_REDIRECT_URL = process.env.WOMPI_REDIRECT_URL;

/**
 * Worker mode
 */
export const WORKER_MODE =
  (process.env.MEDUSA_WORKER_MODE as 'worker' | 'server' | 'shared' | undefined) ?? 'shared'

/**
 * Disable Admin
 */
export const SHOULD_DISABLE_ADMIN = process.env.MEDUSA_DISABLE_ADMIN === 'true'

/**
 * Bold payment configuration
 */
export const BOLD_ENABLED = process.env.BOLD_ENABLED !== 'false'; // Enabled by default
export const BOLD_IDENTITY_KEY = process.env.BOLD_IDENTITY_KEY;
export const BOLD_SECRET_KEY = process.env.BOLD_SECRET_KEY;
export const BOLD_ENVIRONMENT = process.env.BOLD_ENVIRONMENT || 'sandbox';
export const BOLD_REDIRECT_URL = process.env.BOLD_REDIRECT_URL;
