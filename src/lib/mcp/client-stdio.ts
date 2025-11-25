/**
 * @file client-stdio.ts
 * @description MCP client implementation using stdio transport (spawns child processes)
 * 
 * Spawns and manages child processes that communicate via stdin/stdout pipes.
 * Each server runs as a separate process with its own lifecycle.
 */

import { spawn, ChildProcess } from 'child_process';
import { Tool, CallToolResult, ToolsListResult } from './types';
import { EventEmitter } from 'events';

export class McpClientStdio {
  private url: string; // Format: "node:path/to/script.js" or "tsx:path/to/script.ts"
  private process?: ChildProcess;
  private buffer: string = '';
  private requestId: number = 1;
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  private connected: boolean = false;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to the MCP server by spawning a child process
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Spawn the server process
      // url format: "node:path/to/server.js" or "tsx:path/to/server.ts"
      const [runtime, ...scriptParts] = this.url.split(':');
      const scriptPath = scriptParts.join(':');

      console.log(`[MCP Stdio Client] Spawning: ${runtime} ${scriptPath}`);

      this.process = spawn(runtime, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      console.log(`[MCP Stdio Client] Process spawned with PID: ${this.process.pid}`);

      // Handle stdout (JSON-RPC responses)
      this.process.stdout?.setEncoding('utf8');
      this.process.stdout?.on('data', (chunk: string) => {
        this.buffer += chunk;
        
        // Process complete JSON-RPC messages (newline-delimited)
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(line.trim());
          }
        }
      });

      // Handle stderr (logging)
      this.process.stderr?.setEncoding('utf8');
      this.process.stderr?.on('data', (chunk: string) => {
        console.error(`[MCP stdio stderr] ${chunk}`);
      });

      // Handle process exit
      this.process.on('exit', (code) => {
        this.connected = false;
        this.process = undefined;
        
        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error(`Server process exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      // Handle process errors
      this.process.on('error', (error) => {
        reject(new Error(`Failed to spawn server process: ${error.message}`));
      });

      // Wait for initialized notification
      const timeout = setTimeout(() => {
        console.error(`[MCP Stdio Client] Initialization timeout for ${runtime}:${scriptPath}`);
        reject(new Error('Server initialization timeout'));
      }, 5000);

      this.eventEmitter.once('initialized', () => {
        console.log(`[MCP Stdio Client] Received 'initialized' notification`);
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      // Send initialize request
      console.log(`[MCP Stdio Client] Sending initialize request`);
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'red-ai',
          version: '1.0.0'
        }
      }).catch((err) => {
        console.error(`[MCP Stdio Client] Initialize request failed:`, err);
        reject(err);
      });
    });
  }

  /**
   * Disconnect from the MCP server (kill child process)
   */
  public async disconnect(): Promise<void> {
    if (!this.connected || !this.process) {
      return;
    }

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.process.once('exit', () => {
        this.connected = false;
        this.process = undefined;
        resolve();
      });

      // Send graceful shutdown, then force kill after timeout
      this.process.kill('SIGTERM');
      
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 2000);
    });
  }

  /**
   * List available tools from the server
   */
  public async listTools(): Promise<ToolsListResult> {
    const response = await this.sendRequest('tools/list', {});
    return { tools: response.tools || [] };
  }

  /**
   * Call a tool on the server
   */
  public async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.sendRequest('tools/call', {
      name,
      arguments: args
    });
  }

  /**
   * Send JSON-RPC request to server
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.process?.stdin) {
      throw new Error('Server process not connected');
    }

    const id = this.requestId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // Set timeout for request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      // Clear timeout when resolved
      const originalResolve = resolve;
      const originalReject = reject;
      
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          originalReject(error);
        }
      });

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Handle incoming JSON-RPC message from server
   */
  private handleMessage(message: string): void {
    console.log(`[MCP Stdio Client] Received: ${message.substring(0, 200)}`);
    let data: any;
    
    try {
      data = JSON.parse(message);
    } catch (error) {
      console.error('[MCP stdio] Failed to parse message:', message);
      return;
    }

    // Handle notifications (no id)
    if (!data.id) {
      console.log(`[MCP Stdio Client] Notification: ${data.method}`);
      if (data.method === 'initialized') {
        this.eventEmitter.emit('initialized');
      }
      return;
    }

    // Handle responses
    const pending = this.pendingRequests.get(data.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(data.id);

    if (data.error) {
      pending.reject(new Error(data.error.message));
    } else {
      pending.resolve(data.result);
    }
  }
}
