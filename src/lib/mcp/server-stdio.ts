/**
 * @file server-stdio.ts
 * @description Base MCP server implementation using stdio transport (stdin/stdout)
 * 
 * This transport is ideal for internal tools that are tightly coupled to the parent process.
 * No network sockets or ports required - communication happens via process pipes.
 */

import {
  Tool,
  CallToolResult,
  ServerInfo,
  ServerCapabilities,
} from './types';

export abstract class McpServerStdio {
  protected serverInfo: ServerInfo;
  protected capabilities: ServerCapabilities = {};
  protected tools: Map<string, Tool> = new Map();
  protected isRunning: boolean = false;

  constructor(name: string, version: string) {
    this.serverInfo = { name, version };
  }

  /**
   * Setup method - subclasses override to define tools
   */
  protected abstract setup(): Promise<void>;

  /**
   * Execute tool - subclasses override to implement tool logic
   */
  protected abstract executeTool(
    name: string,
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult>;

  /**
   * Define a tool
   */
  protected defineTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Start the stdio server (listen on stdin, write to stdout)
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error(`Server ${this.serverInfo.name} is already running`);
    }

    // Call setup to define tools
    await this.setup();

    this.isRunning = true;

    // Set up stdin listener for JSON-RPC messages
    process.stdin.setEncoding('utf8');
    
    let buffer = '';
    
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      
      // Process complete JSON-RPC messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(line.trim()).catch(error => {
            this.sendError(null, -32603, `Internal error: ${error.message}`);
          });
        }
      }
    });

    process.stdin.on('end', () => {
      this.stop();
    });

    // Don't send 'initialized' notification here - it will be sent
    // after the client sends the 'initialize' request
  }

  /**
   * Stop the stdio server
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    process.stdin.pause();
  }

  /**
   * Handle incoming JSON-RPC message
   */
  private async handleMessage(message: string): Promise<void> {
    let request: any;
    
    try {
      request = JSON.parse(message);
    } catch (error) {
      this.sendError(null, -32700, 'Parse error');
      return;
    }

    // Handle JSON-RPC methods
    const { id, method, params } = request;

    switch (method) {
      case 'tools/list':
        this.sendResponse(id, { 
          tools: Array.from(this.tools.values())
        });
        break;

      case 'tools/call':
        try {
          const result = await this.executeTool(
            params.name, 
            params.arguments || {},
            params._meta
          );
          this.sendResponse(id, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.sendError(id, -32000, message);
        }
        break;

      case 'initialize':
        this.sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: this.capabilities,
          serverInfo: this.serverInfo
        });
        // Send initialized notification after responding
        this.sendNotification('initialized', {
          serverInfo: this.serverInfo
        });
        break;

      default:
        this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  /**
   * Send JSON-RPC response to stdout
   */
  private sendResponse(id: string | number | null, result: any): void {
    const response = {
      jsonrpc: '2.0',
      id,
      result
    };
    
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /**
   * Send JSON-RPC error to stdout
   */
  private sendError(id: string | number | null, code: number, message: string): void {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };
    
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /**
   * Send JSON-RPC notification to stdout
   */
  private sendNotification(method: string, params: any): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };
    
    process.stdout.write(JSON.stringify(notification) + '\n');
  }
}
