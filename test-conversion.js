#!/usr/bin/env node

/**
 * Test the conversion logic with actual Ollama response
 */

// Simulate the actual Ollama response we received
const ollamaResponse = {
  "model": "qwen3:4b",
  "created_at": "2025-08-25T17:15:06.780346323Z",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "google_web_search",
          "arguments": {
            "query": "precision ADCs"
          }
        }
      }
    ]
  },
  "done_reason": "stop",
  "done": true
};

// Test the conversion logic
function convertOllamaResponseToGemini(ollamaResponse) {
  const message = ollamaResponse.message || {};
  const parts = [];
  const functionCalls = [];
  
  // Add text content if present
  if (message.content) {
    parts.push({ text: message.content });
  }
  
  // Add function calls if present
  if (message.tool_calls && Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.function) {
        const functionCall = {
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
      finishReason: ollamaResponse.done ? 'STOP' : undefined,
      index: 0,
      safetyRatings: []
    }],
    promptFeedback: {
      safetyRatings: []
    }
  };
  
  // Set functionCalls property that Turn class expects
  if (functionCalls.length > 0) {
    response.functionCalls = functionCalls;
  }
  
  return response;
}

console.log('🔵 Input Ollama Response:');
console.log(JSON.stringify(ollamaResponse, null, 2));

console.log('\n' + '='.repeat(80) + '\n');

const geminiResponse = convertOllamaResponseToGemini(ollamaResponse);

console.log('🟢 Converted Gemini Response:');
console.log(JSON.stringify(geminiResponse, null, 2));

console.log('\n' + '='.repeat(80) + '\n');

console.log('🔍 Analysis:');
console.log('- Has response.functionCalls:', !!geminiResponse.functionCalls);
console.log('- functionCalls length:', geminiResponse.functionCalls ? geminiResponse.functionCalls.length : 0);
console.log('- First function call:', geminiResponse.functionCalls ? geminiResponse.functionCalls[0] : 'None');
console.log('- Has parts with functionCall:', geminiResponse.candidates[0].content.parts.some(p => p.functionCall));