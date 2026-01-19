/**
 * UserMcpManager - Manages per-user MCP connections
 * 
 * Handles lazy loading of user's custom MCP servers with:
 * - Connection caching per user
 * - Idle connection cleanup
 * - Error recovery with auto-disable
 * - Tool discovery and caching
 */

import { McpClientSSE } from './client-sse';
import { Tool, CallToolResult } from './types';
import { getDatabase } from '../memory/database';
import { decryptHeaders } from '../crypto';

/**
 * Configuration for a user's MCP connection (from database)
 */
export interface McpConnectionConfig {
  connectionId: string;
  userId: string;
  name: string;
  url: string;
  headers?: Record<string, string>;
  isEnabled: boolean;
  discoveredTools: Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  }>;
}

/**
 * Tool with source information
 */
export interface ToolWithSource {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  source: 'global' | 'custom';
  connectionId?: string;
  serverName: string;
}

/**
 * Test result for connection validation
 */
export interface TestResult {
  success: boolean;
  latency?: number;
  error?: string;
  serverInfo?: { name: string; version: string };
}

/**
 * Cached client with metadata
 */
interface CachedClient {
  client: McpClientSSE;
  config: McpConnectionConfig;
  lastActivity: number;
  failureCount: number;
}

export class UserMcpManager {
  // Cache: userId -> (connectionId -> client data)
  private userClients: Map<string, Map<string, CachedClient>> = new Map();
  
  // Idle timeout: disconnect after 5 minutes of inactivity
  private idleTimeout = 5 * 60 * 1000;
  
  // Max consecutive failures before auto-disable
  private maxFailures = 3;
  
