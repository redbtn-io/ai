/**
 * Web MCP Server
 * Combines web search and URL scraping capabilities
 */

import { Redis } from 'ioredis';
import { McpServer } from '../server';
import { CallToolResult } from '../types';
import { fetchAndParse } from '../../utils/scraper';

export class WebServer extends McpServer {
  private googleApiKey: string;
  private googleSearchEngineId: string;

  constructor(redis: Redis, googleApiKey?: string, googleSearchEngineId?: string) {
    super(redis, 'web', '1.0.0');
    this.googleApiKey = googleApiKey || process.env.GOOGLE_API_KEY || '';
    this.googleSearchEngineId = googleSearchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID || '';
    
    if (!this.googleApiKey || !this.googleSearchEngineId) {
      console.warn('[Web Server] Google API credentials not configured - search will not work');
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

    // Define api_call tool
    this.defineTool({
      name: 'api_call',
      description: 'Make an HTTP API call to any endpoint. Supports GET, POST, PUT, PATCH, DELETE methods with custom headers and body. Returns the response data, status, and headers.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to call (must be http or https)'
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
            description: 'HTTP method (default: GET)'
          },
          headers: {
            type: 'object',
            description: 'Custom headers to include in the request (e.g., {"Authorization": "Bearer token"})'
          },
          body: {
            type: ['object', 'string', 'array'],
            description: 'Request body for POST/PUT/PATCH. Objects are JSON-stringified automatically.'
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 30000)'
          },
          followRedirects: {
            type: 'boolean',
            description: 'Whether to follow redirects (default: true)'
          },
          validateStatus: {
            type: 'boolean',
            description: 'If false, resolve promise for any status code (default: true, throws on 4xx/5xx)'
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
      
      case 'api_call':
        return await this.apiCall(args, meta);
      
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
    const count = Math.min((args.count as number) || 10, 10); // Google API limit is 10
    const startTime = Date.now();

    console.log(`[WebServer] 🔍 Web search: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}" (count=${count})`);

    if (!this.googleApiKey || !this.googleSearchEngineId) {
      const error = 'Google API credentials not configured';
      console.error(`[WebServer] ✗ ${error}`);
      
      return {
        content: [{
          type: 'text',
          text: `Error: ${error}`
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
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!response.ok) {
        const error = `Google API error: ${response.status} ${response.statusText}`;
        console.error(`[WebServer] ✗ ${error}`);
        throw new Error(error);
      }

      const data = await response.json() as any;
      
      // Format results from Google Custom Search
      const results = data.items || [];
      const duration = Date.now() - startTime;
      
      console.log(`[WebServer] ✓ Received ${results.length} results in ${duration}ms`);
      
      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No results found for query: ${query}`
          }]
        };
      }

      // Build formatted response
      let text = `Web Search Results for "${query}":\n\n`;
      
      for (const result of results) {
        text += `**${result.title}**\n`;
        text += `${result.link}\n`;
        text += `${result.snippet || ''}\n\n`;
      }

      console.log(`[WebServer] ✓ Complete - ${results.length} results, ${text.length} chars`);

      return {
        content: [{
          type: 'text',
          text: text.trim()
        }]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[WebServer] ✗ Web search failed: ${errorMessage}`);
      
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
    const startTime = Date.now();

    console.log(`[WebServer] 📄 Scraping URL: ${url}`);

    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      const error = 'Invalid URL - must start with http:// or https://';
      console.error(`[WebServer] ✗ ${error}`);
      
      return {
        content: [{
          type: 'text',
          text: `Error: ${error}`
        }],
        isError: true
      };
    }

    try {
      // Use custom parser
      const parsed = await fetchAndParse(url);
      const duration = Date.now() - startTime;

      console.log(`[WebServer] ✓ Extracted ${parsed.contentLength} chars in ${duration}ms`);

      if (!parsed.text || parsed.text.trim().length === 0) {
        console.warn(`[WebServer] ⚠️ No content extracted from ${url}`);
        
        return {
          content: [{
            type: 'text',
            text: `No content could be extracted from ${url}`
          }]
        };
      }

      // Format result with title if available
      let result = '';
      if (parsed.title) {
        result += `# ${parsed.title}\n\n`;
      }
      result += `Source: ${url}\n\n${parsed.text}`;

      console.log(`[WebServer] ✓ Complete - ${result.length} chars`);

      return {
        content: [{
          type: 'text',
          text: result
        }]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[WebServer] ✗ Scraping failed: ${errorMessage}`);
      
      return {
        content: [{
          type: 'text',
          text: `Failed to scrape ${url}: ${errorMessage}`
        }],
        isError: true
      };
    }
  }

  /**
   * Make an HTTP API call
   */
  private async apiCall(
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    const url = args.url as string;
    const method = ((args.method as string) || 'GET').toUpperCase();
    const headers = (args.headers as Record<string, string>) || {};
    const body = args.body;
    const timeout = (args.timeout as number) || 30000;
    const followRedirects = args.followRedirects !== false;
    const validateStatus = args.validateStatus !== false;

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return {
          content: [{ type: 'text', text: 'Error: URL must use http or https protocol' }],
          isError: true
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: Invalid URL - ${error instanceof Error ? error.message : String(error)}` }],
        isError: true
      };
    }

    console.log(`[WebServer] 🔗 API call: ${method} ${parsedUrl.hostname}${parsedUrl.pathname}`);

    // Prepare request options
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'User-Agent': 'RedAI-MCP/1.0',
        ...headers
      },
      redirect: followRedirects ? 'follow' : 'manual'
    };

    // Add body for methods that support it
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (typeof body === 'object') {
        fetchOptions.body = JSON.stringify(body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
      } else {
        fetchOptions.body = String(body);
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    fetchOptions.signal = controller.signal;

    try {
      const startTime = Date.now();
      const response = await fetch(url, fetchOptions);
      const duration = Date.now() - startTime;

      clearTimeout(timeoutId);

      // Get response body
      const contentType = response.headers.get('content-type') || '';
      let responseBody: unknown;
      
      if (contentType.includes('application/json')) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
      }

      console.log(`[WebServer] ✓ API call complete: ${response.status} (${duration}ms)`);

      // Check status if validation is enabled
      if (validateStatus && !response.ok) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: true,
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body: responseBody,
              duration
            }, null, 2)
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody,
            duration
          }, null, 2)
        }]
      };

    } catch (error) {
      clearTimeout(timeoutId);
      
      console.error(`[WebServer] ✗ API call failed:`, error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          content: [{ type: 'text', text: `Error: Request timeout after ${timeout}ms` }],
          isError: true
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
}
