/**
 * RunPublisher
 *
 * Unified publisher for run state and events. Replaces the fragmented
 * MessageQueue + GraphEventPublisher + McpEventPublisher system.
 *
 * Key responsibilities:
 * - Maintain run state in Redis (run:{runId})
 * - Publish events to pub/sub channel (run:stream:{runId})
 * - Handle client ready signaling for streaming
 * - Provide state access and subscription methods
 *
 * @module lib/run/run-publisher
 */

import type { Redis } from 'ioredis';
import {
  type RunState,
  type RunEvent,
  type RunOutput,
  type ToolExecution,
  type TokenMetadata,
  RunKeys,
  RunConfig,
  createInitialRunState,
  createNodeProgress,
  createToolExecution,
} from './types';
import type { PersistentLogger } from '../logs/persistent-logger';

// Debug logging - set to true to enable verbose logs
const DEBUG = false;

/**
 * Options for RunPublisher constructor
 */
export interface RunPublisherOptions {
  /** Redis client instance */
  redis: Redis;
  /** Unique run identifier */
  runId: string;
  /** User executing the run */
  userId: string;
  /** TTL for run state in seconds (default: 1 hour) */
  stateTtl?: number;
  /** Optional PersistentLogger for MongoDB persistence */
  logger?: PersistentLogger;
}

/**
 * Subscription result
 */
export interface RunSubscription {
  /** Async generator yielding events */
  stream: AsyncGenerator<RunEvent, void, unknown>;
  /** Promise that resolves when subscription is ready */
  ready: Promise<void>;
  /** Cleanup function to unsubscribe */
  unsubscribe: () => Promise<void>;
}

/**
 * RunPublisher - Unified run state and event publisher
 *
 * Usage:
 * ```typescript
 * const publisher = new RunPublisher({ redis, runId, userId });
 * await publisher.init(graphId, graphName, input);
 *
 * // Publish events during execution
 * await publisher.nodeStart('node-1', 'llm', 'GPT Node');
 * await publisher.chunk('Hello ');
 * await publisher.chunk('World!');
 * await publisher.nodeComplete('node-1', 'node-2');
 *
 * await publisher.complete({ content: 'Hello World!' });
 * ```
 */
export class RunPublisher {
  private readonly redis: Redis;
  private readonly runId: string;
  private readonly userId: string;
  private readonly stateTtl: number;
  private readonly logger?: PersistentLogger;

  // Cached state for atomic updates
  private state: RunState | null = null;
  private initialized = false;

