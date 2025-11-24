/**
 * Universal Responder Node
 * 
 * Generates LLM responses using the universal node architecture.
 * Handles message building, streaming, and conversation context.
 */

import type { UniversalNodeConfig } from './universal/types';

export interface ResponderConfig {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export function createResponderNode(config: ResponderConfig = {}): UniversalNodeConfig {
  const {
    systemPrompt,
    temperature = 0.7,
    maxTokens = 16000,
    stream = true
  } = config;

  return {
    steps: [
      // Step 1: Build messages array (use existing or build from context)
      {
        type: 'transform',
        config: {
          operation: 'build-messages',
          outputField: 'messages',
          useExistingField: 'messages', // Try pre-built messages first
          messages: [
            // Fallback: build from context if pre-built messages don't exist
            { role: 'system', content: systemPrompt || '{{state.systemMessage}}' },
            { role: 'user', content: '{{state.query.message}}' }
          ]
        }
      },
      
      // Step 2: Call LLM with streaming
      {
        type: 'neuron',
        config: {
          systemPrompt: '', // Messages already include system
          userPrompt: '{{state.messages}}',
          temperature,
          maxTokens,
          stream,
          outputField: 'response',
          errorHandling: {
            retry: 2,
            retryDelay: 1000,
            onError: 'fallback',
            fallbackValue: 'I apologize, but I encountered an error processing your request. Please try again.'
          }
        }
      }
    ]
  };
}
