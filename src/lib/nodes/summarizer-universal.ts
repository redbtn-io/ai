/**
 * Universal Summarizer Node - Phase 2.5
 * 
 * Extracts and summarizes key information from search results or long content.
 * Used in search workflows to condense results into actionable insights.
 * 
 * Input: searchResults (raw content), originalQuery (for context)
 * Output: summary (condensed key facts)
 */

import type { UniversalNodeConfig } from './universal/types';

/**
 * Summarizer node configuration
 * Extracts key information relevant to the user's query
 */
export const universalSummarizerConfig: UniversalNodeConfig = {
  steps: [
    {
      type: 'neuron',
      config: {
        systemPrompt: `You are an information extraction expert. Extract key facts and data to answer the user's query accurately and concisely.

IMPORTANT: Do NOT repeat or rephrase the query - only provide the facts and information.`,
        
        userPrompt: `User Query: {{state.originalQuery || query.message}}

Search Results:
{{state.searchResults || scrapedContent}}

Extract and summarize the key information that answers this query. Start directly with the facts - do NOT repeat the query:`,
        
        outputField: 'summary',
        
        stream: false, // Background processing
        
        temperature: 0.3, // Consistent extraction
        
        maxTokens: 500,
        
        errorHandling: {
          retry: 2,
          retryDelay: 1000,
          fallbackValue: 'Unable to summarize the search results.',
          onError: 'fallback'
        }
      }
    }
  ]
};

/**
 * Export for NODE_REGISTRY
 */
export const summarizerNodeUniversal = universalSummarizerConfig;
