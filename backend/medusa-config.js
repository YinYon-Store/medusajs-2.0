import { loadEnv, Modules, defineConfig } from '@medusajs/utils';
import {
  ADMIN_CORS,
  AUTH_CORS,
  BACKEND_URL,
  COOKIE_SECRET,
  DATABASE_URL,
  JWT_SECRET,
  REDIS_URL,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  SENDGRID_API_KEY,
  SENDGRID_FROM_EMAIL,
  SHOULD_DISABLE_ADMIN,
  STORE_CORS,
  WORKER_MODE,
  S3_FILE_URL,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_REGION,
  S3_BUCKET,
  S3_ENDPOINT,
  MEILISEARCH_HOST,
  MEILISEARCH_ADMIN_KEY,
  COD_ENABLED,
  COD_DESCRIPTION,
  WOMPI_ENABLED,
  WOMPI_PUBLIC_KEY,
  WOMPI_PRIVATE_KEY,
  WOMPI_ENVIRONMENT,
  BOLD_ENABLED,
  BOLD_IDENTITY_KEY,
  BOLD_SECRET_KEY,
  BOLD_ENVIRONMENT,
  ADDI_ENABLED,
  ADDI_CLIENT_ID,
  ADDI_CLIENT_SECRET,
  ADDI_ALLY_SLUG,
  ADDI_ENVIRONMENT,
  ADDI_REDIRECT_URL,
  ADDI_CALLBACK_URL,
  ADDI_LOGO_URL,
  ADDI_AUTH_URL,
  ADDI_API_URL,
  ADDI_CONFIG_URL,
  ADDI_AUDIENCE,
  PAYMENT_ENV,
  IS_PAYMENT_PROD,
  NOTIFICATION_SERVICE_URL,
  NOTIFICATION_API_KEY
} from 'lib/constants';

// Log payment environment on startup
console.log(`💳 Payment Environment: ${PAYMENT_ENV} (${IS_PAYMENT_PROD ? 'PRODUCTION' : 'STAGING'})`);

loadEnv(process.env.NODE_ENV, process.cwd());

/**
 * Check notification service health on startup
 * This function can be called or commented out as needed
 */
