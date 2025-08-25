/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  FinishReason,
  FunctionCall,
  ToolListUnion,
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';

export interface OllamaConfig {
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * Ollama-based content generator that implements the ContentGenerator interface
 * to provide local LLM functionality through Ollama's REST API
 */
export class OllamaContentGenerator implements ContentGenerator {
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.defaultModel = config.defaultModel || 'llama3.2';
  }

  /**
   * Converts Gemini Content format to Ollama chat messages format
   */
  private convertToOllamaMessages(contents: Content[]): any[] {
    return contents.map(content => {
      const role = content.role === 'model' ? 'assistant' : content.role;
      
      // Handle function calls and responses in parts
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      
      if (content.parts) {
        for (const part of content.parts) {
          if ('text' in part && part.text) {
            textParts.push(part.text);
          } else if ('functionCall' in part && part.functionCall) {
            // Convert Gemini function call to Ollama tool call format
            toolCalls.push({
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {})
              }
            });
          } else if ('functionResponse' in part && part.functionResponse) {
            // Function responses are handled as tool messages in Ollama
            return {
              role: 'tool',
              content: JSON.stringify(part.functionResponse.response)
            };
          }
        }
      }
      
      const message: any = {
        role,
        content: textParts.join('\n') || ''
      };
      
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }
      
