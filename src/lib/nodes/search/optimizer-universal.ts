/**
 * Universal Optimizer Node - Phase 2.5
 * 
 * Optimizes user queries into effective search terms using LLM.
 * Simple single-neuron node - perfect first migration case.
 * 
 * Input: originalQuery (from state.query.message or state.toolParam)
 * Output: optimizedQuery (stored in state.optimizedQuery)
 */

import type { UniversalNodeConfig } from '../universal/types';

/**
 * Universal optimizer node configuration
 * Single neuron step that optimizes search queries
 */
export const universalOptimizerConfig: UniversalNodeConfig = {
  steps: [
    {
      type: 'neuron',
      config: {
        systemPrompt: `You are a search query optimizer.

Extract the key search terms from the user's prompt. Focus on:
- Core concepts and keywords
- Specific entities (names, places, products)
- Time-relevant terms (if asking about "latest" or "recent")
- Technical terms exactly as written

Return ONLY the optimized search query, nothing else.`,
        
        userPrompt: '{{toolParam || query.message}}',
        
        outputField: 'optimizedQuery',
        
        stream: false, // Internal processing, no streaming
        
        temperature: 0.3, // Low temperature for consistent optimization
        
        maxTokens: 100, // Short output
        
        errorHandling: {
          retry: 2,
          retryDelay: 1000,
          fallbackValue: '{{toolParam || query.message}}', // Use original query on failure
          onError: 'fallback'
        }
      }
    }
  ]
};

/**
 * Export for NODE_REGISTRY
 */
export const optimizerNodeUniversal = universalOptimizerConfig;
