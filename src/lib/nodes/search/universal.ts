/**
 * Universal Search Node - Phase 2.5
 * 
 * Iterative web search using universal node architecture with loop support.
 * Replaces legacy search node with cleaner, more maintainable structure.
 * 
 * Flow:
 * 1. Loop (up to 5 iterations):
 *    a. Call web_search MCP tool
 *    b. Evaluate results with neuron
 *    c. Check if sufficient (exit condition)
 *    d. If insufficient, refine query and continue loop
 * 2. Pass results to responder
 * 
 * Note: This uses simplified logic for Phase 2.5 MVP.
 * Full implementation will add message building and context handling.
 */

import type { UniversalNodeConfig } from '../universal/types';

/**
 * Universal search node configuration
 * Uses loop step for iterative searching with evaluation
 */
export const universalSearchConfig: UniversalNodeConfig = {
  steps: [
    // Initialize search state
    {
      type: 'conditional',
      config: {
        condition: 'true', // Always run
        setField: 'searchQuery',
        trueValue: '{{toolParam}}', // Use refined query if provided
        falseValue: '{{query.message}}' // Otherwise use original query
      }
    },
    
    // Main search loop - iterates until results are sufficient or maxIterations reached
    {
      type: 'loop',
      config: {
        maxIterations: 5,
        onMaxIterations: 'continue', // Proceed with available results
        exitCondition: 'state.searchSufficient === true',
        accumulatorField: 'searchResult', // Accumulate all search results
        
        steps: [
          // Step 1: Execute web search via MCP
          {
            type: 'tool',
            config: {
              toolName: 'web_search',
              parameters: {
                query: '{{searchQuery}}',
                count: 10
              },
              outputField: 'searchResult',
              errorHandling: {
                retry: 2,
                retryDelay: 1000,
                onError: 'throw'
              }
            }
          },
          
          // Step 2: Evaluate if results are sufficient using neuron
          {
            type: 'neuron',
            config: {
              userPrompt: `Analyze search results to determine if sufficient.

User Query: {{query.message}}
Search Results: {{searchResult}}
Current Iteration: {{loopIteration}} of 5

Evaluate:
1. Do results contain relevant information?
2. Is information complete enough?
3. If not, what should next search focus on?

Respond with JSON:
{
  "sufficient": true/false,
  "reasoning": "Brief explanation",
  "newSearchQuery": "Refined query if not sufficient"
}

Be practical: If results provide ANY useful information, consider sufficient.`,
              outputField: 'evaluationRaw',
              stream: false,
              errorHandling: {
                retry: 1,
                fallbackValue: '{"sufficient": true, "reasoning": "Evaluation failed, using available results"}',
                onError: 'fallback'
              }
            }
          },
          
          // Step 3: Check if results are sufficient
          {
            type: 'conditional',
            config: {
              condition: '{{evaluationRaw}}.includes("sufficient": true)',
              setField: 'searchSufficient',
              trueValue: true,
              falseValue: false
            }
          },
          
          // Step 4: If insufficient, extract new query for next iteration
          {
            type: 'conditional',
            config: {
              condition: '{{searchSufficient}} == false',
              setField: 'searchQuery',
              trueValue: '{{searchQuery}}', // Keep same if sufficient
              falseValue: '{{evaluationRaw}}' // Will need JSON parsing - simplified for MVP
            }
          }
        ]
      }
    },
    
    // Set next node to responder
    {
      type: 'conditional',
      config: {
        condition: 'true',
        setField: 'nextGraph',
        trueValue: 'responder',
        falseValue: ''
      }
    }
  ]
};

/**
 * Export as named constant for NODE_REGISTRY
 */
export const searchNodeUniversal = universalSearchConfig;