async function checkNotificationServiceHealth() {
  const notificationServiceUrl = NOTIFICATION_SERVICE_URL;
  const healthUrl = `${notificationServiceUrl}/health`;
  
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (response.ok) {
      const data = await response.json();
      if (data.status === 'ok' && data.service === 'notification-service') {
        console.log(`✅ Notification Service: Connected (${notificationServiceUrl})`);
      } else {
        console.log(`⚠️  Notification Service: Invalid response from ${notificationServiceUrl}`);
      }
    } else {
      console.log(`⚠️  Notification Service: Health check failed (HTTP ${response.status}) - ${notificationServiceUrl}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`⚠️  Notification Service: Connection timeout - ${notificationServiceUrl}`);
    } else {
      console.log(`⚠️  Notification Service: Not available - ${notificationServiceUrl}`);
    }
    if (NOTIFICATION_API_KEY) {
      console.log(`   Notifications will be skipped until service is available.`);
    }
  }
}

// Uncomment the line below to enable notification service health check on startup
// checkNotificationServiceHealth();

// Helper function to build modules array
function buildModules() {
  const modules = [];

  // S3 File storage module
  modules.push({
    key: Modules.FILE,
    resolve: '@medusajs/file',
    options: {
      providers: [
        {
          resolve: "./src/modules/s3-file",
          id: "s3-compatible",
          options: {
            endPoint: S3_ENDPOINT?.replace('https://', '') || 's3.us-east-2.amazonaws.com',
            accessKey: S3_ACCESS_KEY_ID,
            secretKey: S3_SECRET_ACCESS_KEY,
            bucket: S3_BUCKET,
            region: S3_REGION || 'us-east-2',
          },
        },
      ],
    }
  });

  // Promotion module (para descuentos automáticos y cupones)
  modules.push({
    key: Modules.PROMOTION,
    resolve: "@medusajs/promotion",
    options: {
      // puedes dejar vacío o definir reglas avanzadas si usas workflows
    }
  });

  // Pricing module (para cálculo de precios con promociones)
  modules.push({
    key: Modules.PRICING,
    resolve: "@medusajs/pricing",
    options: {
      // deja vacío si usas la configuración por defecto
    }
  });

  // Redis modules (Event Bus and Workflow Engine)
  if (REDIS_URL) {
    modules.push({
      key: Modules.EVENT_BUS,
      resolve: '@medusajs/event-bus-redis',
      options: {
        redisUrl: REDIS_URL
      }
    });

    modules.push({
      key: Modules.WORKFLOW_ENGINE,
      resolve: '@medusajs/workflow-engine-redis',
      options: {
        redis: {
          url: REDIS_URL,
        }
      }
    });
  }

  // Notification module
  const hasSendgrid = SENDGRID_API_KEY && SENDGRID_FROM_EMAIL;
  const hasResend = RESEND_API_KEY && RESEND_FROM_EMAIL;

  if (hasSendgrid || hasResend) {
    const notificationProviders = [];

    if (hasSendgrid) {
      notificationProviders.push({
        resolve: '@medusajs/notification-sendgrid',
        id: 'sendgrid',
        options: {
          channels: ['email', 'feed'],
          api_key: SENDGRID_API_KEY,
          from: SENDGRID_FROM_EMAIL,
        }
      });
    }

    if (hasResend) {
      notificationProviders.push({
        resolve: './src/modules/email-notifications',
        id: 'resend',
        options: {
          channels: ['email', 'feed'],
          api_key: RESEND_API_KEY,
          from: RESEND_FROM_EMAIL,
        },
      });
    }

    modules.push({
      key: Modules.NOTIFICATION,
      resolve: '@medusajs/notification',
      options: {
        providers: notificationProviders
      }
    });
  }

  // Payment module - Bold only
  const paymentProviders = [];

  // Cash on Delivery provider - DISABLED
  if (COD_ENABLED) {
    paymentProviders.push({
      resolve: './src/modules/providers/cod-payment',
      id: 'contra_entrega',
      options: {
        enabled: COD_ENABLED,
        description: COD_DESCRIPTION
      },
    });
  }

  // Wompi provider - DISABLED
  // if (WOMPI_ENABLED) {
  //   paymentProviders.push({
  //     resolve: './src/modules/providers/wompi-payment',
  //     id: 'wompi',
  //     options: {
  //       enabled: WOMPI_ENABLED,
  //       publicKey: WOMPI_PUBLIC_KEY,
  //       privateKey: WOMPI_PRIVATE_KEY,
  //       environment: WOMPI_ENVIRONMENT
  //     },
  //   });
  // }

  // Bold provider - ENABLED
  if (BOLD_ENABLED) {
    paymentProviders.push({
      resolve: './src/modules/providers/bold-payment',
      id: 'bold',
      options: {
        enabled: BOLD_ENABLED,
        secretKey: BOLD_SECRET_KEY,
        identityKey: BOLD_IDENTITY_KEY,
        environment: BOLD_ENVIRONMENT
      },
    });
  }

  // ADDI provider (Buy Now Pay Later) - ENABLED
  if (ADDI_ENABLED) {
    paymentProviders.push({
      resolve: './src/modules/providers/addi-payment',
      id: 'addi',
      options: {
        enabled: ADDI_ENABLED,
        clientId: ADDI_CLIENT_ID,
        clientSecret: ADDI_CLIENT_SECRET,
        allySlug: ADDI_ALLY_SLUG,
        environment: ADDI_ENVIRONMENT,
        redirectUrl: ADDI_REDIRECT_URL,
        callbackUrl: ADDI_CALLBACK_URL,
        logoUrl: ADDI_LOGO_URL,
        authUrl: ADDI_AUTH_URL,
        apiUrl: ADDI_API_URL,
        configUrl: ADDI_CONFIG_URL,
        audience: ADDI_AUDIENCE
      },
    });
  }

  // Add payment module if we have any providers
  if (paymentProviders.length > 0) {
    modules.push({
      key: Modules.PAYMENT,
      resolve: '@medusajs/payment',
      options: {
        providers: paymentProviders,
      },
    });
  }

  // Fulfillment module with providers
  modules.push({
    key: Modules.FULFILLMENT,
    resolve: '@medusajs/fulfillment',
    options: {
      providers: [
        // default provider
        {
          resolve: './src/modules/providers/local-fulfillment',
          id: 'local-fulfillment',
          options: {
          },
        },
      ],
    },
  });

  return modules;
}

// Helper function to build plugins array
function buildPlugins() {
  const plugins = [];

  // Meilisearch plugin
  // Skip loading if MEILISEARCH_DISABLED is set to 'true' to allow server to start when Meilisearch is unavailable
  const meilisearchDisabled = process.env.MEILISEARCH_DISABLED === 'true';
  
  if (!meilisearchDisabled && MEILISEARCH_HOST && MEILISEARCH_ADMIN_KEY) {
    plugins.push({
      resolve: '@rokmohar/medusa-plugin-meilisearch',
      options: {
        config: {
          host: MEILISEARCH_HOST,
          apiKey: MEILISEARCH_ADMIN_KEY
        },
        settings: {
          products: {
            type: 'products',
            enabled: true,
            fields: ['id', 'title', 'description', 'handle', 'thumbnail'],
            indexSettings: {
              searchableAttributes: ['title', 'description'],
              displayedAttributes: ['id', 'handle', 'title', 'description', 'thumbnail'],
              filterableAttributes: ['id', 'handle'],
            },
            primaryKey: 'id',
          }
        }
      }
    });
  } else if (meilisearchDisabled) {
    console.log('⚠️  Meilisearch plugin is disabled (MEILISEARCH_DISABLED=true). Search functionality will be limited.');
  }

  return plugins;
}

const medusaConfig = {
  projectConfig: {
    databaseUrl: DATABASE_URL,
    databaseLogging: false,
    redisUrl: REDIS_URL,
    workerMode: process.env.MEDUSA_WORKER_MODE,
    http: {
      adminCors: ADMIN_CORS,
      authCors: AUTH_CORS,
      storeCors: STORE_CORS,
      jwtSecret: JWT_SECRET,
      cookieSecret: COOKIE_SECRET
    },
    build: {
      rollupOptions: {
        external: ["@medusajs/dashboard"]
      }
    }
  },
  admin: {
    backendUrl: BACKEND_URL,
    disable: SHOULD_DISABLE_ADMIN,
  },
  modules: buildModules(),
  plugins: buildPlugins()
};

export default defineConfig(medusaConfig);