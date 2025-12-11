const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');

// Check if .medusa/server exists - if not, build process failed
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  throw new Error('.medusa/server directory not found. This indicates the Medusa build process failed. Please check for build errors.');
}

// Copy pnpm-lock.yaml
fs.copyFileSync(
  path.join(process.cwd(), 'pnpm-lock.yaml'),
  path.join(MEDUSA_SERVER_PATH, 'pnpm-lock.yaml')
);

// Copy .env if it exists
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.copyFileSync(
    envPath,
    path.join(MEDUSA_SERVER_PATH, '.env')
  );
}

// Install dependencies
console.log('Installing dependencies in .medusa/server...');
execSync('pnpm i --prod --frozen-lockfile', { 
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit'
});

// Check notification service health
function checkNotificationServiceHealth() {
  // Load .env file if it exists to get NOTIFICATION_SERVICE_URL
  const envPath = path.join(process.cwd(), '.env');
  let notificationServiceUrl = 'http://localhost:8080';
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n');
    for (const line of envLines) {
      if (line.startsWith('NOTIFICATION_SERVICE_URL=')) {
        notificationServiceUrl = line.split('=')[1].trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
  }
  
  // Also check process.env (may be set by the build system)
  notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL || notificationServiceUrl;
  
  const healthUrl = `${notificationServiceUrl}/health`;
  
  console.log(`\n🔍 Checking notification service health at ${healthUrl}...`);
  
  return new Promise((resolve) => {
    try {
      const url = new URL(healthUrl);
      const client = url.protocol === 'https:' ? https : http;
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: 5000, // 5 second timeout
      };

      const req = client.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              if (response.status === 'ok' && response.service === 'notification-service') {
                console.log(`✅ Notification service health check passed`);
                resolve(true);
              } else {
                console.warn(`⚠️ Notification service health check: Invalid response format`, response);
                resolve(false);
              }
            } catch (error) {
              console.warn(`⚠️ Notification service health check: Failed to parse response`, error.message);
              resolve(false);
            }
          } else {
            console.warn(`⚠️ Notification service health check failed: HTTP ${res.statusCode}`);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.warn(`⚠️ Notification service health check failed: ${error.message}`);
        console.warn(`   This is not critical - the backend will still start, but notifications may not work.`);
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        console.warn(`⚠️ Notification service health check timed out`);
        console.warn(`   This is not critical - the backend will still start, but notifications may not work.`);
        resolve(false);
      });

      req.end();
    } catch (error) {
      console.warn(`⚠️ Notification service health check failed: ${error.message}`);
      console.warn(`   This is not critical - the backend will still start.`);
      resolve(false);
    }
  });
}

// Run health check (non-blocking - won't fail the build)
// Use setImmediate to ensure it runs after the build completes
setImmediate(() => {
  checkNotificationServiceHealth().catch((error) => {
    console.warn(`⚠️ Error during notification service health check:`, error.message);
    console.warn(`   This is not critical - the backend will still start.`);
  });
});
