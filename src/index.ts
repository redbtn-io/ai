/**
 * @file src/red.ts
 * @description The core library for the Red AI agent.
 */

// Load environment variables from .env early for library modules
import 'dotenv/config';

import { MemoryManager } from "./lib/memory/memory";
import { MessageQueue } from "./lib/memory/queue";
import { RedLog } from '@redbtn/redlog';
import { NeuronRegistry } from "./lib/neurons/NeuronRegistry";
import { GraphRegistry } from "./lib/graphs/GraphRegistry";
import * as background from "./functions/background";
import { run as runFunction } from "./functions/run";
import { McpRegistry } from "./lib/mcp/registry";
import { StdioServerPool } from "./lib/mcp/stdio-pool";
import { UserMcpManager, ToolWithSource } from "./lib/mcp/UserMcpManager";

// Export run types and function
export {
  run,
  isStreamingResult,
  type RunOptions,
  type RunResult,
  type StreamingRunResult,
  type ConnectionFetcher,
} from "./functions/run";

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

// Re-export redlog for consumers
export { RedLog } from '@redbtn/redlog';
export type { LogEntry as RedLogEntry, LogScope, LogQuery, RedLogConfig } from '@redbtn/redlog';
export { LogReader, LogStream, LogClient } from '@redbtn/redlog';
export { parseColorTagsToTailwind, parseColorTagsToHtml, parseColorTagsToAnsi, stripColorTags, ColorTags } from '@redbtn/redlog';

// Export thinking utilities for DeepSeek-R1 and similar models
export { extractThinking, logThinking, extractAndLogThinking } from "./lib/utils/thinking";

// Export Global State for cross-workflow persistence
export {
  GlobalStateClient,
  getGlobalStateClient,
  getGlobalValue,
  setGlobalValue,
} from "./lib/globalState";

// Export RAG (Retrieval-Augmented Generation) components
export { 
  VectorStoreManager,
  DocumentChunk,
  SearchResult,
  ChunkingConfig,
  SearchConfig,
  CollectionStats
} from "./lib/memory/vectors";

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
  UserMcpManager,
  ToolWithSource,
  McpConnectionConfig,
  TestResult as McpTestResult,
} from "./lib/mcp";

// Export Run system components (unified execution)
export {
  // Publisher
  RunPublisher,
  type RunPublisherOptions,
  type RunSubscription,
  createRunPublisher,
  getRunState,
  getActiveRunForConversation,
  // Lock
  RunLock,
  type LockResult,
  type AcquireLockOptions,
  type RunLockHandle,
  createRunLock,
  acquireRunLock,
  isConversationLocked,
  isGraphLocked, // deprecated
  // Types
  type RunState,
  type RunStatus,
  type RunOutput,
  type RunEvent,
  type RunEventType,
  RunKeys,
  RunConfig,
  createInitialRunState,
} from "./lib/run";

// Export Connection Manager for external auth/credential access
export {
  ConnectionManager,
  decryptCredentials,
  buildAuthHeaders,
  resolveCredentials,
  isTokenExpiring,
  type ConnectionCredentials,
  type TokenMetadata,
  type AccountInfo,
  type UserConnection,
  type ConnectionProvider,
  type ResolvedCredentials,
  type ConnectionContext,
} from "./lib/connections";

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
export { GraphConfig, GraphNodeConfig, GraphEdgeConfig, CompiledGraph } from "./lib/types/graph";
export { Graph, GraphDocument } from "./lib/models/Graph";

// Export Node model and utilities
export {
  NodeModel,
  getNodeConfig,
  saveNodeConfig,
  searchNodes,
  getAllTags,
  recordNodeUsage,
  cloneNodeForUser,
  getNodeConfigForUser,
  listSystemNodes,
  listUserNodes
} from "./lib/models/Node";
export type { NodeSearchOptions } from "./lib/models/Node";

