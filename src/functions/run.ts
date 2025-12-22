/**
 * Graph execution and streaming utilities
 */

import type { Red } from '../index';
import type { InvokeOptions } from '../index';
import { SYSTEM_TEMPLATES } from '../lib/types/graph';
import * as background from './background';

const DEFAULT_GRAPH_ID = SYSTEM_TEMPLATES.DEFAULT;

/**
 * Active streams tracker for memory leak prevention (Pre-Phase 2.5 Part 4)
 * Maps generationId to AbortController for cleanup
 */
const activeStreams = new Map<string, AbortController>();

/**
 * Aborts an active stream by generationId
 * @param generationId The generation ID of the stream to abort
 * @returns true if stream was found and aborted, false otherwise
 */
export function abortStream(generationId: string): boolean {
  const controller = activeStreams.get(generationId);
  if (controller) {
    console.log(`[Run] Aborting stream for generation ${generationId}`);
    controller.abort();
    activeStreams.delete(generationId);
    return true;
  }
  console.warn(`[Run] No active stream found for generation ${generationId}`);
  return false;
}

/**
 * Gets the count of active streams
 * @returns Number of currently active streams
 */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}

/**
 * Executes a graph with the provided input.
 * Automatically manages conversation history, memory, and summarization.
 * 
 * @param red The Red instance
 * @param input The input data for the graph. For agent graphs, must include 'message' property.
 * @param options Metadata about the source of the request and execution settings (MUST include userId)
 * @returns For non-streaming: the full AIMessage object with content, tokens, metadata, and conversationId.
 *          For streaming: an async generator that yields metadata first (with conversationId), then string chunks, then finally the full AIMessage.
 */
