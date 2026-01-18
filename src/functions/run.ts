/**
 * Graph Execution
 *
 * Clean execution engine focused purely on graph execution.
 * No message storage, no conversation management - those are caller responsibilities.
 *
 * Features:
 * - Uses RunPublisher for unified event publishing
 * - Acquires distributed lock per user+graph
 * - Returns RunResult with clean separation of content/thinking/data
 * - Callers (Chat API, Automation API) handle their own storage
 *
 * @module functions/run
 */

import type { Redis } from 'ioredis';
import type { Red } from '../index';
import { SYSTEM_TEMPLATES } from '../lib/types/graph';
import {
  RunPublisher,
  RunLock,
  type RunState,
  type RunLockHandle,
  createRunPublisher,
} from '../lib/run';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for run execution
 */
export interface RunOptions {
  /** Required: User executing the graph */
  userId: string;

  /** Graph ID to execute (defaults to user's defaultGraphId) */
  graphId?: string;

  /** Conversation ID for context loading (optional for automations) */
  conversationId?: string;

  /** Unique run identifier (auto-generated if not provided) */
  runId?: string;

  /** Enable streaming (default: true) */
  stream?: boolean;

  /** Source metadata for logging */
  source?: {
    device?: 'phone' | 'speaker' | 'web';
    application?: 'redHome' | 'redChat' | 'redAssistant' | 'automation';
  };
}

/**
 * Result from a completed run
 */
export interface RunResult {
  /** Unique run identifier */
  runId: string;

  /** Graph that was executed */
  graphId: string;
  graphName: string;

  /** Final status */
  status: 'completed' | 'error';

  /** Accumulated response content */
  content: string;

  /** Accumulated thinking/reasoning (extracted from <think> tags) */
  thinking: string;

  /** Final graph state.data */
  data: Record<string, unknown>;

  /** Error message if status is 'error' */
  error?: string;

  /** Execution metadata */
  metadata: {
    startedAt: number;
    completedAt: number;
    duration: number;
    nodesExecuted: number;
    executionPath: string[];
    model?: string;
    tokens?: {
      input?: number;
      output?: number;
      total?: number;
    };
  };

  /** Graph trace for visualization */
  graphTrace: {
    executionPath: string[];
    nodeProgress: Record<string, {
      status: 'pending' | 'running' | 'completed' | 'error';
      nodeName: string;
      nodeType: string;
      startedAt?: number;
      completedAt?: number;
      error?: string;
    }>;
    startTime?: number;
    endTime?: number;
  };

  /** Tool executions during the run */
  tools: RunState['tools'];
}

/**
 * Streaming run result - yields events during execution
 */
export interface StreamingRunResult {
  /** Unique run identifier */
  runId: string;

  /** The RunPublisher for subscribing to events */
  publisher: RunPublisher;

  /** Promise that resolves when run completes */
  completion: Promise<RunResult>;
}

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_GRAPH_ID = SYSTEM_TEMPLATES.DEFAULT;

/**
 * Generate a unique run ID
 */
function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// =============================================================================
// User Settings
// =============================================================================

interface UserSettings {
  accountTier: number;
  defaultNeuronId: string;
  defaultWorkerNeuronId: string;
  defaultGraphId: string;
}

/**
 * Load user settings from MongoDB
 */
async function loadUserSettings(userId: string): Promise<UserSettings> {
  const defaults: UserSettings = {
    accountTier: 4, // FREE tier
    defaultNeuronId: 'red-neuron',
    defaultWorkerNeuronId: 'red-neuron',
    defaultGraphId: DEFAULT_GRAPH_ID,
  };

  try {
    const mongoose = require('mongoose');

    // Get or create User model
    let User;
    try {
      User = mongoose.model('User');
    } catch {
      const userSchema = new mongoose.Schema(
        {},
        { collection: 'users', strict: false }
      );
      User = mongoose.model('User', userSchema);
    }

    const user = await User.findById(userId).lean();
    if (user) {
      return {
        accountTier: user.accountLevel ?? defaults.accountTier,
        defaultNeuronId: user.defaultNeuronId || defaults.defaultNeuronId,
        defaultWorkerNeuronId:
          user.defaultWorkerNeuronId || defaults.defaultWorkerNeuronId,
        defaultGraphId: user.defaultGraphId || defaults.defaultGraphId,
      };
    }

    console.warn(`[run] User ${userId} not found, using defaults`);
    return defaults;
  } catch (error) {
    console.error('[run] Error loading user settings:', error);
    return defaults;
  }
}

