/**
 * Universal Router Node - Phase 2.5
 * 
 * Intelligent routing based on query analysis with confidence scoring.
 * Routes to: research (web search), command (system operations), or respond (direct answer).
 * 
 * Input: query.message, conversation context
 * Output: nextGraph (routing decision), toolParam (if needed)
 */

import type { UniversalNodeConfig } from './universal/types';

/**
 * Router node configuration
 * Analyzes query and routes to appropriate handler
 */
export const universalRouterConfig: UniversalNodeConfig = {
  steps: [
    // Step 1: Call LLM to analyze query and get routing decision with confidence scores
    {
      type: 'neuron',
      config: {
        systemPrompt: `You are a query router. Analyze the user's query and determine routing with confidence scores (0-1).

Evaluate THREE options simultaneously:
1. RESEARCH: Query needs current web information (news, facts, events, data)
2. COMMAND: Query requests system/API/home automation command execution  
3. RESPOND: Query can be answered directly with existing knowledge

Respond with JSON:
{
  "research": {
    "confidence": 0.0-1.0,
    "reasoning": "why research would/wouldn't help",
    "query": "optimized search query (if needed)"
  },
  "command": {
    "confidence": 0.0-1.0,
    "reasoning": "why command would/wouldn't work",
    "domain": "system|api|home",
    "details": "command specifics"
  },
  "respond": {
    "confidence": 0.0-1.0,
    "reasoning": "why direct response would/wouldn't work"
  }
}`,
        userPrompt: 'Query: {{state.query.message}}',
        outputField: 'routingDecision',
        temperature: 0.3,
        stream: false,
        errorHandling: {
          retry: 2,
          retryDelay: 1000,
          onError: 'fallback',
          fallbackValue: {
            research: { confidence: 0, reasoning: 'Error during routing' },
            command: { confidence: 0, reasoning: 'Error during routing' },
            respond: { confidence: 1, reasoning: 'Defaulting to direct response' }
          }
        }
      }
    },
    
    // Step 2: Parse the routing decision JSON
    {
      type: 'transform',
      config: {
        operation: 'parse-json',
        inputField: 'routingDecision',
        outputField: 'parsedRouting'
      }
    },
    
    // Step 3: Determine winner (highest confidence)
    // Check research first (>0.6 threshold)
    {
      type: 'conditional',
      config: {
        condition: '{{state.parsedRouting.research.confidence}} > 0.6',
        setField: 'nextGraph',
        trueValue: 'search',
        falseValue: 'undecided'
      }
    },
    
    // Step 4: Check command if not research (>0.6 threshold)
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "undecided" && {{state.parsedRouting.command.confidence}} > 0.6',
        setField: 'nextGraph',
        trueValue: 'command',
        falseValue: '{{state.nextGraph}}'
      }
    },
    
    // Step 5: Default to responder if still undecided
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "undecided"',
        setField: 'nextGraph',
        trueValue: 'responder',
        falseValue: '{{state.nextGraph}}'
      }
    },
    
    // Step 6: Set toolParam for search (optimized query)
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "search"',
        setField: 'toolParam',
        trueValue: '{{state.parsedRouting.research.query}}',
        falseValue: ''
      }
    },
    
    // Step 7: Set toolParam for command (domain + details as JSON)
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "command"',
        setField: 'toolParam',
        trueValue: '{"domain": "{{state.parsedRouting.command.domain}}", "details": "{{state.parsedRouting.command.details}}"}',
        falseValue: '{{state.toolParam}}'
      }
    }
  ]
};

/**
 * Export for NODE_REGISTRY
 */
export const routerNodeUniversal = universalRouterConfig;