export async function run(
  red: Red,
  input: Record<string, any>,
  options: InvokeOptions = {}
): Promise<any | AsyncGenerator<string | any, void, unknown>> {
  console.log('[Run] ========== FUNCTION ENTRY ==========');
  console.log('[Run] options:', JSON.stringify(options, null, 2));
  // Require userId for per-user model loading and tracking
  const userId = options.userId;
  if (!userId) {
    throw new Error('[Run] userId is required in options for per-user model loading');
  }
  
  // Load user settings from MongoDB (account tier, default neurons, default graph)
  let accountTier = 4; // Default to FREE tier
  let defaultNeuronId = 'red-neuron';
  let defaultWorkerNeuronId = 'red-neuron';
  let defaultGraphId = DEFAULT_GRAPH_ID;
  
  try {
    // Load user settings from MongoDB (Mongoose is already connected via database.ts)
    const mongoose = require('mongoose');
    
    // Define minimal User schema (just for reading settings)
    // Use strict: false to allow reading all fields from database
    let User;
    try {
      User = mongoose.model('User');
    } catch {
      const userSchema = new mongoose.Schema({}, { 
        collection: 'users',
        strict: false  // Allow reading any fields from DB
      });
      User = mongoose.model('User', userSchema);
    }
    
    const user = await User.findById(userId).lean(); // Use .lean() to get plain object
    if (user) {
      accountTier = user.accountLevel ?? 4;
      defaultNeuronId = user.defaultNeuronId || 'red-neuron';
      defaultWorkerNeuronId = user.defaultWorkerNeuronId || 'red-neuron';
      defaultGraphId = user.defaultGraphId || DEFAULT_GRAPH_ID;
      console.log(`[Run] Loaded user settings - Tier: ${accountTier}, Graph: ${defaultGraphId}, Neuron: ${defaultNeuronId}`);
    } else {
      console.warn(`[Run] User ${userId} not found, using FREE tier defaults`);
    }
  } catch (error) {
    console.error('[Run] Error loading user settings:', error);
    console.warn('[Run] Falling back to FREE tier defaults');
  }
  
  // Determine which graph to use (options override user default)
  const graphId = options.graphId || defaultGraphId;
  
  // For backward compatibility with agent graphs, extract message from input
  const message = input.message || '';
  
  // Generate conversation ID if not provided (use memory directly for ID generation since it's a simple utility)
  const conversationId = options.conversationId || red.memory.generateConversationId(message);
  
  // Extract messageId for Redis pub/sub (if provided) - this is the request/generation ID
  const requestId = options.messageId;
  
  // Generate separate message IDs for user and assistant messages
  // Use provided userMessageId from frontend if available, otherwise generate one
  const userMessageId = options.userMessageId || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const assistantMessageId = `msg_${Date.now() + 1}_${Math.random().toString(36).substring(7)}`;
  
  console.log(`[Run] Starting run() - conversationId:${conversationId}, requestId:${requestId}, userMessageId:${userMessageId}, userId:${userId}, tier:${accountTier}, graphId:${graphId}, input keys:${Object.keys(input).join(',')}`);
  
  // Load and compile the user's graph (with fallback on access denied)
  let compiledGraph;
  let actualGraphId = graphId;
  
  try {
    compiledGraph = await red.graphRegistry.getGraph(graphId, userId);
    console.log(`[Run] Using graph: ${graphId} (compiled at ${compiledGraph.compiledAt.toISOString()})`);
  } catch (error: any) {
    // Check if this is a recoverable error (tier restriction or not found)
    const isAccessDenied = error.name === 'GraphAccessDeniedError' || error.message?.includes('requires tier');
    const isNotFound = error.name === 'GraphNotFoundError' || error.message?.includes('not found');
    
    if (isAccessDenied || isNotFound) {
      const reason = isAccessDenied ? 'Access denied' : 'Graph not found';
      console.warn(`[Run] ${reason} for graph ${graphId}, falling back to ${DEFAULT_GRAPH_ID}`);
      actualGraphId = DEFAULT_GRAPH_ID;
      
      try {
        compiledGraph = await red.graphRegistry.getGraph(DEFAULT_GRAPH_ID, userId);
        console.log(`[Run] Using fallback graph: ${DEFAULT_GRAPH_ID} (compiled at ${compiledGraph.compiledAt.toISOString()})`);
      } catch (fallbackError) {
        console.error(`[Run] Failed to load fallback graph:`, fallbackError);
        throw new Error(`Failed to load graph '${graphId}' and fallback failed: ${fallbackError}`);
      }
    } else {
      // Other errors (compilation failed, database error, etc.)
      console.error(`[Run] Failed to load graph ${graphId}:`, error);
      throw new Error(`Failed to load graph '${graphId}': ${error}`);
    }
  }
  
  // Start a new generation (will fail if one is already in progress)
  const generationId = await red.logger.startGeneration(conversationId);
  if (!generationId) {
    await red.logger.log({
      level: 'warn',
      category: 'system',
      message: 'Generation already in progress for conversation',
      conversationId,
      metadata: { input: message.substring(0, 100) }
    });
    throw new Error('A generation is already in progress for this conversation');
  }
  
  // Log generation start
  await red.logger.log({
    level: 'info',
    category: 'system',
    message: `<cyan>Starting generation</cyan> <dim>${generationId}</dim>`,
    generationId,
    conversationId,
    metadata: {
      messageId: requestId,
      inputLength: message.length,
      source: options.source
    }
  });
  
  // Store user message via Context MCP (only if there's a message - agents require this, workflows may not)
  if (message) {
    await red.callMcpTool('store_message', {
      conversationId,
      userId,
      role: 'user',
      content: message,
      messageId: userMessageId, // Use unique user message ID
      toolExecutions: [] // User messages don't have tool executions
    }, { conversationId, generationId, messageId: requestId });
  }
  
  // Build per-user initial state with neuron system
  const initialState = {
    // Infrastructure components
    neuronRegistry: red.neuronRegistry,
    memory: red.memory,
    messageQueue: red.messageQueue,
    logger: red.logger,
    // Wrap Red's callMcpTool in an object to avoid serialization issues
    mcpClient: {
      callTool: (toolName: string, args: Record<string, unknown>, meta?: any) => 
        red.callMcpTool(toolName, args, meta)
    },
    // Universal Node Data - Container for all node-specific dynamic data
    data: {
      query: { message }, // Backward compatibility: wrap message in query object
      input, // Full input object for workflow graphs
      options: { ...options, conversationId, generationId }, // Add generationId to options
      messageId: requestId, // Add requestId to state for tool event publishing
      messages: message ? [{ role: 'user', content: message }] : [], // Add initial message for precheck/classifier
      userId,
      accountTier,
      defaultNeuronId,
      defaultWorkerNeuronId,
    }
  };

  // Inject a system message into the graph state for every run() call.
  // Use env override if available so this can be configured without code changes.
  const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are Red, an AI assistant developed by redbtn.io.
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
  // Attach as `systemMessage` so the responder node can use it
  // Tool nodes may override this with their own system messages
  (initialState as any).data.systemMessage = SYSTEM_PROMPT;

  // Also inject the current date/time into data so every node can access it
  // This is defensive: some execution paths or node configs may not include the systemMessage
  // so putting the date into data ensures planner/executor/respond nodes can read it.
  try {
    const now = new Date();
    (initialState as any).data = {
      ...((initialState as any).data || {}),
      currentDateISO: now.toISOString(),
      currentDate: now.toLocaleDateString(),
      currentDateTime: now.toLocaleString(),
    };
  } catch (e) {
    // Fail-safe: don't break respond flow if date injection fails
    /* noop */
  }

  // Check if streaming is requested
  console.log(`[Run] Stream option:`, options.stream);
  if (options.stream) {
    console.log(`[Run] Taking STREAMING path`);
    // Phase 1: Use compiled graph for streaming
    return streamThroughGraphWithMemory(red, compiledGraph, initialState, conversationId, generationId, requestId, assistantMessageId, userId, defaultNeuronId);
  } else {
    console.log(`[Run] Taking NON-STREAMING path`);
    // Phase 1: Invoke the compiled graph and return the full AIMessage
    const result = await compiledGraph.graph.invoke(initialState);
    // Support both legacy (result.response) and universal (result.data.response) paths
    // Universal nodes return string directly, legacy returns AIMessage with .content
    const rawResponse = result.data?.response || result.response;
    // Normalize to AIMessage-like object
    const response = typeof rawResponse === 'string' 
      ? { content: rawResponse, usage_metadata: undefined }
      : rawResponse;
    console.log(`[Run] Non-streaming: Graph invoked, got response`, { 
      responseType: typeof rawResponse,
      contentPreview: (response?.content || '').substring(0, 50)
    });

    
    // Retrieve tool executions from Redis state
    let toolExecutions: any[] = [];
    if (requestId) {
      const messageState = await red.messageQueue.getMessageState(requestId);
      if (messageState?.toolEvents) {
        // Convert tool events to tool executions for storage
        const toolMap = new Map<string, any>();
        
        for (const event of messageState.toolEvents) {
          if (event.type === 'tool_start') {
            toolMap.set(event.toolId, {
              toolId: event.toolId,
              toolType: event.toolType,
              toolName: event.toolName,
              status: 'running',
              startTime: new Date(event.timestamp),
              steps: [],
              metadata: event.metadata || {}
            });
          } else if (event.type === 'tool_progress' && toolMap.has(event.toolId)) {
            const tool = toolMap.get(event.toolId);
            tool.steps.push({
              step: event.step,
              timestamp: new Date(event.timestamp),
              progress: event.progress,
              data: event.data
            });
            if (event.progress !== undefined) {
              tool.progress = event.progress;
            }
            tool.currentStep = event.step;
          } else if (event.type === 'tool_complete' && toolMap.has(event.toolId)) {
            const tool = toolMap.get(event.toolId);
            tool.status = 'completed';
            tool.endTime = new Date(event.timestamp);
            tool.duration = tool.endTime.getTime() - tool.startTime.getTime();
            if (event.result !== undefined) {
              tool.result = event.result;
            }
            if (event.metadata) {
              tool.metadata = { ...tool.metadata, ...event.metadata };
            }
          } else if (event.type === 'tool_error' && toolMap.has(event.toolId)) {
            const tool = toolMap.get(event.toolId);
            tool.status = 'error';
            tool.endTime = new Date(event.timestamp);
            tool.duration = tool.endTime.getTime() - tool.startTime.getTime();
            tool.error = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
          }
        }
        
        toolExecutions = Array.from(toolMap.values());
        console.log(`[Run] Collected ${toolExecutions.length} tool executions from generation state`);
      }
    }
    
    // Store assistant response via Context MCP
    await red.callMcpTool('store_message', {
      conversationId,
      userId,
      role: 'assistant',
      content: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
      messageId: assistantMessageId, // Use unique assistant message ID
      toolExecutions
    }, { conversationId, generationId, messageId: requestId });
    
    console.log(`[Run] Non-streaming: About to complete generation ${generationId}`);
    // Complete the generation (non-streaming path)
    await red.logger.completeGeneration(generationId, {
      response: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
      thinking: undefined, // Non-streaming doesn't capture thinking separately
      route: (result as any).toolAction || 'chat',
      toolsUsed: (result as any).selectedTools,
      model: defaultNeuronId,
      tokens: response.usage_metadata,
    });
    console.log(`[Run] Non-streaming: Generation ${generationId} marked as complete`);
    
    // Get message count for title generation via Context MCP
    const metadataResult = await red.callMcpTool('get_conversation_metadata', {
      conversationId
    }, { conversationId, generationId, messageId: requestId });
    const messageCount = metadataResult.isError ? 0 : JSON.parse(metadataResult.content?.[0]?.text || '{}').messageCount || 0;
    
    // Phase 0: Trigger background tasks with model factory functions
    // Factory function to create model instance for background tasks
    const getModel = async () => {
      return await red.neuronRegistry.getModel(defaultNeuronId, userId);
    };
    
    // Trigger background summarization (non-blocking)
    background.summarizeInBackground(conversationId, red.memory, getModel);
    
    // Trigger background title generation (non-blocking)
    background.generateTitleInBackground(conversationId, messageCount, red, userId, defaultNeuronId);
    
    // Attach conversationId to response for server access
    return { ...response, conversationId };
  }
}

