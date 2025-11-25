/**
 * @file src/red.ts
 * @description The core library for the Red AI agent.
 */

// Load environment variables from .env early for library modules
import 'dotenv/config';

import { redGraph } from "./lib/graphs/red";
import { MemoryManager } from "./lib/memory/memory";
import { MessageQueue } from "./lib/memory/queue";
import { PersistentLogger } from "./lib/logs/persistent-logger";
import { NeuronRegistry } from "./lib/neurons/NeuronRegistry";
import { GraphRegistry } from "./lib/graphs/GraphRegistry";
import * as background from "./functions/background";
import { respond as respondFunction } from "./functions/respond";
import { McpRegistry } from "./lib/mcp/registry";
import { StdioServerPool } from "./lib/mcp/stdio-pool";

// Export database utilities for external use
export { 
  getDatabase, 
  resetDatabase,
  DatabaseManager, 
  StoredMessage, 
  Conversation,
  StoredLog,
  Generation,
  BaseDocument,
} from "./lib/memory/database";

// Export message queue for background processing
export { MessageQueue, MessageGenerationState } from "./lib/memory/queue";

// Export logging system
export * from "./lib/logs";
export { PersistentLogger } from "./lib/logs/persistent-logger";

// Export thinking utilities for DeepSeek-R1 and similar models
export { extractThinking, logThinking, extractAndLogThinking } from "./lib/utils/thinking";

// Export RAG (Retrieval-Augmented Generation) components
export { 
  VectorStoreManager,
  DocumentChunk,
  SearchResult,
  ChunkingConfig,
  SearchConfig,
  CollectionStats
} from "./lib/memory/vectors";

export { 
  addToVectorStoreNode,
  retrieveFromVectorStoreNode
} from "./lib/nodes/rag";

// Export MCP (Model Context Protocol) components
export {
  McpClient,
  McpRegistry,
  McpServer,
  WebServer,
  SystemServer,
  Tool,
  CallToolResult,
  ServerRegistration,
} from "./lib/mcp";

// Export Neuron system components
export {
  NeuronRegistry,
  NeuronNotFoundError,
  NeuronAccessDeniedError,
  NeuronProviderError
} from "./lib/neurons/NeuronRegistry";
export { NeuronConfig, NeuronDocument, NeuronProvider, NeuronRole } from "./lib/types/neuron";
export { default as Neuron } from "./lib/models/Neuron";

// Export Graph system components (Phase 1)
export {
  GraphRegistry,
  GraphNotFoundError,
  GraphAccessDeniedError
} from "./lib/graphs/GraphRegistry";
export { GraphConfig, GraphNodeConfig, GraphEdgeConfig, CompiledGraph, GraphNodeType } from "./lib/types/graph";
export { Graph, GraphDocument } from "./lib/models/Graph";

// --- Type Definitions ---

/**
 * Defines the configuration required to initialize the Red instance.
 */
export interface RedConfig {
  redisUrl: string; // URL for connecting to the Redis instance, global state store
  vectorDbUrl: string; // URL for connecting to the vector database, short to medium term memory
  databaseUrl: string; // URL for connecting to the traditional database, long term memory
  chatLlmUrl: string; // URL for the chat LLM (e.g., Ollama on 192.168.1.4:11434)
  workLlmUrl: string; // URL for the worker LLM (e.g., Ollama on 192.168.1.3:11434)
  llmEndpoints?: { [agentName: string]: string }; // Map of named agents to specific LLM endpoint URLs
}

/**
 * Defines optional parameters for on-demand invocations,
 * providing context about the request's origin.
 */
export interface InvokeOptions {
  source?: {
    device?: 'phone' | 'speaker' | 'web';
    application?: 'redHome' | 'redChat' | 'redAssistant';
  };
  stream?: boolean; // Flag to enable streaming responses
  conversationId?: string; // Optional conversation ID - will be auto-generated if not provided
  generationId?: string; // Optional generation ID - will be auto-generated if not provided
  messageId?: string; // Optional message ID for Redis pub/sub streaming
  userMessageId?: string; // Optional user message ID from client request (stored in memory)
  userId?: string; // Required for per-user model loading and conversation ownership
  graphId?: string; // Phase 1: Optional graph ID to use (defaults to user's defaultGraphId)
}

