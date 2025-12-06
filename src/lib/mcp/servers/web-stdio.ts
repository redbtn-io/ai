#!/usr/bin/env tsx
/**
 * Web MCP Server - Stdio Transport
 * Combines web search and URL scraping capabilities
 * Communicates via stdin/stdout for low-latency internal tool calls
 */

import { McpServerStdio } from '../server-stdio';
import { CallToolResult } from '../types';
import { fetchAndParse } from '../../utils/scraper';

class WebServerStdio extends McpServerStdio {
  private googleApiKey: string;
  private googleSearchEngineId: string;

  constructor() {
    super('web', '1.0.0');
    this.googleApiKey = process.env.GOOGLE_API_KEY || '';
    this.googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID || '';
    
    if (!this.googleApiKey || !this.googleSearchEngineId) {
      console.error('[Web Server] Google API credentials not configured - search will not work');
    }
  }

  /**
   * Setup tools
   */
  protected async setup(): Promise<void> {
    // Define web_search tool
    this.defineTool({
      name: 'web_search',
      description: 'Search the web using Google Custom Search API. Returns relevant web results for queries about current events, news, or any information that needs to be looked up online.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          count: {
            type: 'number',
            description: 'Number of results to return (1-10, default: 10)'
          }
        },
        required: ['query']
      }
    });

    // Define scrape_url tool
    this.defineTool({
      name: 'scrape_url',
      description: 'Scrape and extract clean text content from a URL using custom content extraction. Returns the main content of the page without ads, navigation, or other clutter. Works with articles, documentation, blog posts, and most web pages.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to scrape (must start with http:// or https://)'
          }
        },
        required: ['url']
      }
    });

    this.capabilities = {
      tools: {
        listChanged: false
      }
    };
  }

  /**
   * Execute tool
   */
  protected async executeTool(
    name: string,
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    switch (name) {
      case 'web_search':
        return await this.searchWeb(args, meta);
      
      case 'scrape_url':
        return await this.scrapeUrl(args, meta);
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * Perform web search
   */
  private async searchWeb(
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    const query = args.query as string;
    const count = Math.min((args.count as number) || 10, 10);

    if (!this.googleApiKey || !this.googleSearchEngineId) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Google API credentials not configured'
        }],
        isError: true
      };
    }

    try {
      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', this.googleApiKey);
      url.searchParams.set('cx', this.googleSearchEngineId);
      url.searchParams.set('q', query);
      url.searchParams.set('num', count.toString());

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Google API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      const results = data.items || [];
      
      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No results found for query: ${query}`
          }]
        };
      }

      let text = `Web Search Results for "${query}":\n\n`;
      for (const result of results) {
        text += `**${result.title}**\n${result.link}\n${result.snippet || ''}\n\n`;
      }

      return {
        content: [{
          type: 'text',
          text: text.trim()
        }]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: `Web search failed: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  /**
   * Scrape URL using custom parser
   */
  private async scrapeUrl(
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    const url = args.url as string;

    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Invalid URL - must start with http:// or https://'
        }],
        isError: true
      };
    }

    try {
      const parsed = await fetchAndParse(url);

      if (!parsed.text || parsed.text.trim().length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No content could be extracted from ${url}`
          }]
        };
      }

      let result = '';
      if (parsed.title) {
        result += `# ${parsed.title}\n\n`;
      }
      result += `Source: ${url}\n\n${parsed.text}`;

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: `Failed to scrape ${url}: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new WebServerStdio();
  server.start().catch((error) => {
    console.error('[Web Server] Fatal error:', error);
    process.exit(1);
  });

  // Handle shutdown
  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

export { WebServerStdio };