  constructor(options: RunPublisherOptions) {
    this.redis = options.redis;
    this.runId = options.runId;
    this.userId = options.userId;
    this.stateTtl = options.stateTtl ?? RunConfig.STATE_TTL_SECONDS;
    this.logger = options.logger;
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  get id(): string {
    return this.runId;
  }

  get user(): string {
    return this.userId;
  }

  // ===========================================================================
  // Persistent Logging Helper
  // ===========================================================================

  /**
   * Log to MongoDB via PersistentLogger (if available)
   * This ensures run events are persisted for LogViewer
   */
  private async persistLog(params: {
    level: 'info' | 'debug' | 'error' | 'warn';
    category: 'run' | 'graph' | 'node' | 'tool' | 'stream';
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.logger) return;

    try {
      await this.logger.log({
        level: params.level,
        category: params.category,
        message: params.message,
        conversationId: this.state?.conversationId,
        generationId: this.runId, // Use runId as generationId for correlation
        metadata: {
          runId: this.runId,
          userId: this.userId,
          graphId: this.state?.graphId,
          graphName: this.state?.graphName,
          ...params.metadata,
        },
      });
    } catch (error) {
      // Don't let logging errors affect run execution
      if (DEBUG) {
        console.error('[RunPublisher] persistLog error:', error);
      }
    }
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the run - must be called before any other methods
   */
  async init(
    graphId: string,
    graphName: string,
    input: Record<string, unknown>,
    conversationId?: string
  ): Promise<void> {
    if (this.initialized) {
      throw new Error(`RunPublisher already initialized for run ${this.runId}`);
    }

    this.state = createInitialRunState({
      runId: this.runId,
      userId: this.userId,
      graphId,
      graphName,
      input,
      conversationId,
    });

    await this.saveState();
    
    // Track active run for conversation if provided
    if (conversationId) {
      await this.redis.set(
        RunKeys.conversationRun(conversationId),
        this.runId,
        'EX',
        this.stateTtl
      );
    }
    
    await this.publish({
      type: 'run_start',
      graphId,
      graphName,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'info',
      category: 'run',
      message: `Run started: ${graphName}`,
      metadata: { graphId, graphName, input },
    });

    this.initialized = true;
  }

  /**
   * Mark run as completed successfully
   */
  async complete(output?: Partial<RunOutput>): Promise<void> {
    this.ensureInitialized();

    if (output) {
      if (output.content !== undefined) {
        this.state!.output.content = output.content;
      }
      if (output.thinking !== undefined) {
        this.state!.output.thinking = output.thinking;
      }
      if (output.data !== undefined) {
        this.state!.output.data = output.data;
      }
    }

    this.state!.status = 'completed';
    this.state!.completedAt = Date.now();

    await this.saveState();
    
    // Clean up conversation->run mapping
    if (this.state!.conversationId) {
      await this.redis.del(RunKeys.conversationRun(this.state!.conversationId));
    }
    
    await this.publish({
      type: 'run_complete',
      metadata: this.state!.metadata,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    const duration = this.state!.completedAt! - this.state!.startedAt;
    await this.persistLog({
      level: 'info',
      category: 'run',
      message: `Run completed: ${this.state!.graphName}`,
      metadata: {
        duration,
        nodesExecuted: this.state!.graph.nodesExecuted,
        tokenUsage: this.state!.metadata?.tokens?.total,
      },
    });
  }

  /**
   * Mark run as failed
   */
  async fail(error: string): Promise<void> {
    this.ensureInitialized();

    this.state!.status = 'error';
    this.state!.error = error;
    this.state!.completedAt = Date.now();

    await this.saveState();
    
    // Clean up conversation->run mapping
    if (this.state!.conversationId) {
      await this.redis.del(RunKeys.conversationRun(this.state!.conversationId));
    }
    
    await this.publish({
      type: 'run_error',
      error,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'error',
      category: 'run',
      message: `Run failed: ${error}`,
      metadata: { error },
    });
  }

  // ===========================================================================
  // Status Updates
  // ===========================================================================

  /**
   * Publish a status update (e.g., "routing", "processing", "searching")
   */
  async status(action: string, description?: string): Promise<void> {
    this.ensureInitialized();

    this.state!.currentStatus = { action, description };
    await this.saveState();
    await this.publish({
      type: 'status',
      action,
      description,
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Graph Events
  // ===========================================================================

  /**
   * Signal graph execution start
   */
  async graphStart(nodeCount: number, entryNodeId: string): Promise<void> {
    this.ensureInitialized();

    this.state!.status = 'running';
    this.state!.graph.entryNodeId = entryNodeId;

    await this.saveState();
    await this.publish({
      type: 'graph_start',
      runId: this.runId,
      graphId: this.state!.graphId,
      graphName: this.state!.graphName,
      nodeCount,
      entryNodeId,
      timestamp: Date.now(),
    });
  }

  /**
   * Signal graph execution complete
   */
  async graphComplete(exitNodeId?: string, nodesExecuted?: number): Promise<void> {
    this.ensureInitialized();

    const duration = Date.now() - this.state!.startedAt;
    if (exitNodeId) {
      this.state!.graph.exitNodeId = exitNodeId;
    }
    if (nodesExecuted !== undefined) {
      this.state!.graph.nodesExecuted = nodesExecuted;
    }

    await this.saveState();
    await this.publish({
      type: 'graph_complete',
      exitNodeId,
      nodesExecuted: this.state!.graph.nodesExecuted,
      duration,
      timestamp: Date.now(),
    });
  }

  /**
   * Signal graph execution error
   */
  async graphError(error: string, failedNodeId?: string): Promise<void> {
    this.ensureInitialized();

    await this.publish({
      type: 'graph_error',
      error,
      failedNodeId,
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Node Events
  // ===========================================================================

  /**
   * Signal node execution start
   */
  async nodeStart(
    nodeId: string,
    nodeType: string,
    nodeName: string
  ): Promise<void> {
    this.ensureInitialized();

    const timestamp = Date.now();

    // Initialize node progress
    this.state!.graph.nodeProgress[nodeId] = createNodeProgress({
      nodeName,
      nodeType,
    });
    this.state!.graph.nodeProgress[nodeId].status = 'running';
    this.state!.graph.nodeProgress[nodeId].startedAt = timestamp;
    this.state!.graph.executionPath.push(nodeId);

    // Log node start info for debugging
    if (DEBUG) {
      try {
         
        console.log(`[RunPublisher] nodeStart run=${this.runId} node=${nodeId}`);
      } catch (e) {
        // ignore
      }
    }
    await this.saveState();
    await this.publish({
      type: 'node_start',
      runId: this.runId,
      nodeId,
      nodeType,
      nodeName,
      timestamp,
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'info',
      category: 'node',
      message: `Node started: ${nodeName}`,
      metadata: { nodeId, nodeType, nodeName },
    });
  }

  /**
   * Signal node progress update
   */
  async nodeProgress(
    nodeId: string,
    step: string,
    options?: {
      index?: number;
      total?: number;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    this.ensureInitialized();

    const nodeProgress = this.state!.graph.nodeProgress[nodeId];
    if (nodeProgress) {
      nodeProgress.steps.push({
        name: step,
        timestamp: Date.now(),
        data: options?.data,
      });
    }

    await this.saveState();
    await this.publish({
      type: 'node_progress',
      nodeId,
      step,
      stepIndex: options?.index,
      totalSteps: options?.total,
      data: options?.data,
      timestamp: Date.now(),
    });
  }

  /**
   * Signal node execution complete
   */
  async nodeComplete(
    nodeId: string,
    nextNodeId?: string,
    output?: Record<string, unknown>
  ): Promise<void> {
    this.ensureInitialized();

    const nodeProgress = this.state!.graph.nodeProgress[nodeId];
    if (nodeProgress) {
      nodeProgress.status = 'completed';
      nodeProgress.completedAt = Date.now();
      nodeProgress.duration = nodeProgress.startedAt
        ? Date.now() - nodeProgress.startedAt
        : undefined;
    }
    // Log node complete info for debugging
    if (DEBUG) {
      try {
         
        console.log(`[RunPublisher] nodeComplete run=${this.runId} node=${nodeId} duration_ms=${nodeProgress?.duration ?? 'n/a'}`);
      } catch (e) {
        // ignore
      }
    }
    this.state!.graph.nodesExecuted++;

    // Merge output data if provided
    if (output) {
      this.state!.output.data = {
        ...this.state!.output.data,
        ...output,
      };
    }

    await this.saveState();
    await this.publish({
      type: 'node_complete',
      nodeId,
      nextNodeId,
      duration: nodeProgress?.duration ?? 0,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'info',
      category: 'node',
      message: `Node completed: ${nodeProgress?.nodeName ?? nodeId}`,
      metadata: {
        nodeId,
        nodeType: nodeProgress?.nodeType,
        duration: nodeProgress?.duration,
        nextNodeId,
      },
    });
  }

  /**
   * Signal node execution error
   */
  async nodeError(nodeId: string, error: string): Promise<void> {
    this.ensureInitialized();

    const nodeProgress = this.state!.graph.nodeProgress[nodeId];
    if (nodeProgress) {
      nodeProgress.status = 'error';
      nodeProgress.error = error;
      nodeProgress.completedAt = Date.now();
    }

    await this.saveState();
    await this.publish({
      type: 'node_error',
      nodeId,
      error,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'error',
      category: 'node',
      message: `Node error: ${error}`,
      metadata: { nodeId, error },
    });
  }

  // ===========================================================================
  // Streaming
  // ===========================================================================

  /**
   * Publish a content chunk
   */
  async chunk(content: string): Promise<void> {
    this.ensureInitialized();

    this.state!.output.content += content;
    // Don't save state on every chunk (too expensive)
    // State is saved periodically and on complete
    await this.publish({
      type: 'chunk',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Publish a thinking chunk
   */
  async thinkingChunk(content: string): Promise<void> {
    this.ensureInitialized();

    this.state!.output.thinking += content;
    // Don't save state on every chunk
    await this.publish({
      type: 'chunk',
      content,
      thinking: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Signal thinking phase complete
   */
  async thinkingComplete(): Promise<void> {
    this.ensureInitialized();

    await this.saveState(); // Save accumulated thinking
    await this.publish({
      type: 'thinking_complete',
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Tool Events
  // ===========================================================================

  /**
   * Signal tool execution start
   */
  async toolStart(
    toolId: string,
    toolName: string,
    toolType: string,
    options?: { input?: unknown }
  ): Promise<void> {
    this.ensureInitialized();

    const tool = createToolExecution({ toolId, toolName, toolType });
    this.state!.tools.push(tool);

    await this.saveState();
    await this.publish({
      type: 'tool_start',
      toolId,
      toolName,
      toolType,
      input: options?.input,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'info',
      category: 'tool',
      message: `Tool started: ${toolName}`,
      metadata: { toolId, toolName, toolType, input: options?.input },
    });
  }

  /**
   * Signal tool progress update
   */
  async toolProgress(
    toolId: string,
    step: string,
    options?: { progress?: number; data?: Record<string, unknown> }
  ): Promise<void> {
    this.ensureInitialized();

    const tool = this.findTool(toolId);
    if (tool) {
      tool.steps.push({
        name: step,
        timestamp: Date.now(),
        progress: options?.progress,
        data: options?.data,
      });
    }

    await this.saveState();
    await this.publish({
      type: 'tool_progress',
      toolId,
      step,
      progress: options?.progress,
      data: options?.data,
      timestamp: Date.now(),
    });
  }

  /**
   * Signal tool execution complete
   */
  async toolComplete(
    toolId: string,
    result?: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.ensureInitialized();

    const tool = this.findTool(toolId);
    if (tool) {
      tool.status = 'completed';
      tool.completedAt = Date.now();
      tool.duration = Date.now() - tool.startedAt;
      tool.result = result;
    }

    await this.saveState();
    await this.publish({
      type: 'tool_complete',
      toolId,
      result,
      metadata,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'info',
      category: 'tool',
      message: `Tool completed: ${tool?.toolName ?? toolId}`,
      metadata: {
        toolId,
        toolName: tool?.toolName,
        duration: tool?.duration,
        ...metadata,
      },
    });
  }

  /**
   * Signal tool execution error
   */
  async toolError(toolId: string, error: string): Promise<void> {
    this.ensureInitialized();

    const tool = this.findTool(toolId);
    if (tool) {
      tool.status = 'error';
      tool.completedAt = Date.now();
      tool.error = error;
    }

    await this.saveState();
    await this.publish({
      type: 'tool_error',
      toolId,
      error,
      timestamp: Date.now(),
    });

    // Persist to MongoDB
    await this.persistLog({
      level: 'error',
      category: 'tool',
      message: `Tool error: ${error}`,
      metadata: { toolId, toolName: tool?.toolName, error },
    });
  }

  // ===========================================================================
  // Metadata
  // ===========================================================================

  /**
   * Update token metadata
   */
  async setMetadata(metadata: TokenMetadata): Promise<void> {
    this.ensureInitialized();

    this.state!.metadata = {
      ...this.state!.metadata,
      ...metadata,
    };

    await this.saveState();
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

  /**
   * Get current run state from Redis
   */
  async getState(): Promise<RunState | null> {
    const data = await this.redis.get(RunKeys.state(this.runId));
    if (!data) return null;
    return JSON.parse(data) as RunState;
  }

  /**
   * Get cached state (faster, but may be stale)
   */
  getCachedState(): RunState | null {
    return this.state;
  }

  // ===========================================================================
  // Subscription
  // ===========================================================================

  /**
   * Subscribe to run events
   *
   * Returns an async generator that yields events as they are published.
   * Also returns a ready promise that resolves when the subscription is active.
   */
  subscribe(): RunSubscription {
    const channel = RunKeys.stream(this.runId);
    const subscriber = this.redis.duplicate();

    let resolveReady: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    // Create async generator for events
    const eventQueue: RunEvent[] = [];
    let resolveNext: ((value: IteratorResult<RunEvent, void>) => void) | null =
      null;
    let done = false;

    const messageHandler = (_ch: string, message: string) => {
      try {
        const event = JSON.parse(message) as RunEvent;

        // If there's a pending next(), resolve it immediately
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: event, done: false });
        } else {
          // Queue the event for later consumption
          eventQueue.push(event);
        }

        // Check for terminal events
        if (
          event.type === 'run_complete' ||
          event.type === 'run_error'
        ) {
          done = true;
        }
      } catch (error) {
        console.error('Failed to parse run event:', error);
      }
    };

    subscriber.on('message', messageHandler);

    // Start subscription
    subscriber.subscribe(channel).then(() => {
      resolveReady!();
    });

    async function* eventGenerator(): AsyncGenerator<RunEvent, void, unknown> {
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else if (!done) {
          // Wait for next event
          const result = await new Promise<IteratorResult<RunEvent, void>>(
            (resolve) => {
              resolveNext = resolve;
            }
          );
          if (!result.done) {
            yield result.value;
          }
        }
      }
    }

    const unsubscribe = async () => {
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true });
      }
      subscriber.off('message', messageHandler);
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    };

    return {
      stream: eventGenerator(),
      ready,
      unsubscribe,
    };
  }

  /**
   * Get initial state for reconnection
   *
   * Returns an 'init' event with current state that can be sent
   * to a client to replay state on reconnection.
   */
  async getInitEvent(): Promise<RunEvent | null> {
    const state = await this.getState();
    if (!state) return null;

    return {
      type: 'init',
      state,
      timestamp: Date.now(),
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized || !this.state) {
      throw new Error(
        `RunPublisher not initialized. Call init() first for run ${this.runId}`
      );
    }
  }

  private async saveState(): Promise<void> {
    if (!this.state) return;

    await this.redis.set(
      RunKeys.state(this.runId),
      JSON.stringify(this.state),
      'EX',
      this.stateTtl
    );
  }

  private async publish(event: RunEvent): Promise<void> {
    const channel = RunKeys.stream(this.runId);
    const eventsKey = RunKeys.events(this.runId);
    const eventJson = JSON.stringify(event);
    
    try {
      if (DEBUG) {
        const now = Date.now();
        const evtTs = (event as any).timestamp as number | undefined;
        const delta = evtTs ? now - evtTs : undefined;
         
        console.log(`[RunPublisher] publish run=${this.runId} type=${event.type} delta_ms=${delta ?? 'n/a'}`);
      }
    } catch (err) {
      // ignore logging errors
    }

    // Store event in list for replay AND publish to pub/sub for live subscribers
    // Using pipeline for atomicity
    await this.redis
      .pipeline()
      .rpush(eventsKey, eventJson)
      .expire(eventsKey, this.stateTtl)
      .publish(channel, eventJson)
      .exec();
  }

  /**
   * Get all events for this run (for replay when client connects late)
   */
  async getEvents(): Promise<RunEvent[]> {
    const eventsKey = RunKeys.events(this.runId);
    const events = await this.redis.lrange(eventsKey, 0, -1);
    return events.map(e => JSON.parse(e) as RunEvent);
  }

  /**
   * Get events starting from a specific index (for incremental replay)
   */
  async getEventsSince(startIndex: number): Promise<RunEvent[]> {
    const eventsKey = RunKeys.events(this.runId);
    const events = await this.redis.lrange(eventsKey, startIndex, -1);
    return events.map(e => JSON.parse(e) as RunEvent);
  }

  /**
   * Get the current event count
   */
  async getEventCount(): Promise<number> {
    const eventsKey = RunKeys.events(this.runId);
    return await this.redis.llen(eventsKey);
  }

  private findTool(toolId: string): ToolExecution | undefined {
    return this.state?.tools.find((t) => t.toolId === toolId);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new RunPublisher
 */
export function createRunPublisher(
  options: RunPublisherOptions
): RunPublisher {
  return new RunPublisher(options);
}

/**
 * Get the active run ID for a conversation (if any)
 */
export async function getActiveRunForConversation(
  redis: Redis,
  conversationId: string
): Promise<string | null> {
  const runId = await redis.get(RunKeys.conversationRun(conversationId));
  if (!runId) return null;
  
  // Verify the run still exists and is active
  const stateJson = await redis.get(RunKeys.state(runId));
  if (!stateJson) {
    // Run state expired - clean up the conversation mapping
    await redis.del(RunKeys.conversationRun(conversationId));
    return null;
  }
  
  const state = JSON.parse(stateJson) as RunState;
  if (state.status === 'completed' || state.status === 'error') {
    // Run finished - clean up the conversation mapping
    await redis.del(RunKeys.conversationRun(conversationId));
    return null;
  }
  
  return runId;
}

/**
 * Get the run state by ID
 */
export async function getRunState(
  redis: Redis,
  runId: string
): Promise<RunState | null> {
  const stateJson = await redis.get(RunKeys.state(runId));
  if (!stateJson) return null;
  return JSON.parse(stateJson) as RunState;
}
