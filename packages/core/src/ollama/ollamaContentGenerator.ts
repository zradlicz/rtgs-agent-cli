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
                arguments: part.functionCall.args || {}
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
    
    // Check if structured JSON output is requested
    const isJsonOutputRequested = request.config?.responseMimeType === 'application/json' || 
                                 request.config?.responseJsonSchema !== undefined;
    
    let messages = this.convertToOllamaMessages(contents);
    
    // Add tool formatting instructions when tools are provided
    if (request.config?.tools && request.config.tools.length > 0) {
      messages = this.addToolInstructions(messages, request.config.tools);
    }
    
    // Add JSON formatting instructions for structured output
    if (isJsonOutputRequested) {
      messages = this.addJsonInstructions(messages, request.config?.responseJsonSchema);
    }
    
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
      let geminiResponse = this.convertOllamaResponseToGemini(ollamaResponse);
      
      // Post-process response for tool calls (always check for tools)
      geminiResponse = this.extractToolCallsFromResponse(geminiResponse);
      
      // Post-process response for JSON output if requested
      if (isJsonOutputRequested) {
        geminiResponse = this.extractJsonFromResponse(geminiResponse);
      }
      
      return geminiResponse;
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
      
      // Check if structured JSON output is requested
      const isJsonOutputRequested = request.config?.responseMimeType === 'application/json' || 
                                   request.config?.responseJsonSchema !== undefined;
      
      let messages = self.convertToOllamaMessages(contents);
      
      // Add tool formatting instructions when tools are provided
      if (request.config?.tools && request.config.tools.length > 0) {
        messages = self.addToolInstructions(messages, request.config.tools);
      }
      
      // Add JSON formatting instructions for structured output
      if (isJsonOutputRequested) {
        messages = self.addJsonInstructions(messages, request.config?.responseJsonSchema);
      }
      
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
        let accumulatedContent = ''; // For JSON and tool extraction

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
                    let geminiResponse = self.convertOllamaResponseToGemini(ollamaResponse);
                    
                    // Accumulate content for post-processing
                    const textContent = geminiResponse.candidates?.[0]?.content?.parts?.[0];
                    if (textContent && 'text' in textContent && textContent.text) {
                      accumulatedContent += textContent.text;
                    }
                    
                    yield geminiResponse;
                  }
                } catch (parseError) {
                  // Skip invalid JSON lines
                  continue;
                }
              }
            }
          }
          
          // Process accumulated content for tool calls and JSON if needed
          if (accumulatedContent.trim()) {
            const mockResponse = {
              candidates: [{
                content: {
                  parts: [{ text: accumulatedContent }],
                  role: 'model'
                },
                finishReason: 'STOP' as FinishReason,
                index: 0,
                safetyRatings: []
              }],
              promptFeedback: {
                safetyRatings: []
              }
            } as unknown as GenerateContentResponse;
            
            // Always process for tool calls first
            let processedResponse = self.extractToolCallsFromResponse(mockResponse);
            
            // Then process for JSON if requested
            if (isJsonOutputRequested) {
              processedResponse = self.extractJsonFromResponse(processedResponse);
            }
            
            // Yield the final processed response if it has meaningful content
            if (processedResponse.candidates?.[0]?.content?.parts?.length) {
              yield processedResponse;
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

  /**
   * Adds tool formatting instructions when tools are provided
   */
  private addToolInstructions(messages: any[], tools: ToolListUnion): any[] {
    const toolInstructions = this.createToolInstructions(tools);
    
    // Find existing system message or create one
    const systemMessageIndex = messages.findIndex(msg => msg.role === 'system');
    
    if (systemMessageIndex >= 0) {
      // Append to existing system message
      messages[systemMessageIndex].content += '\n\n' + toolInstructions;
    } else {
      // Add new system message at the beginning
      messages.unshift({
        role: 'system',
        content: toolInstructions
      });
    }
    
    return messages;
  }

  /**
   * Adds JSON formatting instructions to messages for structured output
   */
  private addJsonInstructions(messages: any[], schema?: unknown): any[] {
    const jsonInstructions = this.createJsonInstructions(schema);
    
    // Find existing system message or create one
    const systemMessageIndex = messages.findIndex(msg => msg.role === 'system');
    
    if (systemMessageIndex >= 0) {
      // Append to existing system message
      messages[systemMessageIndex].content += '\n\n' + jsonInstructions;
    } else {
      // Add new system message at the beginning
      messages.unshift({
        role: 'system',
        content: jsonInstructions
      });
    }
    
    return messages;
  }

  /**
   * Creates tool formatting instructions for available tools
   */
  private createToolInstructions(tools: ToolListUnion): string {
    const toolDescriptions = tools.map(tool => {
      if ('functionDeclaration' in tool && tool.functionDeclaration) {
        const func = tool.functionDeclaration as any; // Type assertion to handle complex union types
        const params = func.parameters ? JSON.stringify(func.parameters, null, 2) : '{}';
        return `- ${func.name}: ${func.description || 'No description'}\n  Parameters: ${params}`;
      }
      return `- Unknown tool type`;
    }).join('\n');

    return `You have access to the following tools. When you need to use a tool, format your tool calls EXACTLY as shown in the examples below:

Available Tools:
${toolDescriptions}

IMPORTANT: To use a tool, you must include tool calls in your response using this EXACT format:

<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

Examples based on the available tools:
${this.generateToolExamples(tools)}

You can include multiple tool calls in your response if needed. Always include proper reasoning for why you're using each tool.`;
  }

  /**
   * Generates realistic examples for each tool based on their schemas
   */
  private generateToolExamples(tools: ToolListUnion): string {
    const examples = tools.map(tool => {
      if ('functionDeclaration' in tool && tool.functionDeclaration) {
        const func = tool.functionDeclaration as any;
        const exampleArgs = this.generateExampleArgs(func.parameters, func.name);
        return `- ${func.description || func.name}: <tool_call>{"name": "${func.name}", "arguments": ${JSON.stringify(exampleArgs)}}</tool_call>`;
      }
      return '';
    }).filter(example => example.length > 0);
    
    return examples.join('\n');
  }

  /**
   * Generates example arguments based on parameter schema
   */
  private generateExampleArgs(parameters: any, toolName: string): Record<string, any> {
    if (!parameters || !parameters.properties) {
      return {};
    }

    const exampleArgs: Record<string, any> = {};
    
    // Generate examples based on common parameter names and types
    for (const [paramName, paramDef] of Object.entries(parameters.properties as Record<string, any>)) {
      if (paramName === 'absolute_path' || paramName === 'file_path') {
        exampleArgs[paramName] = '/path/to/file.txt';
      } else if (paramName === 'command') {
        exampleArgs[paramName] = 'ls -la';
      } else if (paramName === 'query') {
        exampleArgs[paramName] = 'search query';
      } else if (paramName === 'pattern') {
        exampleArgs[paramName] = '*.js';
      } else if (paramName === 'content') {
        exampleArgs[paramName] = 'file content';
      } else if (paramDef.type === 'string') {
        exampleArgs[paramName] = `example_${paramName}`;
      } else if (paramDef.type === 'number' || paramDef.type === 'integer') {
        exampleArgs[paramName] = 1;
      } else if (paramDef.type === 'boolean') {
        exampleArgs[paramName] = true;
      } else if (paramDef.type === 'array') {
        exampleArgs[paramName] = ['item1', 'item2'];
      } else {
        exampleArgs[paramName] = `example_${paramName}`;
      }
    }

    return exampleArgs;
  }

  /**
   * Creates JSON formatting instructions based on schema
   */
  private createJsonInstructions(schema?: unknown): string {
    let instructions = `IMPORTANT: You must respond with valid JSON only. Do not include any text before or after the JSON. Do not use thinking tags or explanations.

Format your response as a single JSON object. The JSON must be valid and parseable.`;

    if (schema) {
      instructions += `\n\nThe JSON must conform to this schema:\n${JSON.stringify(schema, null, 2)}`;
    }

    instructions += `\n\nExample format:
{"key": "value", "number": 123}

Remember: ONLY return the JSON, nothing else.`;

    return instructions;
  }

  /**
   * Extracts and processes tool calls from response text
   */
  private extractToolCallsFromResponse(response: GenerateContentResponse): GenerateContentResponse {
    if (!response.candidates?.[0]?.content?.parts?.[0]) {
      return response;
    }

    const part = response.candidates[0].content.parts[0];
    if (!('text' in part) || !part.text) {
      return response;
    }

    let text = part.text;
    const toolCalls: FunctionCall[] = [];
    const newParts: Part[] = [];

    // Extract tool calls using regex
    const toolCallRegex = /<tool_call>\s*(.*?)\s*<\/tool_call>/gs;
    let match;
    let lastIndex = 0;

    while ((match = toolCallRegex.exec(text)) !== null) {
      // Add text before the tool call
      const beforeText = text.slice(lastIndex, match.index).trim();
      if (beforeText) {
        newParts.push({ text: beforeText });
      }

      try {
        // Parse the tool call JSON
        const toolCallData = JSON.parse(match[1]);
        if (toolCallData.name && toolCallData.arguments) {
          const functionCall: FunctionCall = {
            name: toolCallData.name,
            args: toolCallData.arguments
          };
          toolCalls.push(functionCall);
          newParts.push({ functionCall });
        }
      } catch (error) {
        // If parsing fails, include the raw tool call as text
        newParts.push({ text: match[0] });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last tool call
    const remainingText = text.slice(lastIndex).trim();
    if (remainingText) {
      newParts.push({ text: remainingText });
    }

    // If no tool calls were found, return original response
    if (toolCalls.length === 0) {
      return response;
    }

    // Create updated response with extracted tool calls
    const updatedResponse = {
      ...response,
      candidates: [{
        ...response.candidates[0],
        content: {
          ...response.candidates[0].content,
          parts: newParts.length > 0 ? newParts : [{ text: '' }]
        }
      }]
    } as unknown as GenerateContentResponse;

    // Set functionCalls property that Turn class expects
    if (toolCalls.length > 0) {
      (updatedResponse as any).functionCalls = toolCalls;
    }

    return updatedResponse;
  }

  /**
   * Extracts clean JSON from the response, handling thinking tags and other text
   */
  private extractJsonFromResponse(response: GenerateContentResponse): GenerateContentResponse {
    if (!response.candidates?.[0]?.content?.parts?.[0]) {
      return response;
    }

    const part = response.candidates[0].content.parts[0];
    if (!('text' in part) || !part.text) {
      return response;
    }

    let text = part.text;

    // Remove thinking tags
    const thinkingTagRegex = /<think>[\s\S]*?<\/think>\s*/g;
    text = text.replace(thinkingTagRegex, '').trim();

    // Remove markdown code blocks if present
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const codeBlockMatch = text.match(codeBlockRegex);
    if (codeBlockMatch) {
      text = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    // Validate that it's valid JSON
    try {
      JSON.parse(text);
      // If parsing succeeds, update the response with clean JSON
      const updatedResponse = {
        ...response,
        candidates: [{
          ...response.candidates[0],
          content: {
            ...response.candidates[0].content,
            parts: [{ text }]
          }
        }]
      } as unknown as GenerateContentResponse;
      return updatedResponse;
    } catch (error) {
      // If JSON parsing fails, log warning but return original response
      console.warn('Failed to extract valid JSON from Ollama response:', text);
      return response;
    }
  }
}