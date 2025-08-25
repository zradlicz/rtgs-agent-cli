/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { loadEnvironment } from './settings.js';

async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const ollamaHost = process.env['OLLAMA_HOST'] || 'http://localhost:11434';
    const response = await fetch(`${ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  if (
    authMethod === AuthType.LOGIN_WITH_GOOGLE ||
    authMethod === AuthType.CLOUD_SHELL
  ) {
    return null;
  }

  if (authMethod === AuthType.USE_OLLAMA) {
    // We can't do async validation in this sync function, so we'll just check basic requirements
    return null; // Let the async validation happen later
  }

  if (authMethod === AuthType.LOGIN_WITH_GOOGLE_GCA) {
    if (!process.env['GOOGLE_CLOUD_PROJECT']) {
      return (
        '[Error] GOOGLE_CLOUD_PROJECT is not set.\n' +
        'Please set it using:\n' +
        '  export GOOGLE_CLOUD_PROJECT=<your-project-id>\n' +
        'and try again.'
      );
    }
    return null;
  }

  if (authMethod === AuthType.USE_GEMINI) {
    if (!process.env['GEMINI_API_KEY']) {
      return 'GEMINI_API_KEY environment variable not found. Add that to your environment and try again (no reload needed if using .env)!';
    }
    return null;
  }

  if (authMethod === AuthType.USE_VERTEX_AI) {
    const hasVertexProjectLocationConfig =
      !!process.env['GOOGLE_CLOUD_PROJECT'] &&
      !!process.env['GOOGLE_CLOUD_LOCATION'];
    const hasGoogleApiKey = !!process.env['GOOGLE_API_KEY'];
    if (!hasVertexProjectLocationConfig && !hasGoogleApiKey) {
      return (
        'When using Vertex AI, you must specify either:\n' +
        '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
        '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  return 'Invalid auth method selected.';
};

export const validateOllamaAuth = async (): Promise<string | null> => {
  const ollamaHost = process.env['OLLAMA_HOST'] || 'http://localhost:11434';
  
  const isAvailable = await checkOllamaAvailable();
  if (!isAvailable) {
    return (
      `❌ Ollama is not running or not accessible at ${ollamaHost}\n\n` +
      '💡 To use Ollama:\n' +
      '1. Install Ollama from https://ollama.ai/download\n' +
      '2. Start Ollama: ollama serve\n' +
      '3. Pull a model: ollama pull llama3.2\n' +
      '4. Try again'
    );
  }

  // Check if any models are available
  try {
    const response = await fetch(`${ollamaHost}/api/tags`);
    const data = await response.json();
    const models = data.models || [];
    
    if (models.length === 0) {
      return (
        '❌ No models found in Ollama\n\n' +
        '💡 Pull a model first:\n' +
        '• ollama pull llama3.2 (recommended)\n' +
        '• ollama pull codellama (for coding)\n' +
        '• ollama pull mistral (alternative)'
      );
    }
  } catch (error) {
    return `❌ Failed to check Ollama models: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  return null; // All good!
};