// --- The Red Library Class ---

/**
 * The primary class for the Red AI engine. It encapsulates the agent's
 * core logic, state management, and interaction models.
 */
export class Red {
  private readonly config: RedConfig;
  private isLoaded: boolean = false;
  private isThinking: boolean = false;
  private baseState: object = {};
  private nodeId?: string;
  private heartbeatInterval?: NodeJS.Timeout;

  // Properties to hold configured services
  public neuronRegistry!: NeuronRegistry;
  public graphRegistry!: GraphRegistry; // Phase 1: Dynamic graph system
  public memory!: MemoryManager;
  public messageQueue!: MessageQueue;
  public logger!: PersistentLogger;
  public mcpRegistry!: McpRegistry; // For external HTTP/SSE servers
  public mcpStdioPool!: StdioServerPool; // For internal stdio servers
  private redis!: any; // Redis client for heartbeat

  /**
   * Constructs a new instance of the Red AI engine.
   * @param config The configuration object required for initialization.
   */
  constructor(config: RedConfig) {
    this.config = config;

    // Initialize neuron registry (dynamic model loading)
    this.neuronRegistry = new NeuronRegistry(config);
    
    // Phase 1: Initialize graph registry (dynamic graph compilation)
    this.graphRegistry = new GraphRegistry(config);
    
    // Initialize memory manager
    this.memory = new MemoryManager(config.redisUrl);
    
    // Initialize message queue with same Redis connection
    const redis = new (require('ioredis'))(config.redisUrl);
    this.redis = redis;
    this.messageQueue = new MessageQueue(redis);
    
    // Initialize logger with MongoDB persistence
    this.logger = new PersistentLogger(redis, this.nodeId || 'default');
    
    // Initialize MCP registry for external HTTP/SSE servers
    this.mcpRegistry = new McpRegistry(this.messageQueue);
    
    // Initialize stdio server pool for internal tools
    this.mcpStdioPool = new StdioServerPool();
  }

  // --- Private Internal Methods ---

  /**
   * The internal engine that executes a specified graph with the given state and options.
   * All graph-running logic is centralized here.
   * @private
   */
  private async _invoke(
    graphName: string,
    localState: object,
    options?: InvokeOptions
  ): Promise<any> {
    if (!this.isLoaded) {
      throw new Error("Red instance is not loaded. Please call load() before invoking a graph.");
    }
    
    // TODO: Implement the actual LangGraph execution logic.
    // This function will select a graph from a library based on `graphName`,
    // merge the `baseState` and `localState`, and execute the graph.
    
    const result = { 
      output: `Output from ${graphName}`,
      timestamp: new Date().toISOString()
    };
    
    return result;
  }

  // --- Public API ---

  /**
   * Initializes the Red instance by connecting to data sources and loading the base state.
   * This method must be called before any other operations.
   * @param nodeId An optional identifier for this specific instance, used for distributed systems.
   */
  public async load(nodeId?: string): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    if (nodeId) {
      this.nodeId = nodeId;
    } else {
      // Generate a default nodeId if not provided
      this.nodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    process.stdout.write(`\rLoading node: ${this.nodeId}...`);
    
    // Initialize neuron registry (connect to MongoDB)
    await this.neuronRegistry.initialize();
    
    // Phase 1: Initialize graph registry (connect to MongoDB)
    await this.graphRegistry.initialize();
    
    // TODO: Implement the actual state fetching logic from Redis using `this.config.redisUrl`.
    // The `nodeId` can be used to fetch a specific state for recovery or distributed operation.
    
    this.baseState = { loadedAt: new Date(), nodeId: this.nodeId };
    this.isLoaded = true;
    
    // Start internal stdio-based MCP servers
    try {
      await this.mcpStdioPool.start();
      const toolsInfo = await this.mcpStdioPool.getAllTools();
      const totalTools = toolsInfo.reduce((sum, info) => sum + info.tools.length, 0);
      process.stdout.write(`\r✓ Red AI initialized (${totalTools} MCP tools via stdio)\n`);
    } catch (error) {
      console.warn('⚠️ MCP stdio server startup failed:', error);
      console.warn('  Tool calls may fail. Check server scripts in ai/src/lib/mcp/servers/');
    }
    
    // Start heartbeat to register node as active
    this.heartbeatInterval = background.startHeartbeat(this.nodeId, this.redis);
  }