      return message;
    });
  }

  /**
   * Converts Gemini function declarations to Ollama tools format
   */
  private convertToolsToOllamaFormat(tools: ToolListUnion): any[] {
    const ollamaTools: any[] = [];
    
    for (const tool of tools) {
      // Handle Tool type (has functionDeclarations)
      if ('functionDeclarations' in tool && tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          ollamaTools.push({
            type: 'function',
            function: {
              name: func.name,
              description: func.description || '',
              parameters: func.parameters || {
                type: 'object',
                properties: {},
                required: []
              }
            }
          });
        }
      }
      // Handle CallableTool type (has invoke method)
      else if ('invoke' in tool) {
        // For callable tools, we need to extract the function declaration
        // This would typically be done via the tool's metadata
        // For now, we'll create a generic function declaration
        const toolName = tool.constructor?.name || 'unknownTool';
        ollamaTools.push({
          type: 'function',
          function: {
            name: toolName,
            description: `Callable tool: ${toolName}`,
            parameters: {
              type: 'object',
              properties: {
                args: {
                  type: 'object',
                  description: 'Arguments for the tool'
                }
              },
              required: []
            }
          }
        });
      }
    }
    
    return ollamaTools;
  }

  /**
   * Converts Ollama response with tool calls back to Gemini format
   */
  private convertOllamaResponseToGemini(ollamaResponse: any): GenerateContentResponse {
    const message = ollamaResponse.message || {};
    const parts: Part[] = [];
    const functionCalls: FunctionCall[] = [];
    
    // Add text content if present
    if (message.content) {
      parts.push({ text: message.content });
    }
    
    // Add function calls if present
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function) {
          const functionCall: FunctionCall = {
            name: toolCall.function.name,
            args: {}
          };
          
          // Handle arguments - can be object or string
          if (toolCall.function.arguments) {
            if (typeof toolCall.function.arguments === 'string') {
              try {
                functionCall.args = JSON.parse(toolCall.function.arguments);
              } catch (e) {
                // If parsing fails, use the raw string
                functionCall.args = { arguments: toolCall.function.arguments };
              }
            } else {
              // Arguments are already an object
              functionCall.args = toolCall.function.arguments;
            }
          }
          
          parts.push({ functionCall });
          functionCalls.push(functionCall);
        }
      }
    }
    
    const response = {
      candidates: [{
        content: {
          parts,
          role: 'model'
        },
        finishReason: ollamaResponse.done ? 'STOP' as FinishReason : undefined,
        index: 0,
        safetyRatings: []
      }],
      promptFeedback: {
        safetyRatings: []
      }
    } as unknown as GenerateContentResponse;
    
    // Set functionCalls property that Turn class expects
    if (functionCalls.length > 0) {
      (response as any).functionCalls = functionCalls;
    }
    
    return response;
  }

  /**
   * Converts Gemini Parts to text content for Ollama
   */
  private convertPartsToText(parts: Part[] | undefined): string {
    if (!parts) return '';
    return parts.map(part => {
      if ('text' in part && part.text) {
        return part.text;
      }
      if ('functionCall' in part && part.functionCall) {
        // Convert function calls to text representation for non-tool contexts
        return `[Function Call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})]`;
      }
      if ('functionResponse' in part && part.functionResponse) {
        // Convert function responses to text representation
        return `[Function Response: ${JSON.stringify(part.functionResponse.response)}]`;
      }
      return '[Unsupported content type]';
    }).join('\n');
  }


  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const model = request.model || this.defaultModel;
    const contents = Array.isArray(request.contents) ? 
      request.contents.filter((c): c is Content => typeof c === 'object' && c !== null && 'role' in c) : 
      (typeof request.contents === 'string' ? [{ role: 'user', parts: [{ text: request.contents }] }] as Content[] : [request.contents as Content]);
    const messages = this.convertToOllamaMessages(contents);
    
    const ollamaRequest: any = {
      model,
      messages,
      stream: false,
      options: {
        temperature: request.config?.temperature || 0.7,
        top_p: request.config?.topP || 1.0,
        top_k: request.config?.topK || 40,
      }
    };

    // Add tools if provided
    if (request.config?.tools && request.config.tools.length > 0) {
      ollamaRequest.tools = this.convertToolsToOllamaFormat(request.config.tools);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaRequest),
        signal: request.config?.abortSignal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const ollamaResponse = await response.json();
      return this.convertOllamaResponseToGemini(ollamaResponse);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      throw new Error(`Failed to generate content with Ollama: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const self = this;
    return (async function* () {
      const model = request.model || self.defaultModel;
      const contents = Array.isArray(request.contents) ? 
        request.contents.filter((c): c is Content => typeof c === 'object' && c !== null && 'role' in c) : 
        (typeof request.contents === 'string' ? [{ role: 'user', parts: [{ text: request.contents }] }] as Content[] : [request.contents as Content]);
      const messages = self.convertToOllamaMessages(contents);
      
      const ollamaRequest: any = {
        model,
        messages,
        stream: true,
        options: {
          temperature: request.config?.temperature || 0.7,
          top_p: request.config?.topP || 1.0,
          top_k: request.config?.topK || 40,
        }
      };

      // Add tools if provided
      if (request.config?.tools && request.config.tools.length > 0) {
        ollamaRequest.tools = self.convertToolsToOllamaFormat(request.config.tools);
      }

      try {
        const response = await fetch(`${self.baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(ollamaRequest),
          signal: request.config?.abortSignal,
        });

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine) {
                try {
                  const ollamaResponse = JSON.parse(trimmedLine);
                  if (ollamaResponse.message?.content || ollamaResponse.message?.tool_calls || ollamaResponse.response) {
                    yield self.convertOllamaResponseToGemini(ollamaResponse);
                  }
                } catch (parseError) {
                  // Skip invalid JSON lines
                  continue;
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        throw new Error(`Failed to stream content with Ollama: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    })();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Ollama doesn't have a direct token counting API
    // We'll estimate tokens by converting content to text and using a rough approximation
    const contents = Array.isArray(request.contents) ? 
      request.contents.filter((c): c is Content => typeof c === 'object' && c !== null && 'role' in c) : 
      (typeof request.contents === 'string' ? [{ role: 'user', parts: [{ text: request.contents }] }] as Content[] : [request.contents as Content]);
    const text = contents.map((content: Content) => 
      this.convertPartsToText(content.parts)
    ).join('\n');
    
    // Rough estimation: ~4 characters per token (this varies by model and language)
    const estimatedTokens = Math.ceil(text.length / 4);
    
    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // Ollama has an embeddings endpoint at /api/embeddings
    const model = request.model || 'nomic-embed-text';
    const texts = Array.isArray(request.contents) ? request.contents : [request.contents];
    
    const embeddings = [];
    
    for (const text of texts) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt: typeof text === 'string' ? text : JSON.stringify(text),
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama embeddings API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        embeddings.push({
          values: result.embedding || []
        });
      } catch (error) {
        throw new Error(`Failed to generate embeddings with Ollama: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return { embeddings };
  }

  // Optional: Add method to check if Ollama is running
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // Optional: Get list of available models
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.warn('Failed to fetch available models from Ollama:', error);
      return [this.defaultModel];
    }
  }
}