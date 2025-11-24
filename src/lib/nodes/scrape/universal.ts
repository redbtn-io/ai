/**
 * Universal Browse Node - Phase 2.5
 * 
 * Scrapes URL content using MCP scrape_url tool.
 * Simple single-tool node - demonstrates MCP tool integration in universal nodes.
 * 
 * Input: URL (from state.toolParam or state.query.message)
 * Output: scrapedContent (stored in state.scrapedContent)
 */

import type { UniversalNodeConfig } from '../universal/types';

/**
 * Universal browse/scrape node configuration
 * Single tool step that fetches URL content via MCP
 */
export const universalBrowseConfig: UniversalNodeConfig = {
  steps: [
    // Extract URL from query if not in toolParam
    {
      type: 'conditional',
      config: {
        condition: 'true', // Always run
        setField: 'targetUrl',
        trueValue: '{{toolParam}}', // Use toolParam if provided
        falseValue: '{{query.message}}' // Otherwise use query
      }
    },
    
    // Call MCP scrape_url tool
    {
      type: 'tool',
      config: {
        toolName: 'scrape_url',
        parameters: {
          url: '{{targetUrl}}'
        },
        outputField: 'scrapedContent',
        errorHandling: {
          retry: 2,
          retryDelay: 2000,
          fallbackValue: 'Error: Unable to fetch URL content',
          onError: 'fallback'
        }
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
 * Export for NODE_REGISTRY
 */
export const browseNodeUniversal = universalBrowseConfig;