// Export Document Parsers
export {
  DocumentParser,
  PDFParser,
  DocxParser,
  TextParser,
  MarkdownParser,
  ImageParser,
} from "./lib/parsers";
export type { ParsedDocument, ParseOptions } from "./lib/parsers";

// --- Type Definitions ---

/**
 * Defines the configuration required to initialize the Red instance.
 */
export interface RedConfig {
  redisUrl: string; // URL for connecting to the Redis instance, global state store
  vectorDbUrl: string; // URL for connecting to the vector database, short to medium term memory
  databaseUrl: string; // URL for connecting to the traditional database, long term memory
  chatLlmUrl: string; // URL for the chat LLM (e.g., Ollama on chatter.redbtn.io:11434)
  workLlmUrl: string; // URL for the worker LLM (e.g., Ollama on chatter.redbtn.io:11434)
  llmEndpoints?: { [agentName: string]: string }; // Map of named agents to specific LLM endpoint URLs
  disableMcp?: boolean; // Skip MCP stdio server initialization (for webapp, tools come from DB)
}

/**
 * Defines optional parameters for graph execution,
 * providing context about the request's origin and execution settings.
 */
export interface InvokeOptions {
  source?: {
    device?: 'phone' | 'speaker' | 'web';
    application?: 'redHome' | 'redChat' | 'redAssistant' | 'automation';
  };
  stream?: boolean; // Flag to enable streaming responses
  conversationId?: string; // Optional conversation ID - will be auto-generated if not provided
  generationId?: string; // Optional generation ID - will be auto-generated if not provided
  messageId?: string; // Optional message ID for Redis pub/sub streaming
  userMessageId?: string; // Optional user message ID from client request (stored in memory)
  userId?: string; // Required for per-user model loading and conversation ownership
  graphId?: string; // Optional graph ID to use (defaults to user's defaultGraphId)
  
  // Automation-specific options
  automationId?: string; // ID of the automation that triggered this run
  runId?: string; // Unique ID for this automation run
  skipConversation?: boolean; // Skip conversation creation (for workflow graphs)
  triggerType?: 'chat' | 'webhook' | 'schedule' | 'event' | 'manual'; // What triggered this run
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
  public log!: RedLog;
  public mcpRegistry!: McpRegistry; // For external HTTP/SSE servers
  public mcpStdioPool!: StdioServerPool; // For internal stdio servers
  public userMcpManager!: UserMcpManager; // For user's custom MCP connections
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
    
    // Initialize RedLog structured logging
    this.log = RedLog.create({
      redis,
      namespace: 'red',
      console: false,
      prefix: 'redlog',
    });
    
    // Initialize MCP registry for external HTTP/SSE servers
    this.mcpRegistry = new McpRegistry(this.messageQueue);
    
    // Initialize stdio server pool for internal tools (pass messageQueue for tool event publishing)
    this.mcpStdioPool = new StdioServerPool(undefined, this.messageQueue, this.log);
    
    // Initialize user MCP manager for per-user custom connections
    this.userMcpManager = new UserMcpManager();
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
    
    // Start internal stdio-based MCP servers (unless disabled for webapp mode)
    if (this.config.disableMcp) {
      process.stdout.write(`\r✓ Red AI initialized (MCP disabled, tools from DB)\n`);
    } else {
      try {
        await this.mcpStdioPool.start();
        const toolsInfo = await this.mcpStdioPool.getAllTools();
        const totalTools = toolsInfo.reduce((sum, info) => sum + info.tools.length, 0);
        process.stdout.write(`\r✓ Red AI initialized (${totalTools} MCP tools via stdio)\n`);
      } catch (error) {
        console.warn('⚠️ MCP stdio server startup failed:', error);
        console.warn('  Tool calls may fail. Check server scripts in redbtn/src/lib/mcp/servers/');
      }
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
    
    // Shutdown user MCP manager (disconnects user custom connections)
    try {
      await this.userMcpManager.shutdown();
      console.log('[Red] User MCP connections disconnected');
    } catch (error) {
      console.warn('[Red] Error shutting down user MCP manager:', error);
    }
    
    // Close Redis connection
    if (this.redis) {
      await this.redis.quit();
    }
    
    this.isLoaded = false;
    console.log('[Red] Shutdown complete');
  }

