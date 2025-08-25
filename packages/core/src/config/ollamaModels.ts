/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_OLLAMA_MODEL = 'llama3.2';
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Popular Ollama models and their characteristics
 */
export const OLLAMA_MODELS = {
  // Llama models
  'llama3.2': { size: '3B', description: 'Latest Llama 3.2 model, good for general use' },
  'llama3.2:1b': { size: '1B', description: 'Smaller Llama 3.2 model, faster inference' },
  'llama3.1': { size: '8B', description: 'Llama 3.1 model with good reasoning capabilities' },
  'llama3.1:70b': { size: '70B', description: 'Large Llama 3.1 model, highest quality' },
  
  // Code-focused models
  'codellama': { size: '7B', description: 'Code generation and understanding' },
  'codellama:13b': { size: '13B', description: 'Larger Code Llama for better performance' },
  'codegemma': { size: '7B', description: 'Google CodeGemma for code tasks' },
  'deepseek-coder': { size: '6.7B', description: 'DeepSeek Coder for programming tasks' },
  
  // Gemma models (Google's open models)
  'gemma2': { size: '9B', description: 'Google Gemma 2 model' },
  'gemma2:27b': { size: '27B', description: 'Larger Gemma 2 model' },
  
  // Other popular models
  'mistral': { size: '7B', description: 'Mistral 7B model' },
  'mistral-nemo': { size: '12B', description: 'Mistral Nemo model' },
  'qwen2.5': { size: '7B', description: 'Qwen 2.5 model from Alibaba' },
  'phi3': { size: '3.8B', description: 'Microsoft Phi-3 model, compact and efficient' },
  
  // Embedding models
  'nomic-embed-text': { size: '137M', description: 'Text embedding model' },
  'all-minilm': { size: '23M', description: 'Sentence embedding model' },
} as const;

export type OllamaModelName = keyof typeof OLLAMA_MODELS;

/**
 * Check if a model is suitable for code tasks
 */
export function isCodeModel(model: string): boolean {
  return model.includes('code') || model.includes('gemma') || model.includes('deepseek-coder');
}

/**
 * Get recommended model based on use case
 */
export function getRecommendedModel(useCase: 'general' | 'code' | 'fast' | 'quality'): string {
  switch (useCase) {
    case 'code':
      return 'codellama';
    case 'fast':
      return 'llama3.2:1b';
    case 'quality':
      return 'llama3.1:70b';
    case 'general':
    default:
      return DEFAULT_OLLAMA_MODEL;
  }
}