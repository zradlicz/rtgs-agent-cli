/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, MessageActionReturn, SlashCommand } from './types.js';
import { AuthType } from '@google/gemini-cli-core';


// Helper functions to interact with Ollama API
async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    return data.models?.map((model: any) => model.name) || [];
  } catch (error) {
    console.warn('Failed to fetch available models from Ollama:', error);
    return [];
  }
}

async function checkOllamaHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'Select from available Ollama models',
  kind: CommandKind.BUILT_IN,
  completion: async (context, partialArg): Promise<string[]> => {
    const { config } = context.services;
    
    if (!config) {
      return [];
    }

    // Check if using Ollama
    const contentGeneratorConfig = config.getContentGeneratorConfig();
    if (contentGeneratorConfig?.authType !== AuthType.USE_OLLAMA) {
      return [];
    }

    try {
      const baseUrl = contentGeneratorConfig.ollamaBaseUrl || 'http://localhost:11434';

      // Check if Ollama is healthy
      const isHealthy = await checkOllamaHealth(baseUrl);
      if (!isHealthy) {
        return [];
      }

      // Fetch available models
      const models = await fetchOllamaModels(baseUrl);
      
      // Filter models based on partial argument
      return models.filter(model => 
        model.toLowerCase().includes(partialArg.toLowerCase())
      );

    } catch (error) {
      return [];
    }
  },
  action: async (context, args): Promise<MessageActionReturn> => {
    const { config } = context.services;
    
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available'
      };
    }

    // Check if using Ollama
    const contentGeneratorConfig = config.getContentGeneratorConfig();
    if (contentGeneratorConfig?.authType !== AuthType.USE_OLLAMA) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Models command is only available when using Ollama. Switch to Ollama with `/auth` command first.'
      };
    }

    try {
      const baseUrl = contentGeneratorConfig.ollamaBaseUrl || 'http://localhost:11434';

      // Check if Ollama is healthy
      const isHealthy = await checkOllamaHealth(baseUrl);
      if (!isHealthy) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Cannot connect to Ollama. Please ensure Ollama is running and accessible.'
        };
      }

      // Fetch available models
      const models = await fetchOllamaModels(baseUrl);
      if (models.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: 'No models found in Ollama. Please pull a model first with `ollama pull <model-name>`.'
        };
      }

      const requestedModel = args.trim();
      
      // If a model was specified, try to switch to it
      if (requestedModel) {
        if (!models.includes(requestedModel)) {
          const modelList = models.map(model => `• ${model}`).join('\n');
          return {
            type: 'message',
            messageType: 'error',
            content: `Model "${requestedModel}" not found. Available models:\n\n${modelList}\n\nPull the model first with: ollama pull ${requestedModel}`
          };
        }

        // Switch to the requested model
        config.setModel(requestedModel);
        
        return {
          type: 'message',
          messageType: 'info',
          content: `Switched to model: ${requestedModel}`
        };
      }

      // No model specified, show available models
      const currentModel = config.getModel();
      
      // Format model list with current model highlighted
      const modelList = models.map(model => 
        model === currentModel ? `• ${model} (current)` : `• ${model}`
      ).join('\n');

      return {
        type: 'message',
        messageType: 'info',
        content: `Available Ollama models:\n\n${modelList}\n\nTo switch models, use: /models <model-name>\nExample: /models llama3.2`
      };

    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
};