  /**
   * Executes a graph with the provided input using the unified run system.
   * Publishes events via RunPublisher for SSE streaming.
   * @param input The input data for the graph. For agent graphs, should include 'message' property.
   * @param options Metadata about the source of the request and execution settings
   * @returns RunResult with content, tokens, graphTrace, and runId (streaming handled externally via SSE)
   */
  public async run(input: Record<string, any> = {}, options: InvokeOptions = {}): Promise<any> {
    if (!options.userId) {
      throw new Error('userId is required for run()');
    }
    return runFunction(this, input, {
      userId: options.userId,
      graphId: options.graphId,
      conversationId: options.conversationId,
      runId: options.runId,
      stream: options.stream,
      source: options.source,
    });
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
   * Automatically routes to the correct MCP server:
   * 1. User's custom MCP servers (if userId provided)
   * 2. Internal stdio servers (global tools)
   * 3. External HTTP/SSE servers (mcpRegistry fallback)
   * @param toolName The name of the tool to call
   * @param args The arguments to pass to the tool
   * @param context Optional logging context (conversationId, generationId, messageId, userId)
   * @returns The tool execution result
   */
  public async callMcpTool(
    toolName: string, 
    args: Record<string, unknown>,
    context?: { conversationId?: string; generationId?: string; messageId?: string; userId?: string }
  ): Promise<any> {
    const startTime = Date.now();
    
    // DEBUG: Log userId for store_message calls
    if (toolName === 'store_message') {
      console.log(`[RED.callMcpTool] store_message called with userId:`, args.userId, 'args:', Object.keys(args));
    }
    
    // Log tool call start
    await this.log.log({
      level: 'info',
      message: `📡 MCP Tool Call: ${toolName}`,
      category: 'mcp',
      scope: { conversationId: context?.conversationId, generationId: context?.generationId },
      metadata: {
        toolName,
        args: this.sanitizeArgsForLogging(args),
        protocol: 'MCP/JSON-RPC 2.0'
      }
    });

    // 1. Try user's custom MCP servers first (if userId provided)
    if (context?.userId) {
      const connectionId = await this.userMcpManager.findToolConnection(context.userId, toolName);
      if (connectionId) {
        try {
          const result = await this.userMcpManager.callTool(context.userId, toolName, args, context);
          const duration = Date.now() - startTime;

          await this.log.log({
            level: result.isError ? 'warn' : 'success',
            message: result.isError 
              ? `⚠️ MCP Tool Error: ${toolName} (${duration}ms)`
              : `✓ MCP Tool Complete: ${toolName} (${duration}ms)`,
            category: 'mcp',
            scope: { conversationId: context?.conversationId, generationId: context?.generationId },
            metadata: {
              toolName,
              duration,
              isError: result.isError || false,
              resultLength: result.content?.[0]?.text?.length || 0,
              protocol: 'MCP/user-custom',
              connectionId,
            }
          });

          return result;
        } catch (userError) {
          console.log(`[Red] User custom tool call failed (${toolName}): ${userError}, falling back to global tools`);
        }
      }
    }

    try {
      // 2. Try stdio pool (global internal tools)
      const result = await this.mcpStdioPool.callTool(toolName, args, context);
      const duration = Date.now() - startTime;

      // Log success with enriched metadata
      const resultText = result.content?.[0]?.text || '';
      const resultLength = resultText.length;
      
      // Build enriched metadata for the log viewer
      const completionMeta: Record<string, unknown> = {
        toolName,
        duration,
        isError: result.isError || false,
        resultLength,
        protocol: 'MCP/stdio',
      };

      // Add tool-specific metadata for richer log entries
      if (toolName === 'web_search') {
        // Extract source count from "## Title" headers in result
        const sourceHeaders = (resultText.match(/^## /gm) || []).length;
        completionMeta.sourceCount = sourceHeaders;
        // Include a short preview (first 300 chars) for debugging result quality
        completionMeta.resultPreview = resultText.length > 300 ? resultText.substring(0, 300) + '...' : resultText;
        completionMeta.query = args.query;
      } else if (toolName === 'scrape_url') {
        completionMeta.url = args.url;
        completionMeta.resultPreview = resultText.length > 300 ? resultText.substring(0, 300) + '...' : resultText;
      }

      await this.log.log({
        level: result.isError ? 'warn' : 'success',
        message: result.isError 
          ? `⚠️ MCP Tool Error: ${toolName} (${duration}ms)`
          : `✓ MCP Tool Complete: ${toolName} (${duration}ms)`,
        category: 'mcp',
        scope: { conversationId: context?.conversationId, generationId: context?.generationId },
        metadata: completionMeta,
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

        await this.log.log({
          level: result.isError ? 'warn' : 'success',
          message: result.isError 
            ? `⚠️ MCP Tool Error: ${toolName} (${duration}ms)`
            : `✓ MCP Tool Complete: ${toolName} (${duration}ms)`,
          category: 'mcp',
          scope: { conversationId: context?.conversationId, generationId: context?.generationId },
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
        await this.log.log({
          level: 'error',
          message: `✗ MCP Tool Failed: ${toolName} (${duration}ms)`,
          category: 'mcp',
          scope: { conversationId: context?.conversationId, generationId: context?.generationId },
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
   * @deprecated Use getAllTools() instead for source-aware tool listing
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

  /**
   * Get all available tools with source information (global + user's custom)
   * @param userId Optional user ID to include their custom MCP tools
   * @returns Tools organized by source with metadata
   */
  public async getAllTools(userId?: string): Promise<{
    tools: ToolWithSource[];
    toolsByServer: Array<{ server: string; source: 'global' | 'custom'; connectionId?: string; tools: ToolWithSource[] }>;
    sources: { global: string[]; custom: string[] };
    count: number;
  }> {
    const allTools: ToolWithSource[] = [];
    const toolsByServer: Array<{ server: string; source: 'global' | 'custom'; connectionId?: string; tools: ToolWithSource[] }> = [];
    const sources = { global: [] as string[], custom: [] as string[] };

    // 1. Get global stdio tools
    const stdioTools = await this.mcpStdioPool.getAllTools();
    for (const { server, tools } of stdioTools) {
      sources.global.push(server);
      const serverTools: ToolWithSource[] = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        source: 'global' as const,
        serverName: server,
      }));
      allTools.push(...serverTools);
      toolsByServer.push({ server, source: 'global', tools: serverTools });
    }

    // 2. Get global HTTP/SSE tools (mcpRegistry)
    const httpTools = this.mcpRegistry.getAllTools();
    const httpByServer: Record<string, ToolWithSource[]> = {};
    for (const { server, tool } of httpTools) {
      if (!httpByServer[server]) {
        httpByServer[server] = [];
        sources.global.push(`${server} (HTTP)`);
      }
      const toolWithSource: ToolWithSource = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        source: 'global',
        serverName: `${server} (HTTP)`,
      };
      httpByServer[server].push(toolWithSource);
      allTools.push(toolWithSource);
    }
    for (const [server, tools] of Object.entries(httpByServer)) {
      toolsByServer.push({ server: `${server} (HTTP)`, source: 'global', tools });
    }

    // 3. Get user's custom tools (if userId provided)
    if (userId) {
      const userTools = await this.userMcpManager.getUserTools(userId);
      
      // Group by server
      const byConnection: Record<string, { name: string; connectionId: string; tools: ToolWithSource[] }> = {};
      for (const tool of userTools) {
        if (!tool.connectionId) continue;
        if (!byConnection[tool.connectionId]) {
          byConnection[tool.connectionId] = {
            name: tool.serverName,
            connectionId: tool.connectionId,
            tools: [],
          };
          sources.custom.push(tool.serverName);
        }
        byConnection[tool.connectionId].tools.push(tool);
        allTools.push(tool);
      }
      
      for (const { name, connectionId, tools } of Object.values(byConnection)) {
        toolsByServer.push({ server: name, source: 'custom', connectionId, tools });
      }
    }

    return {
      tools: allTools,
      toolsByServer,
      sources,
      count: allTools.length,
    };
  }

  /**
   * Get all available tools from the database (for webapp mode with MCP disabled)
   * Workers register their tools on startup, webapp queries the DB
   * @param userId Optional user ID to include their custom tools
   */
  public async getToolsFromRegistry(userId?: string): Promise<{
    tools: ToolWithSource[];
    toolsByServer: Array<{ server: string; source: 'global' | 'custom'; connectionId?: string; tools: ToolWithSource[] }>;
    sources: { global: string[]; custom: string[] };
    count: number;
  }> {
    const { ToolRegistry } = await import('./lib/models/ToolRegistry');
    const result = await ToolRegistry.getActiveTools(userId);
    
    // Default input schema for tools that don't have one
    const defaultInputSchema = { type: 'object' as const, properties: {} };
    
    const tools: ToolWithSource[] = result.tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: (t.inputSchema as ToolWithSource['inputSchema']) || defaultInputSchema,
      source: t.source as 'global' | 'custom',
      serverName: t.serverName,
      connectionId: t.connectionId,
    }));
    
    const toolsByServer = result.toolsByServer.map(s => ({
      server: s.serverName,
      source: s.source,
      connectionId: s.connectionId,
      tools: s.tools.map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: (t.inputSchema as ToolWithSource['inputSchema']) || defaultInputSchema,
        source: s.source,
        serverName: s.serverName,
        connectionId: s.connectionId,
      })) as ToolWithSource[],
    }));
    
    const sources = {
      global: toolsByServer.filter(s => s.source === 'global').map(s => s.server),
      custom: toolsByServer.filter(s => s.source === 'custom').map(s => s.server),
    };
    
    return { tools, toolsByServer, sources, count: tools.length };
  }

  /**
   * Register tools to the database (for worker nodes)
   * Call this after MCP servers are initialized to make tools discoverable by webapp
   */
  public async registerToolsToDb(): Promise<void> {
    if (!this.nodeId) {
      throw new Error('Node must be loaded before registering tools');
    }
    
    const { ToolRegistry } = await import('./lib/models/ToolRegistry');
    
    // Get all tools from stdio pool
    const stdioTools = await this.mcpStdioPool.getAllTools();
    
    const servers = stdioTools.map(({ server, tools }) => ({
      serverName: server,
      source: 'global' as const,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));
    
    await ToolRegistry.registerTools(this.nodeId, servers);
    console.log(`[Red] Registered ${servers.reduce((sum, s) => sum + s.tools.length, 0)} tools to database`);
  }

  /**
   * Update tool registry heartbeat (call periodically to keep registration active)
   */
  public async heartbeatToolRegistry(): Promise<void> {
    if (!this.nodeId) return;
    
    const { ToolRegistry } = await import('./lib/models/ToolRegistry');
    await ToolRegistry.heartbeat(this.nodeId);
  }

  /**
   * Deactivate tool registration (call on shutdown)
   */
  public async deactivateToolRegistry(): Promise<void> {
    if (!this.nodeId) return;
    
    const { ToolRegistry } = await import('./lib/models/ToolRegistry');
    await ToolRegistry.deactivate(this.nodeId);
  }

}