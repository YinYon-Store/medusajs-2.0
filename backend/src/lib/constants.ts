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
 * Worker mode
 */
export const WORKER_MODE =
  (process.env.MEDUSA_WORKER_MODE as 'worker' | 'server' | 'shared' | undefined) ?? 'shared'

/**
 * Disable Admin
 */
export const SHOULD_DISABLE_ADMIN = process.env.MEDUSA_DISABLE_ADMIN === 'true'

// ============================================================================
// PAYMENT PROVIDERS CONFIGURATION
// ============================================================================

/**
 * Global payment environment flag: "STAGING" or "PROD"
 * This determines which set of credentials to use for all payment providers
 */
export const PAYMENT_ENV = (process.env.PAYMENT_ENV || 'STAGING').toUpperCase() as 'STAGING' | 'PROD';
export const IS_PAYMENT_PROD = PAYMENT_ENV === 'PROD';

/**
 * Cash on Delivery (COD) payment configuration
 * COD doesn't need environment-specific credentials
 */
export const COD_ENABLED = process.env.COD_ENABLED !== 'false'; // Enabled by default
export const COD_DESCRIPTION = process.env.COD_DESCRIPTION || 'Pago contra entrega al recibir el producto';

/**
 * Wompi payment configuration
 * Uses WOMPI_STAGING_* or WOMPI_PROD_* based on PAYMENT_ENV
 */
export const WOMPI_ENABLED = process.env.WOMPI_ENABLED !== 'false'; // Enabled by default

// Staging credentials
const WOMPI_STAGING_PUBLIC_KEY = process.env.WOMPI_STAGING_PUBLIC_KEY;
const WOMPI_STAGING_PRIVATE_KEY = process.env.WOMPI_STAGING_PRIVATE_KEY;
const WOMPI_STAGING_INTEGRITY_KEY = process.env.WOMPI_STAGING_INTEGRITY_KEY;
const WOMPI_STAGING_EVENTS_SECRET = process.env.WOMPI_STAGING_EVENTS_SECRET;

// Production credentials
const WOMPI_PROD_PUBLIC_KEY = process.env.WOMPI_PROD_PUBLIC_KEY;
const WOMPI_PROD_PRIVATE_KEY = process.env.WOMPI_PROD_PRIVATE_KEY;
const WOMPI_PROD_INTEGRITY_KEY = process.env.WOMPI_PROD_INTEGRITY_KEY;
const WOMPI_PROD_EVENTS_SECRET = process.env.WOMPI_PROD_EVENTS_SECRET;

// Export based on PAYMENT_ENV
export const WOMPI_PUBLIC_KEY = IS_PAYMENT_PROD ? WOMPI_PROD_PUBLIC_KEY : WOMPI_STAGING_PUBLIC_KEY;
export const WOMPI_PRIVATE_KEY = IS_PAYMENT_PROD ? WOMPI_PROD_PRIVATE_KEY : WOMPI_STAGING_PRIVATE_KEY;
export const WOMPI_INTEGRITY_KEY = IS_PAYMENT_PROD ? WOMPI_PROD_INTEGRITY_KEY : WOMPI_STAGING_INTEGRITY_KEY;
export const WOMPI_EVENTS_SECRET = IS_PAYMENT_PROD ? WOMPI_PROD_EVENTS_SECRET : WOMPI_STAGING_EVENTS_SECRET;
export const WOMPI_ENVIRONMENT = IS_PAYMENT_PROD ? 'prod' : 'sandbox';
export const WOMPI_REDIRECT_URL = process.env.WOMPI_REDIRECT_URL;

/**
 * Bold payment configuration
 * Uses BOLD_STAGING_* or BOLD_PROD_* based on PAYMENT_ENV
 */
export const BOLD_ENABLED = process.env.BOLD_ENABLED !== 'false'; // Enabled by default

// Staging credentials
const BOLD_STAGING_IDENTITY_KEY = process.env.BOLD_STAGING_IDENTITY_KEY;
const BOLD_STAGING_SECRET_KEY = process.env.BOLD_STAGING_SECRET_KEY;

// Production credentials
const BOLD_PROD_IDENTITY_KEY = process.env.BOLD_PROD_IDENTITY_KEY;
const BOLD_PROD_SECRET_KEY = process.env.BOLD_PROD_SECRET_KEY;

// Export based on PAYMENT_ENV
export const BOLD_IDENTITY_KEY = IS_PAYMENT_PROD ? BOLD_PROD_IDENTITY_KEY : BOLD_STAGING_IDENTITY_KEY;
export const BOLD_SECRET_KEY = IS_PAYMENT_PROD ? BOLD_PROD_SECRET_KEY : BOLD_STAGING_SECRET_KEY;
export const BOLD_ENVIRONMENT = IS_PAYMENT_PROD ? 'prod' : 'sandbox';
export const BOLD_REDIRECT_URL = process.env.BOLD_REDIRECT_URL;