  // Cleanup interval handle
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Start idle cleanup process
    this.startCleanupProcess();
  }

  /**
   * Start periodic cleanup of idle connections
   */
  private startCleanupProcess(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60 * 1000);
  }

  /**
   * Stop the cleanup process (for shutdown)
   */
  public stopCleanupProcess(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Load user's enabled MCP connections from database
   */
  async loadUserConnections(userId: string): Promise<McpConnectionConfig[]> {
    const db = await getDatabase();
    
    const connections = await (await db.collection('mcpconnections')).find({
      userId,
      isEnabled: true,
    }).toArray();

    return connections.map((doc: any) => ({
      connectionId: doc.connectionId,
      userId: doc.userId,
      name: doc.name,
      url: doc.url,
      // Decrypt headers that were encrypted by webapp
      // Headers are stored as plain objects in MongoDB, not Maps
      headers: decryptHeaders(doc.headers || {}),
      isEnabled: doc.isEnabled,
      discoveredTools: doc.discoveredTools || [],
    }));
  }

  /**
   * Get or create a client for a specific connection (lazy connect)
   */
  async getClient(userId: string, connectionId: string): Promise<McpClientSSE | null> {
    // Check if client already exists
    const userCache = this.userClients.get(userId);
    if (userCache) {
      const cached = userCache.get(connectionId);
      if (cached) {
        // Update last activity
        cached.lastActivity = Date.now();
        return cached.client;
      }
    }

    // Load connection config from database
    const db = await getDatabase();
    const connectionDoc = await (await db.collection('mcpconnections')).findOne({
      connectionId,
      userId,
      isEnabled: true,
    }) as any;

    if (!connectionDoc) {
      console.log(`[UserMcpManager] Connection ${connectionId} not found or disabled for user ${userId}`);
      return null;
    }

    const config: McpConnectionConfig = {
      connectionId: connectionDoc.connectionId,
      userId: connectionDoc.userId,
      name: connectionDoc.name,
      url: connectionDoc.url,
      // Decrypt headers that were encrypted by webapp
      // Headers are stored as plain objects in MongoDB, not Maps
      headers: decryptHeaders(connectionDoc.headers || {}),
      isEnabled: connectionDoc.isEnabled,
      discoveredTools: connectionDoc.discoveredTools || [],
    };

    // Create and connect client
    try {
      const client = new McpClientSSE(config.url, config.name);
      await client.connect();
      await client.initialize({ name: 'red-ai', version: '1.0.0' });

      // Cache the client
      if (!this.userClients.has(userId)) {
        this.userClients.set(userId, new Map());
      }
      this.userClients.get(userId)!.set(connectionId, {
        client,
        config,
        lastActivity: Date.now(),
        failureCount: 0,
      });

      // Update last connected timestamp in database
      await (await db.collection('mcpconnections')).updateOne(
        { connectionId },
        { $set: { lastConnectedAt: new Date(), lastError: null }, $unset: { lastError: 1 } }
      );

      console.log(`[UserMcpManager] Connected to ${config.name} for user ${userId}`);
      return client;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[UserMcpManager] Failed to connect to ${config.name}: ${errorMsg}`);
      
      // Record error in database
      await (await db.collection('mcpconnections')).updateOne(
        { connectionId },
        { $set: { lastError: errorMsg } }
      );

      return null;
    }
  }

  /**
   * Get all tools for a user (from their enabled connections)
   * Uses cached tools from database for speed, falls back to live discovery
   */
  async getUserTools(userId: string): Promise<ToolWithSource[]> {
    const connections = await this.loadUserConnections(userId);
    const tools: ToolWithSource[] = [];

    for (const conn of connections) {
      // Use cached discovered tools
      for (const tool of conn.discoveredTools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          source: 'custom',
          connectionId: conn.connectionId,
          serverName: conn.name,
        });
      }
    }

    return tools;
  }

  /**
   * Find which connection owns a tool for a user
   */
  async findToolConnection(userId: string, toolName: string): Promise<string | undefined> {
    const connections = await this.loadUserConnections(userId);
    
    for (const conn of connections) {
      if (conn.discoveredTools.some(t => t.name === toolName)) {
        return conn.connectionId;
      }
    }
    
    return undefined;
  }

  /**
   * Call a tool on a user's custom MCP server
   */
  async callTool(
    userId: string,
    toolName: string,
    args: Record<string, unknown>,
    context?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    // Find which connection has this tool
    const connectionId = await this.findToolConnection(userId, toolName);
    
    if (!connectionId) {
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" not found in user's custom MCP servers` }],
        isError: true,
      };
    }

    // Get or create client
    const client = await this.getClient(userId, connectionId);
    
    if (!client) {
      return {
        content: [{ type: 'text', text: `Failed to connect to MCP server for tool "${toolName}"` }],
        isError: true,
      };
    }

    try {
      // Call the tool
      const result = await client.callTool(toolName, args, context);
      
      // Reset failure count on success
      const userCache = this.userClients.get(userId);
      const cached = userCache?.get(connectionId);
      if (cached) {
        cached.failureCount = 0;
        cached.lastActivity = Date.now();
      }

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Track failures
      const userCache = this.userClients.get(userId);
      const cached = userCache?.get(connectionId);
      if (cached) {
        cached.failureCount++;
        
        // Auto-disable after too many failures
        if (cached.failureCount >= this.maxFailures) {
          console.warn(`[UserMcpManager] Auto-disabling connection ${connectionId} after ${this.maxFailures} failures`);
          await this.disableConnection(connectionId);
        }
      }

      return {
        content: [{ type: 'text', text: `Tool call failed: ${errorMsg}` }],
        isError: true,
      };
    }
  }

  /**
   * Test connection to an MCP server (for add/edit flow)
   */
  async testConnection(config: { url: string; headers?: Record<string, string> }): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      const client = new McpClientSSE(config.url, 'test-connection');
      await client.connect();
      const result = await client.initialize({ name: 'red-ai', version: '1.0.0' });
      await client.disconnect();
      
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        latency,
        serverInfo: result.serverInfo,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Discover tools from an MCP server
   */
  async discoverTools(config: { url: string; headers?: Record<string, string> }): Promise<Tool[]> {
    const client = new McpClientSSE(config.url, 'discover');
    
    try {
      await client.connect();
      await client.initialize({ name: 'red-ai', version: '1.0.0' });
      const result = await client.listTools();
      await client.disconnect();
      
      return result.tools || [];
    } catch (error) {
      console.error('[UserMcpManager] Tool discovery failed:', error);
      throw error;
    }
  }

  /**
   * Disable a connection (called after too many failures)
   */
  private async disableConnection(connectionId: string): Promise<void> {
    const db = await getDatabase();
    
    await (await db.collection('mcpconnections')).updateOne(
      { connectionId },
      { 
        $set: { 
          isEnabled: false, 
          lastError: `Auto-disabled after ${this.maxFailures} consecutive failures` 
        } 
      }
    );

    // Remove from cache
    for (const [userId, userCache] of this.userClients) {
      if (userCache.has(connectionId)) {
        const cached = userCache.get(connectionId);
        await cached?.client.disconnect();
        userCache.delete(connectionId);
      }
    }
  }

  /**
   * Clean up idle connections
   */
  cleanupIdleConnections(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, userCache] of this.userClients) {
      for (const [connectionId, cached] of userCache) {
        if (now - cached.lastActivity > this.idleTimeout) {
          console.log(`[UserMcpManager] Disconnecting idle connection ${connectionId} for user ${userId}`);
          cached.client.disconnect().catch(err => {
            console.warn(`[UserMcpManager] Error disconnecting: ${err}`);
          });
          userCache.delete(connectionId);
          cleaned++;
        }
      }
      
      // Clean up empty user caches
      if (userCache.size === 0) {
        this.userClients.delete(userId);
      }
    }

    if (cleaned > 0) {
      console.log(`[UserMcpManager] Cleaned up ${cleaned} idle connections`);
    }
  }

  /**
   * Disconnect all connections for a specific user
   */
  async disconnectUser(userId: string): Promise<void> {
    const userCache = this.userClients.get(userId);
    if (!userCache) return;

    for (const [connectionId, cached] of userCache) {
      try {
        await cached.client.disconnect();
        console.log(`[UserMcpManager] Disconnected ${connectionId} for user ${userId}`);
      } catch (error) {
        console.warn(`[UserMcpManager] Error disconnecting ${connectionId}:`, error);
      }
    }

    this.userClients.delete(userId);
  }

  /**
   * Disconnect all connections (for shutdown)
   */
  async disconnectAll(): Promise<void> {
    for (const userId of this.userClients.keys()) {
      await this.disconnectUser(userId);
    }
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    this.stopCleanupProcess();
    await this.disconnectAll();
    console.log('[UserMcpManager] Shutdown complete');
  }
}
