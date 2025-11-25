/**
 * @file stdio-pool.ts
 * @description Manages a pool of stdio-based MCP servers as child processes
 * 
 * This pool spawns and manages internal tool servers that communicate via stdin/stdout.
 * Servers are started once and kept alive for the lifetime of the Red instance.
 */

import { McpClientStdio } from './client-stdio';

export interface StdioServerConfig {
  name: string;
  scriptPath: string;  // Relative to ai/src/lib/mcp/servers/
  enabled?: boolean;
}

export class StdioServerPool {
  private clients: Map<string, McpClientStdio> = new Map();
  private serverConfigs: StdioServerConfig[];

  constructor(configs?: StdioServerConfig[]) {
    // Default configuration for internal servers
    // Paths are relative to the process working directory (where the app is running)
    // In production: node_modules/@redbtn/ai/dist/lib/mcp/servers/
    // In development: ai/src/lib/mcp/servers/
    const ext = __filename.endsWith('.js') ? '.js' : '.ts';
    const basePath = ext === '.js' 
      ? 'node_modules/@redbtn/ai/dist/lib/mcp/servers'
      : 'ai/src/lib/mcp/servers';
    
    this.serverConfigs = configs || [
      { name: 'web', scriptPath: `${basePath}/web-stdio${ext}`, enabled: true },
      { name: 'system', scriptPath: `${basePath}/system-stdio${ext}`, enabled: true },
      { name: 'rag', scriptPath: `${basePath}/rag-stdio${ext}`, enabled: true },
      { name: 'context', scriptPath: `${basePath}/context-stdio${ext}`, enabled: true },
    ];
  }

  /**
   * Start all stdio servers as child processes
   */
  async start(): Promise<void> {
    const startPromises = this.serverConfigs
      .filter(config => config.enabled !== false)
      .map(async (config) => {
        try {
          // scriptPath is already relative to the process working directory
          const scriptPath = config.scriptPath;
          
          // Determine runtime based on file extension
          const runtime = scriptPath.endsWith('.ts') ? 'tsx' : 'node';
          
          console.log(`[MCP Stdio Pool] Starting ${config.name} at: ${scriptPath}`);
          
          // Create stdio client (will spawn the process)
          const client = new McpClientStdio(`${runtime}:${scriptPath}`);
          
          // Connect (spawns child process and waits for initialization)
          await client.connect();
          
          this.clients.set(config.name, client);
          
          console.log(`[MCP Stdio Pool] ✓ Started ${config.name} server`);
        } catch (error) {
          console.error(`[MCP Stdio Pool] ✗ Failed to start ${config.name}:`, error);
          throw error;
        }
      });

    await Promise.all(startPromises);
    console.log(`[MCP Stdio Pool] All servers started (${this.clients.size} active)`);
  }

  /**
   * Stop all stdio servers (kills child processes)
   */
  async stop(): Promise<void> {
    const stopPromises = Array.from(this.clients.entries()).map(async ([name, client]) => {
      try {
        await client.disconnect();
        console.log(`[MCP Stdio Pool] ✓ Stopped ${name} server`);
      } catch (error) {
        console.error(`[MCP Stdio Pool] ✗ Error stopping ${name}:`, error);
      }
    });

    await Promise.all(stopPromises);
    this.clients.clear();
    console.log('[MCP Stdio Pool] All servers stopped');
  }

  /**
   * Get a specific server client by name
   */
  getClient(serverName: string): McpClientStdio | undefined {
    return this.clients.get(serverName);
  }

  /**
   * Get all server clients
   */
  getAllClients(): Map<string, McpClientStdio> {
    return this.clients;
  }

  /**
   * Check if a server is running
   */
  isRunning(serverName: string): boolean {
    return this.clients.has(serverName);
  }

  /**
   * List all available tools from all servers
   */
  async getAllTools(): Promise<Array<{ server: string; tools: any[] }>> {
    const toolsPromises = Array.from(this.clients.entries()).map(async ([name, client]) => {
      try {
        const result = await client.listTools();
        return { server: name, tools: result.tools };
      } catch (error) {
        console.error(`[MCP Stdio Pool] Error listing tools from ${name}:`, error);
        return { server: name, tools: [] };
      }
    });

    return Promise.all(toolsPromises);
  }

  /**
   * Call a tool by name (automatically routes to correct server)
   */
  async callTool(
    toolName: string, 
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<any> {
    console.log(`[MCP Stdio Pool] Looking for tool: ${toolName}`);
    
    // Find which server has this tool
    for (const [serverName, client] of this.clients.entries()) {
      try {
        const { tools } = await client.listTools();
        console.log(`[MCP Stdio Pool] Server ${serverName} has tools:`, tools.map(t => t.name).join(', '));
        const tool = tools.find(t => t.name === toolName);
        
        if (tool) {
          console.log(`[MCP Stdio Pool] Found ${toolName} on server ${serverName}`);
          return await client.callTool(toolName, args);
        }
      } catch (error) {
        console.error(`[MCP Stdio Pool] Error querying ${serverName}:`, error);
        // Continue to next server
      }
    }

    console.error(`[MCP Stdio Pool] Tool not found in any server: ${toolName}`);
    throw new Error(`Tool not found: ${toolName}`);
  }
}