  /**
   * Gets a list of all currently active nodes.
   * @returns Array of active node IDs
   */
  public async getActiveNodes(): Promise<string[]> {
    return background.getActiveNodes(this.redis);
  }
  
  /**
   * Starts the autonomous, continuous "thinking" loop. The loop runs internally
   * until `stopThinking()` is called.
   */
  public async think(): Promise<void> {
    if (!this.isLoaded) {
      throw new Error("Red instance is not loaded. Please call load() before thinking.");
    }
    if (this.isThinking) {
      return;
    }

    this.isThinking = true;

    do {
      await this._invoke('cognitionGraph', { cycleType: 'autonomous' });
      
      // Delay between cycles to prevent runaway processes and manage resource usage.
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
      
    } while (this.isThinking);
  }

  /**
   * Signals the internal `think()` loop to stop gracefully after completing its current cycle.
   */
  public stopThinking(): void {
    if (!this.isThinking) {
      return;
    }
    this.isThinking = false;
  }

  /**
   * Gracefully shuts down the Red instance, stopping heartbeat and cleaning up resources.
   */
  public async shutdown(): Promise<void> {
    console.log(`[Red] Shutting down node: ${this.nodeId}...`);
    
    // Stop thinking if active
    this.stopThinking();
    
    // Stop heartbeat
    await background.stopHeartbeat(this.nodeId, this.redis, this.heartbeatInterval);
    this.heartbeatInterval = undefined;
    
    // Stop stdio MCP servers (kills child processes)
    try {
      await this.mcpStdioPool.stop();
      console.log('[Red] MCP stdio servers stopped');
    } catch (error) {
      console.warn('[Red] Error stopping MCP stdio servers:', error);
    }
    
    // Disconnect from external HTTP/SSE MCP servers (if any)
    try {
      await this.mcpRegistry.disconnectAll();
      console.log('[Red] External MCP clients disconnected');
    } catch (error) {
      console.warn('[Red] Error disconnecting external MCP clients:', error);
    }
    
    // Close Redis connection
    if (this.redis) {
      await this.redis.quit();
    }
    
    this.isLoaded = false;
    console.log('[Red] Shutdown complete');
  }

  /**
   * Handles a direct, on-demand request from a user-facing application.
   * Automatically manages conversation history, memory, and summarization.
   * @param query The user's input or request data (must have a 'message' property)
   * @param options Metadata about the source of the request and conversation settings
   * @returns For non-streaming: the full AIMessage object with content, tokens, metadata, and conversationId.
   *          For streaming: an async generator that yields metadata first (with conversationId), then string chunks, then finally the full AIMessage.
   */
  public async respond(query: { message: string }, options: InvokeOptions = {}): Promise<any | AsyncGenerator<string | any, void, unknown>> {
    return respondFunction(this, query, options);
  }

  /**
   * Set a custom title for a conversation (set by user)
   * This prevents automatic title generation from overwriting it
   * @param conversationId The conversation ID
   * @param title The custom title to set
   */
  public async setConversationTitle(conversationId: string, title: string): Promise<void> {
    return background.setConversationTitle(conversationId, title, this);
  }

  /**
   * Get the title for a conversation
   * @param conversationId The conversation ID
   * @returns The title or null if not set
   */
  public async getConversationTitle(conversationId: string): Promise<string | null> {
    return background.getConversationTitle(conversationId, this);
  }

