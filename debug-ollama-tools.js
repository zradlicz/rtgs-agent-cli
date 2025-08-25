#!/usr/bin/env node

/**
 * Debug script to test if Ollama is actually making function calls
 */

async function testOllamaToolCall() {
  const baseUrl = 'http://localhost:11434';
  const model = 'qwen3:4b';
  
  const messages = [
    {
      role: 'user', 
      content: 'Can you search the web for information about precision ADCs?'
    }
  ];
  
  const tools = [
    {
      type: 'function',
      function: {
        name: 'google_web_search',
        description: 'Performs a web search using Google Search via the Gemini API',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      }
    }
  ];
  
  const ollamaRequest = {
    model,
    messages,
    tools,
    stream: false,
    options: {
      temperature: 0.7
    }
  };
  
  console.log('🔵 Sending request to Ollama:');
  console.log(JSON.stringify(ollamaRequest, null, 2));
  console.log('\n' + '='.repeat(80) + '\n');
  
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    
    const ollamaResponse = await response.json();
    
    console.log('🟢 Raw Ollama response:');
    console.log(JSON.stringify(ollamaResponse, null, 2));
    
    console.log('\n' + '='.repeat(80) + '\n');
    
    // Check what we got back
    const message = ollamaResponse.message || {};
    
    console.log('🔍 Analysis:');
    console.log('- Has message.content:', !!message.content);
    console.log('- Has message.tool_calls:', !!message.tool_calls);
    console.log('- tool_calls type:', typeof message.tool_calls);
    console.log('- tool_calls length:', Array.isArray(message.tool_calls) ? message.tool_calls.length : 'N/A');
    
    if (message.content) {
      console.log('- Content preview:', message.content.substring(0, 200) + '...');
    }
    
    if (message.tool_calls) {
      console.log('- Tool calls:', JSON.stringify(message.tool_calls, null, 2));
    } else {
      console.log('❌ No tool_calls found in response - Ollama may not support function calling with this model');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testOllamaToolCall();