// =============================================================================
// Graph Loading
// =============================================================================

interface LoadedGraph {
  compiledGraph: any;
  graphId: string;
  graphName: string;
}

/**
 * Load and compile graph with fallback
 */
async function loadGraph(
  red: Red,
  graphId: string,
  userId: string
): Promise<LoadedGraph> {
  try {
    const compiledGraph = await red.graphRegistry.getGraph(graphId, userId);
    return {
      compiledGraph,
      graphId,
      graphName: compiledGraph.config?.name || graphId,
    };
  } catch (error: any) {
    const isRecoverable =
      error.name === 'GraphAccessDeniedError' ||
      error.name === 'GraphNotFoundError' ||
      error.message?.includes('requires tier') ||
      error.message?.includes('not found');

    if (isRecoverable && graphId !== DEFAULT_GRAPH_ID) {
      console.warn(
        `[run] Graph ${graphId} not accessible, falling back to ${DEFAULT_GRAPH_ID}`
      );
      return loadGraph(red, DEFAULT_GRAPH_ID, userId);
    }

    throw new Error(`Failed to load graph '${graphId}': ${error.message}`);
  }
}

// =============================================================================
// Thinking Extraction
// =============================================================================

interface ThinkingResult {
  thinking: string;
  cleanedContent: string;
}

/**
 * Extract thinking from content (handles <think>...</think> tags)
 */
function extractThinkingFromContent(content: string): ThinkingResult {
  const thinkingRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinking = '';
  let cleanedContent = content;

  let match;
  while ((match = thinkingRegex.exec(content)) !== null) {
    thinking += match[1].trim() + '\n';
  }

  cleanedContent = content.replace(thinkingRegex, '').trim();

  return {
    thinking: thinking.trim(),
    cleanedContent,
  };
}

// =============================================================================
// Initial State Builder
// =============================================================================

/**
 * Build initial state for graph execution
 */
function buildInitialState(
  red: Red,
  input: Record<string, unknown>,
  options: RunOptions,
  userSettings: UserSettings,
  runId: string,
  publisher: RunPublisher
): Record<string, unknown> {
  const message = (input.message as string) || '';

  const systemPrompt =
    process.env.SYSTEM_PROMPT ||
    `You are Red, an AI assistant developed by redbtn.io.
Current date: ${new Date().toLocaleDateString()}
Device: ${options.source?.device || 'unknown'}
Application: ${options.source?.application || 'unknown'}

CRITICAL RULES:
1. NEVER mention "knowledge cutoff", "training data", "as of my knowledge", or any limitations
2. NEVER introduce yourself unless this is the FIRST message in a new conversation or you're asked to do so
3. NEVER add disclaimers like "please note" or "for the most up-to-date information"
4. NEVER repeat or rephrase the user's question in your response - just answer it directly
5. NEVER say things like "searching for...", "looking up...", or mention what search query was used
6. If you have search results, use them directly and confidently
7. Be concise and helpful - answer the question directly without extra explanations`;

  const now = new Date();

  return {
    // Infrastructure components
    neuronRegistry: red.neuronRegistry,
    memory: red.memory,
    messageQueue: red.messageQueue, // Legacy - will be removed in Phase 3
    logger: red.logger,
    mcpClient: {
      callTool: (
        toolName: string,
        args: Record<string, unknown>,
        meta?: any
      ) => red.callMcpTool(toolName, args, meta),
    },

    // NEW: RunPublisher for unified event publishing
    runPublisher: publisher,

    // Universal Node Data
    data: {
      query: { message },
      input,
      options: { ...options, runId },
      runId,
      conversationId: options.conversationId,
      messages: message ? [{ role: 'user', content: message }] : [],
      userId: options.userId,
      accountTier: userSettings.accountTier,
      defaultNeuronId: userSettings.defaultNeuronId,
      defaultWorkerNeuronId: userSettings.defaultWorkerNeuronId,
      systemMessage: systemPrompt,
      currentDateISO: now.toISOString(),
      currentDate: now.toLocaleDateString(),
      currentDateTime: now.toLocaleString(),
    },
  };
}

// =============================================================================
// Non-Streaming Execution
// =============================================================================

/**
 * Execute graph without streaming
 */