  /**
   * Call an MCP tool by name with comprehensive logging
   * Automatically routes to the correct MCP server (stdio or HTTP/SSE)
   * @param toolName The name of the tool to call
   * @param args The arguments to pass to the tool
   * @param context Optional logging context (conversationId, generationId, messageId)
   * @returns The tool execution result
   */
  public async callMcpTool(
    toolName: string, 
    args: Record<string, unknown>,
    context?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<any> {
    const startTime = Date.now();
    
    // DEBUG: Log userId for store_message calls
    if (toolName === 'store_message') {
      console.log(`[RED.callMcpTool] store_message called with userId:`, args.userId, 'args:', Object.keys(args));
    }
    
    // Log tool call start
    await this.logger.log({
      level: 'info',
      category: 'mcp',
      message: `📡 MCP Tool Call: ${toolName}`,
      conversationId: context?.conversationId,
      generationId: context?.generationId,
      metadata: {
        toolName,
        args: this.sanitizeArgsForLogging(args),
        protocol: 'MCP/JSON-RPC 2.0'
      }
    });

    try {
      // Try stdio pool first (internal tools)
      const result = await this.mcpStdioPool.callTool(toolName, args, context);
      const duration = Date.now() - startTime;

      // Log success
      await this.logger.log({
        level: result.isError ? 'warn' : 'success',
        category: 'mcp',
        message: result.isError 
          ? `⚠️ MCP Tool Error: ${toolName} (${duration}ms)`
          : `✓ MCP Tool Complete: ${toolName} (${duration}ms)`,
        conversationId: context?.conversationId,
        generationId: context?.generationId,
        metadata: {
          toolName,
          duration,
          isError: result.isError || false,
          resultLength: result.content?.[0]?.text?.length || 0,
          protocol: 'MCP/stdio'
        }
      });

      return result;

    } catch (stdioError) {
      // Log the stdio error for debugging
      const stdioErrorMsg = stdioError instanceof Error ? stdioError.message : String(stdioError);
      console.log(`[Red] Stdio tool call failed (${toolName}): ${stdioErrorMsg}, falling back to HTTP/SSE`);
      
      // If tool not found in stdio pool, try external HTTP/SSE registry
      try {
        const result = await this.mcpRegistry.callTool(toolName, args, {
          conversationId: context?.conversationId,
          generationId: context?.generationId,
          messageId: context?.messageId
        });
        const duration = Date.now() - startTime;

        await this.logger.log({
          level: result.isError ? 'warn' : 'success',
          category: 'mcp',
          message: result.isError 
            ? `⚠️ MCP Tool Error: ${toolName} (${duration}ms)`
            : `✓ MCP Tool Complete: ${toolName} (${duration}ms)`,
          conversationId: context?.conversationId,
          generationId: context?.generationId,
          metadata: {
            toolName,
            duration,
            isError: result.isError || false,
            resultLength: result.content?.[0]?.text?.length || 0,
            protocol: 'MCP/HTTP'
          }
        });

        return result;

      } catch (httpError) {
        const duration = Date.now() - startTime;
        const errorMessage = httpError instanceof Error ? httpError.message : String(httpError);

        // Log error
        await this.logger.log({
          level: 'error',
          category: 'mcp',
          message: `✗ MCP Tool Failed: ${toolName} (${duration}ms)`,
          conversationId: context?.conversationId,
          generationId: context?.generationId,
          metadata: {
            toolName,
            duration,
            error: errorMessage,
            protocol: 'MCP (all transports)'
          }
        });

        throw httpError;
      }
    }
  }

  /**
   * Sanitize arguments for logging (remove sensitive data, truncate long values)
   */
  private sanitizeArgsForLogging(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        // Truncate long strings
        sanitized[key] = value.length > 200 ? value.substring(0, 200) + '...' : value;
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * Get all available MCP tools (stdio + HTTP/SSE)
   * @returns Array of available tools with their server info
   */
  public async getMcpTools(): Promise<Array<{ server: string; tools: any[] }>> {
    // Get stdio tools
    const stdioTools = await this.mcpStdioPool.getAllTools();
    
    // Get HTTP/SSE tools (legacy format conversion)
    const httpTools = this.mcpRegistry.getAllTools();
    const httpToolsByServer = httpTools.reduce((acc, item) => {
      if (!acc[item.server]) {
        acc[item.server] = [];
      }
      acc[item.server].push(item.tool);
      return acc;
    }, {} as Record<string, any[]>);
    
    const httpToolsArray = Object.entries(httpToolsByServer).map(([server, tools]) => ({
      server: `${server} (HTTP)`,
      tools
    }));
    
    return [...stdioTools, ...httpToolsArray];
  }

}