/**
 * ADDI payment configuration (Buy Now Pay Later)
 * Uses ADDI_STAGING_* or ADDI_PROD_* based on PAYMENT_ENV
 */
export const ADDI_ENABLED = process.env.ADDI_ENABLED === 'true'; // Disabled by default

// Staging credentials and URLs
const ADDI_STAGING_CLIENT_ID = process.env.ADDI_STAGING_CLIENT_ID;
const ADDI_STAGING_CLIENT_SECRET = process.env.ADDI_STAGING_CLIENT_SECRET;
const ADDI_STAGING_ALLY_SLUG = process.env.ADDI_STAGING_ALLY_SLUG || 'inversionesauracolombia-ecommerce';
const ADDI_STAGING_AUTH_URL = process.env.ADDI_STAGING_AUTH_URL || 'https://auth.addi-staging.com/oauth/token';
const ADDI_STAGING_API_URL = process.env.ADDI_STAGING_API_URL || 'https://api.addi-staging.com';
const ADDI_STAGING_CONFIG_URL = process.env.ADDI_STAGING_CONFIG_URL || 'https://channels-public-api.addi.com';
const ADDI_STAGING_AUDIENCE = process.env.ADDI_STAGING_AUDIENCE || 'https://api.staging.addi.com';

// Production credentials and URLs
const ADDI_PROD_CLIENT_ID = process.env.ADDI_PROD_CLIENT_ID;
const ADDI_PROD_CLIENT_SECRET = process.env.ADDI_PROD_CLIENT_SECRET;
const ADDI_PROD_ALLY_SLUG = process.env.ADDI_PROD_ALLY_SLUG || 'inversionesauracolombia-ecommerce';
const ADDI_PROD_AUTH_URL = process.env.ADDI_PROD_AUTH_URL || 'https://auth.addi.com/oauth/token';
const ADDI_PROD_API_URL = process.env.ADDI_PROD_API_URL || 'https://api.addi.com';
const ADDI_PROD_CONFIG_URL = process.env.ADDI_PROD_CONFIG_URL || 'https://channels-public-api.addi.com';
const ADDI_PROD_AUDIENCE = process.env.ADDI_PROD_AUDIENCE || 'https://api.addi.com';

// Export based on PAYMENT_ENV
export const ADDI_CLIENT_ID = IS_PAYMENT_PROD ? ADDI_PROD_CLIENT_ID : ADDI_STAGING_CLIENT_ID;
export const ADDI_CLIENT_SECRET = IS_PAYMENT_PROD ? ADDI_PROD_CLIENT_SECRET : ADDI_STAGING_CLIENT_SECRET;
export const ADDI_ALLY_SLUG = IS_PAYMENT_PROD ? ADDI_PROD_ALLY_SLUG : ADDI_STAGING_ALLY_SLUG;
export const ADDI_AUTH_URL = IS_PAYMENT_PROD ? ADDI_PROD_AUTH_URL : ADDI_STAGING_AUTH_URL;
export const ADDI_API_URL = IS_PAYMENT_PROD ? ADDI_PROD_API_URL : ADDI_STAGING_API_URL;
export const ADDI_CONFIG_URL = IS_PAYMENT_PROD ? ADDI_PROD_CONFIG_URL : ADDI_STAGING_CONFIG_URL;
export const ADDI_AUDIENCE = IS_PAYMENT_PROD ? ADDI_PROD_AUDIENCE : ADDI_STAGING_AUDIENCE;
export const ADDI_ENVIRONMENT = IS_PAYMENT_PROD ? 'production' : 'staging';
export const ADDI_REDIRECT_URL = process.env.ADDI_REDIRECT_URL;
export const ADDI_CALLBACK_URL = process.env.ADDI_CALLBACK_URL;
export const ADDI_LOGO_URL = process.env.ADDI_LOGO_URL;

/**
 * ADDI Callback Authentication Credentials
 * These are used to validate incoming webhook calls from ADDI
 * ADDI sends these credentials via HTTP Basic Auth
 */
export const ADDI_CALLBACK_USERNAME = process.env.ADDI_CALLBACK_USERNAME || 'addi_callback';
export const ADDI_CALLBACK_PASSWORD = process.env.ADDI_CALLBACK_PASSWORD;

/**
 * Publishable API Key for internal store API calls
 */
export const STORE_PUBLISHABLE_API_KEY = process.env.STORE_PUBLISHABLE_API_KEY;