/**
 * Internal method to handle streaming responses through the graph with memory management.
 * Yields metadata first (with conversationId), then string chunks, then the final AIMessage object.
 * Extracts and logs thinking from models like DeepSeek-R1.
 * 
 * Phase 0: Now takes userId and defaultNeuronId for per-user model loading.
 * 
 * @private
 */
async function* streamThroughGraphWithMemory(
  red: Red,
  compiledGraph: any, // Phase 1: CompiledGraph from GraphRegistry
  initialState: any,
  conversationId: string,
  generationId: string,
  requestId?: string,
  assistantMessageId?: string,
  userId?: string,
  defaultNeuronId: string = 'red-neuron'
): AsyncGenerator<string | any, void, unknown> {
  // Stream timeout setup (Pre-Phase 2.5 Part 4)
  const STREAM_TIMEOUT_MS = 60000; // 60 seconds
  let timeoutHandle: NodeJS.Timeout | null = null;
  
  const clearStreamTimeout = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };
  
  // Memory leak prevention: Track active stream (Pre-Phase 2.5 Part 4)
  const abortController = new AbortController();
  activeStreams.set(generationId, abortController);
  console.log(`[Run] Registered stream ${generationId} (active: ${activeStreams.size})`);
  
  try {
    // Start stream timeout
    timeoutHandle = setTimeout(() => {
      const error = new Error(
        `Stream timeout after ${STREAM_TIMEOUT_MS}ms for conversation ${conversationId}, generation ${generationId}`
      );
      console.error('[Run] Stream timeout:', error.message);
      throw error;
    }, STREAM_TIMEOUT_MS);
    
    // Import thinking utilities
    const { extractThinking, logThinking } = await import('../lib/utils/thinking');
    
    // Import tool event system (disabled - not implemented yet)
    // const { createIntegratedPublisher } = await import('../lib/events/integrated-publisher');
    
    // Create tool event publisher for thinking (if we have a requestId)
    let thinkingPublisher: any = null;
    // if (requestId) {
    //   thinkingPublisher = createIntegratedPublisher(
    //     red.messageQueue,
    //     'thinking',
    //     'AI Reasoning',
    //     messageId,
    //     conversationId
    //   );
    // }
    
    // Yield metadata first so server can capture conversationId and generationId immediately
    yield { _metadata: true, conversationId, generationId };
    
    // Note: Initial status is now published by the router node, not here
    // This prevents race conditions where "processing" overwrites "searching"
    
    // Phase 1: Use compiled graph's streamEvents to get token-level streaming
    const stream = compiledGraph.graph.streamEvents(initialState, { version: "v1" });
    let finalMessage: any = null;
    let fullContent = '';
    let streamedTokens = false;
    let streamedThinking = false; // Track if we streamed any thinking
    let thinkingBuffer = '';
    let inThinkingTag = false;
    let eventCount = 0;
    let toolIndicatorSent = false;
    let pendingBuffer = ''; // Buffer for partial tag detection across chunks
    
    // Chunk batching for streaming optimization (Pre-Phase 2.5 Part 4)
    const BATCH_INTERVAL_MS = 50; // Yield buffered chunks every 50ms
    const BATCH_SIZE = 10; // Or when buffer reaches 10 characters
    let chunkBuffer = '';
    let lastYieldTime = Date.now();
    
    // Streaming metrics tracking (Pre-Phase 2.5 Part 4)
    const streamingMetrics = {
      startTime: Date.now(),
      endTime: 0,
      chunksReceived: 0,
      chunksYielded: 0,
      totalBytes: 0,
      streamingDuration: 0,
      averageChunkSize: 0
    };
    
    for await (const event of stream) {
      eventCount++;
      
      // Note: Tool status is now published by router node directly
      // No need to detect it here from stream events
      
      // Filter out LLM calls from router and toolPicker nodes (classification/tool selection)
      // Check multiple event properties to identify the source node
      const eventName = event.name || '';
      const eventTags = event.tags || [];
      const runName = event.metadata?.langgraph_node || '';
      
      // CRITICAL: Only stream content from the respond node
      // All other LLM calls (router, planner, search extractors, etc.) are internal
      // The langgraph_node metadata should be exactly "respond" for the respond node
      const isRespondNode = runName === 'respond' || runName === 'responder';
      
      // Check if current universal node step should stream to user
      // This flag is set by neuronExecutor before streaming
      const streamToUser = initialState._currentStepStreamToUser === true;
      
      // Yield streaming content chunks (for models that stream tokens)
      // From respond node (legacy name: responder) OR from universal nodes with stream=true
      if (event.event === "on_llm_stream" && event.data?.chunk?.content && (isRespondNode || streamToUser)) {
        let content = event.data.chunk.content;
        
        // Track streaming metrics
        streamingMetrics.chunksReceived++;
        streamingMetrics.totalBytes += Buffer.byteLength(content, 'utf8');
        
        // Add content to pending buffer for tag detection
        pendingBuffer += content;
        
        // Process pending buffer character by character
        // Keep last 8 chars in buffer in case we get partial tag at chunk boundary
        while (pendingBuffer.length > 8) {
          // Check for opening think tag in pending buffer
          if (!inThinkingTag && pendingBuffer.startsWith('<think>')) {
            inThinkingTag = true;
            pendingBuffer = pendingBuffer.slice(7); // Remove '<think>'
            console.log('[Run] 🧠 THINKING TAG OPENED | Next chars:', pendingBuffer.substring(0, 50));
            
            // Publish tool start event
            if (thinkingPublisher) {
              await thinkingPublisher.publishStart({
                model: defaultNeuronId, // Phase 0: Use neuron ID instead of model name
              });
            }
            
            // Emit status that thinking is starting (legacy)
            if (requestId) {
              await red.messageQueue.publishStatus(requestId, { 
                action: 'thinking', 
                description: 'Reasoning through the problem' 
              });
              yield { _status: true, action: 'thinking', description: 'Reasoning through the problem' };
              process.stdout.write(`[Run] Streaming thinking: 0 chars\r`);
            }
            continue; // Recheck buffer after removing tag
          }
          
          // Check for closing think tag
          if (inThinkingTag && pendingBuffer.startsWith('</think>')) {
            console.log('[Run] 🧠 THINKING TAG CLOSED - accumulated', thinkingBuffer.length, 'chars');
            if (requestId) {
              process.stdout.write(`\n[Run] Thinking complete: ${thinkingBuffer.length} chars\n`);
            }
            inThinkingTag = false;
            pendingBuffer = pendingBuffer.slice(8); // Remove '</think>'
            
            // ✨ IMPORTANT: Send a space character immediately to trigger thinking shrink
            // This ensures frontend gets a content chunk even if whitespace follows
            console.log('[Run] 📤 Sending content chunk to trigger thinking shrink');
            streamedTokens = true;
            yield ' ';
            
            // Log the accumulated thinking
            if (thinkingBuffer.trim()) {
              logThinking(thinkingBuffer.trim(), 'Chat (Streaming)');
              
              // Publish tool complete event
              if (thinkingPublisher) {
                await thinkingPublisher.publishComplete(
                  { reasoning: thinkingBuffer.trim() },
                  { 
                    characterCount: thinkingBuffer.length,
                    model: defaultNeuronId, // Phase 0: Use neuron ID
                  }
                );
              }
              
              // Store thinking separately in database
              if (generationId && conversationId) {
                const thinkingContent = thinkingBuffer.trim();
                try {
                  const db = await import('../lib/memory/database').then(m => m.getDatabase());
                  const thoughtId = await db.storeThought({
                    thoughtId: `thought_${generationId}_${Date.now()}`,
                    messageId: requestId, // Use requestId for thinking link
                    conversationId,
                    generationId,
                    source: 'chat',
                    content: thinkingContent,
                    timestamp: new Date(),
                    metadata: {
                      streamChunk: true,
                    },
                  });
                } catch (err) {
                  console.error('[Run] Failed to store streaming thinking:', err);
                }
              }
            }
            thinkingBuffer = '';
            continue; // Recheck buffer after removing tag
          }
          
          // Process one character from buffer
          const char = pendingBuffer[0];
          pendingBuffer = pendingBuffer.slice(1);
          
          // Accumulate thinking or stream regular content
          if (inThinkingTag) {
            thinkingBuffer += char;
            
            // Publish streaming content via tool event system
            if (thinkingPublisher) {
              await thinkingPublisher.publishStreamingContent(char);
            }
            
            // Stream thinking character-by-character via Redis pub/sub
            if (requestId) {
              // Publish thinking chunk to Redis for real-time streaming
              await red.messageQueue.publishThinkingChunk(requestId, char);
              
              // Track that we've streamed thinking
              streamedThinking = true;
              
              // Update progress indicator without logging each character
              if (thinkingBuffer.length % 100 === 0) {
                process.stdout.write(`[Run] Streaming thinking: ${thinkingBuffer.length} chars\r`);
              }
              yield { _thinkingChunk: true, content: char };
            }
          } else {
            // Skip leading whitespace at the start of content
            if (!streamedTokens && (char === '\n' || char === '\r' || char === ' ')) {
              continue;
            }
            
            // Log first content character after thinking ends
            if (streamedThinking && !streamedTokens) {
              console.log('[Run] 📝 FIRST CONTENT CHARACTER after thinking:', JSON.stringify(char));
            }
            
            fullContent += char;
            streamedTokens = true;
            
            // Chunk batching: Add to buffer and yield when ready
            chunkBuffer += char;
            const now = Date.now();
            const timeSinceLastYield = now - lastYieldTime;
            if (chunkBuffer.length >= BATCH_SIZE || timeSinceLastYield >= BATCH_INTERVAL_MS) {
              streamingMetrics.chunksYielded++;
              yield chunkBuffer;
              chunkBuffer = '';
              lastYieldTime = now;
            }
          }
        }
      }
      
      // Capture the final message when LLM completes - use on_llm_end
      // Only from respond node
      if (event.event === "on_llm_end" && isRespondNode) {
        // The AIMessage is nested in the generations array
        const generations = event.data?.output?.generations;
        if (generations && generations[0] && generations[0][0]?.message) {
          finalMessage = generations[0][0].message;
        }
      }
      
      // CRITICAL: Capture direct response from graph state when it finishes
      // This handles the case where respond node uses a directResponse (no LLM stream)
      // The final event is "LangGraph" not "__end__"
      if (event.event === "on_chain_end" && event.name === "LangGraph") {
        const graphOutput = event.data?.output;
        // Check if response exists and has content, and we haven't streamed anything yet
        const responseContent = graphOutput?.data?.response?.content || graphOutput?.data?.response;
        if (responseContent && typeof responseContent === 'string' && !streamedTokens) {
          // Direct response path - stream the pre-generated content
          console.log(`[Run] Direct response detected, streaming ${responseContent.length} chars`);
          
          // Stream the content character by character for consistent UX
          for (const char of responseContent) {
            fullContent += char;
            streamedTokens = true;
            yield char;
            // Small delay for smooth streaming effect
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          
          // Create synthetic final message for direct responses (so completions route sees it)
          // This triggers messageQueue.completeGeneration in the webapp
          if (!finalMessage) {
            finalMessage = {
              content: responseContent,
              response_metadata: { model: defaultNeuronId },
              usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
            } as any;
          }
        }
      }
    }
    
    // CRITICAL: Flush remaining pending buffer (last 8 chars or less)
    if (pendingBuffer.length > 0) {
      process.stdout.write(`\r[Run] Flushing ${pendingBuffer.length} remaining chars\n`);
    }
    while (pendingBuffer.length > 0) {
      const char = pendingBuffer[0];
      pendingBuffer = pendingBuffer.slice(1);
      
      if (inThinkingTag) {
        thinkingBuffer += char;
        if (requestId) {
          await red.messageQueue.publishThinkingChunk(requestId, char);
          streamedThinking = true;
          yield { _thinkingChunk: true, content: char };
        }
      } else {
        // Skip leading whitespace at the start of content
        if (!streamedTokens && (char === '\n' || char === '\r' || char === ' ')) {
          continue;
        }
        fullContent += char;
        streamedTokens = true;
        
        // Chunk batching: Add to buffer and yield when ready
        chunkBuffer += char;
        const now = Date.now();
        const timeSinceLastYield = now - lastYieldTime;
        if (chunkBuffer.length >= BATCH_SIZE || timeSinceLastYield >= BATCH_INTERVAL_MS) {
          streamingMetrics.chunksYielded++;
          yield chunkBuffer;
          chunkBuffer = '';
          lastYieldTime = now;
        }
      }
    }
    
    // Flush any remaining content in chunk buffer
    if (chunkBuffer.length > 0) {
      streamingMetrics.chunksYielded++;
      yield chunkBuffer;
      chunkBuffer = '';
    }
    
    // Calculate final metrics
    streamingMetrics.endTime = Date.now();
    streamingMetrics.streamingDuration = streamingMetrics.endTime - streamingMetrics.startTime;
    streamingMetrics.averageChunkSize = streamingMetrics.chunksReceived > 0 
      ? Math.round(streamingMetrics.totalBytes / streamingMetrics.chunksReceived) 
      : 0;
    
    // Log metrics
    console.log(`[Run] Streaming metrics:`, {
      duration: `${streamingMetrics.streamingDuration}ms`,
      chunksReceived: streamingMetrics.chunksReceived,
      chunksYielded: streamingMetrics.chunksYielded,
      batchingReduction: streamingMetrics.chunksReceived > 0 
        ? `${Math.round((1 - streamingMetrics.chunksYielded / streamingMetrics.chunksReceived) * 100)}%`
        : '0%',
      totalBytes: streamingMetrics.totalBytes,
      averageChunkSize: `${streamingMetrics.averageChunkSize} bytes`
    });
    
    // If there's remaining thinking content at the end, log it
    if (thinkingBuffer.trim()) {
      logThinking(thinkingBuffer.trim(), 'Chat (Streaming)');
    }
    
    // CRITICAL: Always mark generation as complete, even if no content
    // Initialize variables for completion tracking
    let toolExecutions: any[] = [];
    
    // If no tokens were streamed (e.g., when using tool calls like 'speak'),
    // get the final content and stream it character by character
    // BUT: Don't run this if we already streamed thinking, to avoid duplicate thinking events
    if (!streamedTokens && !streamedThinking && finalMessage && finalMessage.content) {
      // Extract thinking for logging (console)
      const { thinking, cleanedContent } = extractThinking(finalMessage.content);
      if (thinking) {
        logThinking(thinking, 'Chat (Non-streamed)');
        
        // Store thinking separately in database
        if (generationId && conversationId) {
          try {
            const db = await import('../lib/memory/database').then(m => m.getDatabase());
            const thoughtId = await db.storeThought({
              thoughtId: `thought_${generationId}`,
              messageId: requestId, // Use requestId for thinking link
              conversationId,
              generationId,
              source: 'chat',
              content: thinking,
              timestamp: new Date(),
              metadata: {
                model: defaultNeuronId, // Phase 0: Use neuron ID
              },
            });
            console.log(`[Run] Stored thinking: ${thoughtId} with messageId: ${requestId}`);
            
            // Publish to Redis for real-time updates  
            if (requestId) {
              console.log(`[Run] Publishing non-stream thinking to Redis for messageId: ${requestId}, length: ${thinking.length}`);
              // Publish thinking content chunk by chunk for consistent display
              for (const char of thinking) {
                await red.messageQueue.publishThinkingChunk(requestId, char);
              }
              console.log(`[Run] Published non-stream thinking successfully`);
            } else {
              console.warn(`[Run] No messageId provided for non-stream thinking`);
            }
          } catch (err) {
            console.error('[Run] Failed to store non-streamed thinking:', err);
          }
        }
      }
      // Use CLEANED content (thinking will be stored separately)
      fullContent = cleanedContent;
      
      // Stream the cleaned content for UX
      const words = cleanedContent.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        yield i === 0 ? word : ' ' + word;
        // Small delay for smooth streaming effect (optional)
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    
    // Retrieve tool executions from Redis state (moved outside fullContent check)
    if (requestId) {
        const messageState = await red.messageQueue.getMessageState(requestId);
        console.log(`[Run] Message state for ${requestId}:`, messageState ? 'Found' : 'Not found');
        console.log(`[Run] Tool events in state:`, messageState?.toolEvents?.length || 0);
        if (messageState?.toolEvents) {
          // Convert tool events to tool executions for storage
          const toolMap = new Map<string, any>();
          
          for (const event of messageState.toolEvents) {
            if (event.type === 'tool_start') {
              toolMap.set(event.toolId, {
                toolId: event.toolId,
                toolType: event.toolType,
                toolName: event.toolName,
                status: 'running',
                startTime: new Date(event.timestamp),
                steps: [],
                metadata: event.metadata || {}
              });
            } else if (event.type === 'tool_progress' && toolMap.has(event.toolId)) {
              const tool = toolMap.get(event.toolId);
              tool.steps.push({
                step: event.step,
                timestamp: new Date(event.timestamp),
                progress: event.progress,
                data: event.data
              });
              if (event.progress !== undefined) {
                tool.progress = event.progress;
              }
              tool.currentStep = event.step;
            } else if (event.type === 'tool_complete' && toolMap.has(event.toolId)) {
              const tool = toolMap.get(event.toolId);
              tool.status = 'completed';
              tool.endTime = new Date(event.timestamp);
              tool.duration = tool.endTime.getTime() - tool.startTime.getTime();
              if (event.result !== undefined) {
                tool.result = event.result;
              }
              if (event.metadata) {
                tool.metadata = { ...tool.metadata, ...event.metadata };
              }
            } else if (event.type === 'tool_error' && toolMap.has(event.toolId)) {
              const tool = toolMap.get(event.toolId);
              tool.status = 'error';
              tool.endTime = new Date(event.timestamp);
              tool.duration = tool.endTime.getTime() - tool.startTime.getTime();
              tool.error = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
            }
          }
          
      toolExecutions = Array.from(toolMap.values());
      console.log(`[Run] Collected ${toolExecutions.length} tool executions from generation state`);
    } else {
      console.log(`[Run] No tool events found in message state`);
    }
  } else {
    console.log(`[Run] No requestId provided, cannot retrieve tool executions`);
  }
  
  console.log(`[Run] About to store message with ${toolExecutions.length} tool executions, fullContent length: ${fullContent.length}`);
  
  // Store content via MCP only if we have content
  if (fullContent) {
    await red.callMcpTool('store_message', {
      conversationId,
      userId,
      role: 'assistant',
      content: fullContent,
      messageId: assistantMessageId,
      toolExecutions
    }, { conversationId, generationId, messageId: requestId });
  }
  
  console.log(`[Run] About to complete generation ${generationId}`);
  // CRITICAL: Complete the generation ALWAYS - this clears currentGenerationId
  await red.logger.completeGeneration(generationId, {
    response: fullContent || '',
    thinking: thinkingBuffer || undefined,
    route: (initialState as any).toolAction || 'chat',
    toolsUsed: (initialState as any).selectedTools,
    model: defaultNeuronId,
    tokens: finalMessage?.usage_metadata,
  });
  console.log(`[Run] Generation ${generationId} marked as complete`);
  
  // Get message count for title generation via Context MCP
  const metadataResult = await red.callMcpTool('get_conversation_metadata', {
    conversationId
  }, { conversationId, generationId, messageId: requestId });
  const messageCount = metadataResult.isError ? 0 : JSON.parse(metadataResult.content?.[0]?.text || '{}').messageCount || 0;
  
  // Phase 0: Trigger background tasks with model factory function
  const getModel = async () => {
    if (!userId) throw new Error('userId required for background tasks');
    return await red.neuronRegistry.getModel(defaultNeuronId, userId);
  };
  
  // Trigger background summarization (non-blocking)
  background.summarizeInBackground(conversationId, red.memory, getModel);
  
  // Trigger background title generation (non-blocking)
  background.generateTitleInBackground(conversationId, messageCount, red, userId || '', defaultNeuronId);
  
  // Trigger executive summary generation after 3rd+ message (non-blocking)
  if (messageCount >= 3) {
    background.generateExecutiveSummaryInBackground(conversationId, red.memory, getModel);
  }
    
    // After all chunks are sent, yield the final AIMessage with complete token data
    if (finalMessage) {
      yield finalMessage;
    }
  } catch (error) {
    // Log the failure and mark generation as failed
    await red.logger.failGeneration(generationId, error instanceof Error ? error.message : String(error));
    throw error; // Re-throw to propagate the error
  } finally {
    // Clean up stream timeout
    clearStreamTimeout();
    
    // Clean up active stream tracking
    if (activeStreams.has(generationId)) {
      activeStreams.delete(generationId);
      console.log(`[Run] Cleaned up stream ${generationId} (active: ${activeStreams.size})`);
    }
  }
}
