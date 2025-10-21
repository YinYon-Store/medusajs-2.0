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
  WOMPI_ENVIRONMENT
} from 'lib/constants';

loadEnv(process.env.NODE_ENV, process.cwd());

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

  // Payment module - COD and Wompi only
  const paymentProviders = [];
  
  // Cash on Delivery provider
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

  // Wompi provider
  if (WOMPI_ENABLED) {
    paymentProviders.push({
      resolve: './src/modules/providers/wompi-payment',
      id: 'wompi',
      options: {
        enabled: WOMPI_ENABLED,
        publicKey: WOMPI_PUBLIC_KEY,
        privateKey: WOMPI_PRIVATE_KEY,
        environment: WOMPI_ENVIRONMENT
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

  return modules;
}

// Helper function to build plugins array
function buildPlugins() {
  const plugins = [];

  // Meilisearch plugin
  if (MEILISEARCH_HOST && MEILISEARCH_ADMIN_KEY) {
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
  }

  return plugins;
}

const medusaConfig = {
  projectConfig: {
    databaseUrl: DATABASE_URL,
    databaseLogging: false,
    redisUrl: REDIS_URL,
    workerMode: WORKER_MODE,
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