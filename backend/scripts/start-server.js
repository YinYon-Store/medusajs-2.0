#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');

// Check if .medusa/server exists, if not, run build first
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  console.log('⚠️  .medusa/server directory not found. Running build first...');
  try {
    execSync('pnpm build', { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Verify it exists now
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  console.error('❌ .medusa/server directory still not found after build');
  process.exit(1);
}

// Run init-backend and start
console.log('✅ Starting server...');
try {
  execSync('init-backend', { stdio: 'inherit' });
  process.chdir(MEDUSA_SERVER_PATH);
  execSync('medusa start --verbose', { stdio: 'inherit' });
} catch (error) {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
}