async function executeNonStreaming(
  red: Red,
  compiledGraph: any,
  initialState: Record<string, unknown>,
  publisher: RunPublisher,
  userSettings: UserSettings
): Promise<RunResult> {
  const runId = publisher.id;

  try {
    // Invoke the graph
    const result = await compiledGraph.graph.invoke(initialState);

    // Extract response
    const rawResponse = result.data?.response || result.response;
    const responseContent =
      rawResponse === undefined
        ? ''
        : typeof rawResponse === 'string'
        ? rawResponse
        : rawResponse?.content || '';

    // Extract thinking
    const { thinking, cleanedContent } =
      extractThinkingFromContent(responseContent);

    // Get final state
    const finalState = publisher.getCachedState();

    // Complete the run
    await publisher.complete({
      content: cleanedContent,
      thinking,
      data: result.data || {},
    });

    const state = await publisher.getState();

    return {
      runId,
      graphId: state?.graphId || '',
      graphName: state?.graphName || '',
      status: 'completed',
      content: cleanedContent,
      thinking,
      data: result.data || {},
      metadata: {
        startedAt: state?.startedAt || Date.now(),
        completedAt: state?.completedAt || Date.now(),
        duration: state?.completedAt
          ? state.completedAt - state.startedAt
          : 0,
        nodesExecuted: state?.graph.nodesExecuted || 0,
        executionPath: state?.graph.executionPath || [],
        model: userSettings.defaultNeuronId,
        tokens: state?.metadata?.tokens,
      },
      graphTrace: {
        executionPath: state?.graph.executionPath || [],
        nodeProgress: Object.fromEntries(
          Object.entries(state?.graph.nodeProgress || {}).map(([nodeId, progress]) => [
            nodeId,
            {
              status: progress.status,
              nodeName: progress.nodeName,
              nodeType: progress.nodeType,
              startedAt: progress.startedAt,
              completedAt: progress.completedAt,
              error: progress.error,
            },
          ])
        ),
        startTime: state?.startedAt,
        endTime: state?.completedAt,
      },
      tools: state?.tools || [],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    await publisher.fail(errorMessage);

    const state = await publisher.getState();

    return {
      runId,
      graphId: state?.graphId || '',
      graphName: state?.graphName || '',
      status: 'error',
      content: '',
      thinking: '',
      data: {},
      error: errorMessage,
      metadata: {
        startedAt: state?.startedAt || Date.now(),
        completedAt: Date.now(),
        duration: state?.startedAt ? Date.now() - state.startedAt : 0,
        nodesExecuted: state?.graph.nodesExecuted || 0,
        executionPath: state?.graph.executionPath || [],
      },
      graphTrace: {
        executionPath: state?.graph.executionPath || [],
        nodeProgress: Object.fromEntries(
          Object.entries(state?.graph.nodeProgress || {}).map(([nodeId, progress]) => [
            nodeId,
            {
              status: progress.status,
              nodeName: progress.nodeName,
              nodeType: progress.nodeType,
              startedAt: progress.startedAt,
              completedAt: progress.completedAt,
              error: progress.error,
            },
          ])
        ),
        startTime: state?.startedAt,
        endTime: Date.now(),
      },
      tools: state?.tools || [],
    };
  }
}

// =============================================================================
// Streaming Execution
// =============================================================================

/**
 * Execute graph with streaming
 */
async function executeStreaming(
  red: Red,
  compiledGraph: any,
  initialState: Record<string, unknown>,
  publisher: RunPublisher,
  userSettings: UserSettings
): Promise<RunResult> {
  const runId = publisher.id;

  let fullContent = '';
  let thinkingBuffer = '';
  let inThinkingTag = false;
  let pendingBuffer = '';

  try {
    const stream = compiledGraph.graph.streamEvents(initialState, {
      version: 'v1',
    });

    for await (const event of stream) {
      const runName = event.metadata?.langgraph_node || '';
      const isRespondNode = runName === 'respond' || runName === 'responder';

      // Stream content from respond node
      if (
        event.event === 'on_llm_stream' &&
        event.data?.chunk?.content &&
        isRespondNode
      ) {
        const content = event.data.chunk.content;
        pendingBuffer += content;

        // Process pending buffer
        while (pendingBuffer.length > 8) {
          // Check for opening think tag
          if (!inThinkingTag && pendingBuffer.startsWith('<think>')) {
            inThinkingTag = true;
            pendingBuffer = pendingBuffer.slice(7);
            continue;
          }

          // Check for closing think tag
          if (inThinkingTag && pendingBuffer.startsWith('</think>')) {
            inThinkingTag = false;
            pendingBuffer = pendingBuffer.slice(8);

            // Signal thinking complete
            await publisher.thinkingComplete();
            continue;
          }

          // Process one character
          const char = pendingBuffer[0];
          pendingBuffer = pendingBuffer.slice(1);

          if (inThinkingTag) {
            thinkingBuffer += char;
            await publisher.thinkingChunk(char);
          } else {
            fullContent += char;
            await publisher.chunk(char);
          }
        }
      }

      // Handle direct response (no LLM stream)
      if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
        const graphOutput = event.data?.output;
        const responseContent =
          graphOutput?.data?.response?.content || graphOutput?.data?.response;

        if (
          responseContent &&
          typeof responseContent === 'string' &&
          !fullContent
        ) {
          const { thinking, cleanedContent } =
            extractThinkingFromContent(responseContent);

          if (thinking) {
            thinkingBuffer = thinking;
            // Publish thinking in chunks
            for (const char of thinking) {
              await publisher.thinkingChunk(char);
            }
            await publisher.thinkingComplete();
          }

          fullContent = cleanedContent;
          for (const char of cleanedContent) {
            await publisher.chunk(char);
          }
        }
      }
    }

    // Flush remaining buffer
    while (pendingBuffer.length > 0) {
      const char = pendingBuffer[0];
      pendingBuffer = pendingBuffer.slice(1);

      if (inThinkingTag) {
        thinkingBuffer += char;
        await publisher.thinkingChunk(char);
      } else {
        fullContent += char;
        await publisher.chunk(char);
      }
    }

    // Complete the run
    await publisher.complete({
      content: fullContent,
      thinking: thinkingBuffer,
      data: (initialState as any).data || {},
    });

    const state = await publisher.getState();

    return {
      runId,
      graphId: state?.graphId || '',
      graphName: state?.graphName || '',
      status: 'completed',
      content: fullContent,
      thinking: thinkingBuffer,
      data: (initialState as any).data || {},
      metadata: {
        startedAt: state?.startedAt || Date.now(),
        completedAt: state?.completedAt || Date.now(),
        duration: state?.completedAt
          ? state.completedAt - state.startedAt
          : 0,
        nodesExecuted: state?.graph.nodesExecuted || 0,
        executionPath: state?.graph.executionPath || [],
        model: userSettings.defaultNeuronId,
        tokens: state?.metadata?.tokens,
      },
      graphTrace: {
        executionPath: state?.graph.executionPath || [],
        nodeProgress: Object.fromEntries(
          Object.entries(state?.graph.nodeProgress || {}).map(([nodeId, progress]) => [
            nodeId,
            {
              status: progress.status,
              nodeName: progress.nodeName,
              nodeType: progress.nodeType,
              startedAt: progress.startedAt,
              completedAt: progress.completedAt,
              error: progress.error,
            },
          ])
        ),
        startTime: state?.startedAt,
        endTime: state?.completedAt,
      },
      tools: state?.tools || [],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    await publisher.fail(errorMessage);

    const state = await publisher.getState();

    return {
      runId,
      graphId: state?.graphId || '',
      graphName: state?.graphName || '',
      status: 'error',
      content: fullContent,
      thinking: thinkingBuffer,
      data: {},
      error: errorMessage,
      metadata: {
        startedAt: state?.startedAt || Date.now(),
        completedAt: Date.now(),
        duration: state?.startedAt ? Date.now() - state.startedAt : 0,
        nodesExecuted: state?.graph.nodesExecuted || 0,
        executionPath: state?.graph.executionPath || [],
      },
      graphTrace: {
        executionPath: state?.graph.executionPath || [],
        nodeProgress: Object.fromEntries(
          Object.entries(state?.graph.nodeProgress || {}).map(([nodeId, progress]) => [
            nodeId,
            {
              status: progress.status,
              nodeName: progress.nodeName,
              nodeType: progress.nodeType,
              startedAt: progress.startedAt,
              completedAt: progress.completedAt,
              error: progress.error,
            },
          ])
        ),
        startTime: state?.startedAt,
        endTime: Date.now(),
      },
      tools: state?.tools || [],
    };
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute a graph with the provided input
 *
 * This is a clean execution function that:
 * - Loads user settings and graph
 * - Acquires a distributed lock (user+graph)
 * - Creates a RunPublisher for unified event publishing
 * - Executes the graph (streaming or non-streaming)
 * - Returns a clean RunResult
 *
 * What this function does NOT do:
 * - Store messages (caller responsibility)
 * - Manage conversations (caller responsibility)
 * - Trigger background tasks (caller responsibility)
 *
 * @param red The Red instance
 * @param input The input data for the graph
 * @param options Execution options (must include userId)
 * @returns For streaming: StreamingRunResult with publisher and completion promise
 *          For non-streaming: RunResult with final content
 */
export async function run(
  red: Red,
  input: Record<string, unknown>,
  options: RunOptions
): Promise<RunResult | StreamingRunResult> {
  const { userId } = options;
  if (!userId) {
    throw new Error('[run] userId is required');
  }

  const runId = options.runId || generateRunId();
  const stream = options.stream ?? true;

  console.log(`[run] Starting run ${runId} for user ${userId}`);

  // 1. Load user settings
  const userSettings = await loadUserSettings(userId);
  const graphId = options.graphId || userSettings.defaultGraphId;

  // 2. Load graph
  const { compiledGraph, graphId: actualGraphId, graphName } = await loadGraph(
    red,
    graphId,
    userId
  );

  console.log(`[run] Using graph: ${actualGraphId} (${graphName})`);

  // 3. Get Redis client
  const redis = (red as any).redis as Redis;
  if (!redis) {
    throw new Error('[run] Redis client not available');
  }

  // 4. Acquire lock (per conversation, not per graph)
  // This allows the same graph to run in multiple conversations simultaneously
  // For automations without conversationId, use runId as the lock key
  const lockKey = options.conversationId || runId;
  const runLock = new RunLock(redis);
  const lock = await runLock.acquire(lockKey);

  if (!lock) {
    throw new Error(
      `[run] Conversation ${lockKey} already has an active run`
    );
  }

  console.log(`[run] Acquired lock for conversation ${lockKey}`);

  // 5. Create RunPublisher with logger for MongoDB persistence
  const publisher = createRunPublisher({
    redis,
    runId,
    userId,
    logger: red.logger,
  });

  // 6. Initialize run
  console.log(`[run] ${new Date().toISOString()} Calling publisher.init() for run ${runId}`);
  await publisher.init(actualGraphId, graphName, input as Record<string, unknown>, options.conversationId);
  console.log(`[run] ${new Date().toISOString()} publisher.init() complete for run ${runId}`);

  // 7. Build initial state
  const initialState = buildInitialState(
    red,
    input,
    options,
    userSettings,
    runId,
    publisher
  );

  // 8. Publish graph start
  const nodeCount = compiledGraph.config?.nodes?.length || 0;
  const entryNodeId = compiledGraph.config?.nodes?.[0]?.id || 'entry';
  console.log(`[run] ${new Date().toISOString()} Publishing graph_start for run ${runId}`);
  await publisher.graphStart(nodeCount, entryNodeId);

  // 9. Execute
  const cleanup = async () => {
    await lock.release();
    console.log(`[run] Released lock for conversation ${lockKey}`);
  };

  if (stream) {
    // For streaming, return immediately with publisher
    // Execution starts immediately - events are stored in Redis list for replay
    // SSE clients can connect anytime and catch up on missed events
    const completion = (async () => {
      try {
        console.log(`[run] ${new Date().toISOString()} Starting execution for run ${runId}`);
        
        return await executeStreaming(
          red,
          compiledGraph,
          initialState,
          publisher,
          userSettings
        );
      } finally {
        await cleanup();
      }
    })();

    return {
      runId,
      publisher,
      completion,
    };
  } else {
    // For non-streaming, execute and return result
    try {
      return await executeNonStreaming(
        red,
        compiledGraph,
        initialState,
        publisher,
        userSettings
      );
    } finally {
      await cleanup();
    }
  }
}

// =============================================================================
// Helper: Check if result is streaming
// =============================================================================

/**
 * Type guard to check if result is a streaming result
 */
export function isStreamingResult(
  result: RunResult | StreamingRunResult
): result is StreamingRunResult {
  return 'publisher' in result && 'completion' in result;
}
