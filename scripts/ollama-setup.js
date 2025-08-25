#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Script to set up gemini-cli to work with Ollama
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3:4b';

console.log('🦙 Setting up Gemini CLI to work with Ollama...\n');

// Check if Ollama is running
async function checkOllamaRunning() {
  console.log('Checking if Ollama is running...');
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (response.ok) {
      console.log('✅ Ollama is running');
      return true;
    }
  } catch (error) {
    console.log('❌ Ollama is not running or not accessible');
    console.log(`   Expected at: ${OLLAMA_HOST}`);
    console.log('   Please make sure Ollama is installed and running:');
    console.log('   - Install: https://ollama.ai/download');
    console.log('   - Run: ollama serve');
    return false;
  }
}

// Check if model is available
async function checkModel(modelName) {
  console.log(`Checking if model '${modelName}' is available...`);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    const data = await response.json();
    const models = data.models || [];
    const hasModel = models.some(model => model.name.includes(modelName));
    
    if (hasModel) {
      console.log(`✅ Model '${modelName}' is available`);
      return true;
    } else {
      console.log(`❌ Model '${modelName}' not found`);
      console.log('   Available models:');
      models.forEach(model => {
        console.log(`   - ${model.name}`);
      });
      console.log(`\n   To download the model, run: ollama pull ${modelName}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Failed to check model: ${error.message}`);
    return false;
  }
}

// Create or update environment file
function setupEnvironment() {
  console.log('Setting up environment...');
  
  const envContent = `# Ollama Configuration for Gemini CLI
# This configures the CLI to use Ollama instead of Google's APIs

# Set authentication type to Ollama (bypasses Google auth)
GEMINI_AUTH_TYPE=ollama

# Default model to use (change this to your preferred model)
GEMINI_MODEL=${DEFAULT_MODEL}

# Ollama server URL
OLLAMA_HOST=${OLLAMA_HOST}

# Embedding model for semantic search features
GEMINI_EMBEDDING_MODEL=nomic-embed-text

# Disable telemetry for privacy in local usage
GEMINI_USAGE_STATISTICS_ENABLED=false

# Optional: Set default auth type for the UI
GEMINI_DEFAULT_AUTH_TYPE=ollama
`;

  const envFile = '.env.ollama';
  writeFileSync(envFile, envContent);
  console.log(`✅ Created ${envFile} with Ollama configuration`);
  console.log('   To use this configuration: source .env.ollama');
}

// Create a simple start script
function createStartScript() {
  console.log('Creating start script...');
  
  const scriptContent = `#!/bin/bash
# Start Gemini CLI with Ollama

# Load Ollama environment
source .env.ollama

# Set auth type to Ollama
export GEMINI_AUTH_TYPE=ollama

echo "🦙 Starting Gemini CLI with Ollama..."
echo "Model: $GEMINI_MODEL"
echo "Ollama Host: $OLLAMA_HOST"
echo ""

# Start the CLI
npm run start
`;

  writeFileSync('start-ollama.sh', scriptContent);
  
  // Make script executable on Unix systems
  try {
    spawn('chmod', ['+x', 'start-ollama.sh']);
  } catch (error) {
    // Ignore on Windows
  }
  
  console.log('✅ Created start-ollama.sh script');
  console.log('   To run: ./start-ollama.sh');
}

// Update package.json with Ollama script
function updatePackageJson() {
  console.log('Adding Ollama script to package.json...');
  
  try {
    const packageJsonPath = 'package.json';
    if (!existsSync(packageJsonPath)) {
      console.log('⚠️  package.json not found, skipping script addition');
      return;
    }
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    
    packageJson.scripts['start:ollama'] = 'source .env.ollama && GEMINI_AUTH_TYPE=ollama npm run start';
    
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Added "start:ollama" script to package.json');
    console.log('   To run: npm run start:ollama');
  } catch (error) {
    console.log('⚠️  Failed to update package.json:', error.message);
  }
}

// Main setup function
async function main() {
  const isRunning = await checkOllamaRunning();
  if (!isRunning) {
    console.log('\n⚠️  Please start Ollama first, then run this script again.');
    process.exit(1);
  }
  
  const hasModel = await checkModel(DEFAULT_MODEL);
  if (!hasModel) {
    console.log(`\n⚠️  Please install the model first: ollama pull ${DEFAULT_MODEL}`);
    process.exit(1);
  }
  
  setupEnvironment();
  createStartScript();
  updatePackageJson();
  
  console.log('\n🎉 Setup complete!');
  console.log('\nNext steps:');
  console.log('1. Run: source .env.ollama');
  console.log('2. Start the CLI: ./start-ollama.sh or npm run start:ollama');
  console.log('\nYour Gemini CLI fork is now ready to use with Ollama! 🦙');
}

main().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});