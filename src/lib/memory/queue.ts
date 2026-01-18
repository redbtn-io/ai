import Redis from 'ioredis';

/**
 * Message Queue - Manages in-progress message generation state in Redis
 * Allows reconnecting to ongoing generations and tracking completion status
 */

export interface MessageGenerationState {
  conversationId: string;
  messageId: string;
  status: 'generating' | 'completed' | 'error';
  content: string;
  thinking?: string; // Accumulated thinking/reasoning content
  toolEvents?: any[]; // Accumulated tool events for reconnection replay
  startedAt: number;
  completedAt?: number;
  error?: string;
  currentStatus?: {
    action: string;
    description?: string;
    reasoning?: string; // Router's reasoning for the action taken
    confidence?: number; // Router's confidence score (0-1) for the decision
  };
  metadata?: {
    model?: string;
    tokens?: {
      input?: number;
      output?: number;
      total?: number;
    };
  };
}

export class MessageQueue {
  private redis: Redis;
  private readonly STATE_TTL = 3600; // 1 hour TTL for message states
  private readonly CONTENT_KEY_PREFIX = 'message:generating:';
  private readonly INDEX_KEY_PREFIX = 'conversation:generating:';
  private readonly PUBSUB_PREFIX = 'message:stream:';
  private readonly STREAM_READY_PREFIX = 'stream:ready:';

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Signal that a stream client is connected and ready to receive events
   */
  async markStreamReady(messageId: string): Promise<void> {
    const key = `${this.STREAM_READY_PREFIX}${messageId}`;
    await this.redis.setex(key, 60, '1'); // 60 second TTL
  }

  /**
   * Wait for stream client to be ready before starting generation
   * Returns true if ready, false if timeout
   */
  async waitForStreamReady(messageId: string, timeoutMs: number = 5000): Promise<boolean> {
    const key = `${this.STREAM_READY_PREFIX}${messageId}`;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const ready = await this.redis.get(key);
      if (ready === '1') {
        return true;
      }
      // Wait 50ms before checking again
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.warn(`[MessageQueue] Timeout waiting for stream ready for ${messageId}`);
    return false; // Start anyway after timeout
  }

  /**
   * Start tracking a new message generation
   */
  async startGeneration(conversationId: string, messageId: string): Promise<void> {
    const state: MessageGenerationState = {
      conversationId,
      messageId,
      status: 'generating',
      content: '',
      startedAt: Date.now(),
      currentStatus: {
        action: 'initializing',
        description: 'Starting generation'
      }
    };

    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    
    // Add to conversation's generating messages index
    await this.redis.sadd(`${this.INDEX_KEY_PREFIX}${conversationId}`, messageId);
    await this.redis.expire(`${this.INDEX_KEY_PREFIX}${conversationId}`, this.STATE_TTL);

    // Publish initial status event so frontend knows generation started
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'status', action: 'initializing', description: 'Starting generation' })
    );
  }

  /**
   * Append content to a generating message (called as tokens stream in)
   */
  async appendContent(messageId: string, chunk: string): Promise<void> {
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (!stateJson) {
      console.warn(`[MessageQueue] Cannot append to non-existent message: ${messageId}`);
      return;
    }

    const state: MessageGenerationState = JSON.parse(stateJson);
    state.content += chunk;
    
    await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    
    // Publish chunk to pub/sub channel for real-time streaming
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'chunk', content: chunk })
    );
  }

  /**
   * Mark message generation as completed
   */
  async completeGeneration(
    messageId: string, 
    metadata?: MessageGenerationState['metadata']
  ): Promise<void> {
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (!stateJson) {
      console.warn(`[MessageQueue] Cannot complete non-existent message: ${messageId}`);
      return;
    }

    const state: MessageGenerationState = JSON.parse(stateJson);
    state.status = 'completed';
    state.completedAt = Date.now();
    if (metadata) {
      state.metadata = metadata;
    }
    
    await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    
    // Remove from generating index
    await this.redis.srem(`${this.INDEX_KEY_PREFIX}${state.conversationId}`, messageId);

    // Publish completion event
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'complete', metadata })
    );
  }

  /**
   * Publish tool status indicator (searching, scraping, etc.)
   */
  async publishToolStatus(messageId: string, toolInfo: { status: string; action: string; reasoning?: string; confidence?: number }): Promise<void> {
    // Store in state so SSE connection can retrieve it
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (stateJson) {
      const state: MessageGenerationState = JSON.parse(stateJson);
      
      state.currentStatus = {
        action: toolInfo.action,
        description: toolInfo.status,
        ...(toolInfo.reasoning && { reasoning: toolInfo.reasoning }),
        ...(toolInfo.confidence !== undefined && { confidence: toolInfo.confidence })
      };
      
      await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    } else {
      console.warn(`[MessageQueue] No state found for ${messageId}, cannot store tool status`);
    }
    
    // Publish tool status event (include reasoning if provided)
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'tool_status', ...toolInfo })
    );
  }

  /**
   * Publish general status update (routing, thinking, processing, etc.)
   */
  async publishStatus(messageId: string, status: { action: string; description?: string; reasoning?: string; confidence?: number }): Promise<void> {
    // Store in state so SSE connection can retrieve it
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (stateJson) {
      const state: MessageGenerationState = JSON.parse(stateJson);
      state.currentStatus = status;
      await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    }
    
    // Publish status event
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'status', ...status })
    );
  }

  /**
   * Publish thinking/reasoning content chunk by chunk
   */
  async publishThinkingChunk(messageId: string, chunk: string): Promise<void> {
    // Accumulate thinking content in Redis state for reconnection
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (stateJson) {
      const state: MessageGenerationState = JSON.parse(stateJson);
      state.thinking = (state.thinking || '') + chunk;
      await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    }
    
    // Silent - too noisy to log each chunk
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'chunk', content: chunk, thinking: true })
    );
  }

  /**
   * Publish thinking complete event (when </think> tag is closed)
   */
  async publishThinkingComplete(messageId: string): Promise<void> {
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'thinkingComplete' })
    );
  }

  /**
   * Publish tool event to Redis pub/sub
   * Simple wrapper that doesn't require ToolEvent types
   */
  async publishToolEvent(messageId: string, event: any): Promise<void> {
    // Accumulate tool events in Redis state for reconnection
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (stateJson) {
      const state: MessageGenerationState = JSON.parse(stateJson);
      if (!state.toolEvents) {
        state.toolEvents = [];
      }
      state.toolEvents.push(event);
      await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    } else {
      console.warn(`[MessageQueue] No state found for ${messageId} when publishing tool event: ${event.type}`);
    }
    
    // Also publish to real-time pub/sub
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'tool_event', event })
    );
  }

  /**
   * Mark message generation as failed
   */
  async failGeneration(messageId: string, error: string): Promise<void> {
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (!stateJson) {
      console.warn(`[MessageQueue] Cannot fail non-existent message: ${messageId}`);
      return;
    }

    const state: MessageGenerationState = JSON.parse(stateJson);
    state.status = 'error';
    state.error = error;
    state.completedAt = Date.now();
    
    await this.redis.setex(key, this.STATE_TTL, JSON.stringify(state));
    
    // Remove from generating index
    await this.redis.srem(`${this.INDEX_KEY_PREFIX}${state.conversationId}`, messageId);

    // Publish error event
    await this.redis.publish(
      `${this.PUBSUB_PREFIX}${messageId}`,
      JSON.stringify({ type: 'error', error })
    );

    console.error(`[MessageQueue] Failed generation: ${messageId} - ${error}`);
  }

  /**
   * Get current state of a generating message
   */
  async getMessageState(messageId: string): Promise<MessageGenerationState | null> {
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    const stateJson = await this.redis.get(key);
    
    if (!stateJson) {
      return null;
    }

    return JSON.parse(stateJson);
  }

  /**
   * Get all generating messages for a conversation
   */
  async getGeneratingMessages(conversationId: string): Promise<MessageGenerationState[]> {
    const messageIds = await this.redis.smembers(`${this.INDEX_KEY_PREFIX}${conversationId}`);
    
    if (messageIds.length === 0) {
      return [];
    }

    const states: MessageGenerationState[] = [];
    for (const messageId of messageIds) {
      const state = await this.getMessageState(messageId);
      if (state) {
        states.push(state);
      }
    }

    return states;
  }

  /**
   * Clean up completed/failed message state
   */
  async cleanupMessage(messageId: string): Promise<void> {
    const key = `${this.CONTENT_KEY_PREFIX}${messageId}`;
    await this.redis.del(key);
  }

  /**
   * Subscribe to a message stream via Redis pub/sub
   * Returns an async generator that yields chunks, completion, or errors
   */
  async *subscribeToMessage(messageId: string): AsyncGenerator<{
    type: 'init' | 'chunk' | 'status' | 'thinking' | 'complete' | 'error' | 'tool_status' | 'tool_event';
    content?: string;
    thinking?: boolean; // Flag for chunk events to indicate thinking/reasoning content
    existingContent?: string;
    metadata?: MessageGenerationState['metadata'];
    error?: string;
    action?: string;
    description?: string;
    status?: string;
    event?: any;
  }> {
    // First, get any existing content
    const state = await this.getMessageState(messageId);
    if (!state) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Yield existing content if any
    if (state.content) {
      yield { type: 'init', existingContent: state.content };
    }
    
    // Yield existing tool events for reconnection (graph/node state recovery)
    if (state.toolEvents && state.toolEvents.length > 0) {
      for (const toolEvent of state.toolEvents) {
        yield { type: 'tool_event', event: toolEvent };
      }
    }
    
    // Yield current status if any (this is the key fix!)
    if (state.currentStatus) {
      yield { 
        type: state.currentStatus.action.includes('search') || state.currentStatus.action.includes('scrape') || state.currentStatus.action.includes('command') 
          ? 'tool_status' 
          : 'status',
        action: state.currentStatus.action,
        description: state.currentStatus.description,
        status: state.currentStatus.description
      };
    }

    // If already completed, just send completion event
    if (state.status === 'completed') {
      yield { type: 'complete', metadata: state.metadata };
      return;
    }

    if (state.status === 'error') {
      yield { type: 'error', error: state.error };
      return;
    }

    // Subscribe to pub/sub for new chunks
    const subscriber = this.redis.duplicate();
    // Increase max listeners to prevent warnings when multiple clients connect
    subscriber.setMaxListeners(50);
    const channel = `${this.PUBSUB_PREFIX}${messageId}`;
    const getState = this.getMessageState.bind(this);
    let cleanedUp = false;
    
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } catch (e) {
        // Ignore cleanup errors
      }
    };

    try {
      await subscriber.subscribe(channel);

      // Create a promise-based message handler
      const messageIterator = async function* (sub: Redis) {
        while (true) {
          const message = await new Promise<string | null>((resolve) => {
            sub.once('message', (ch: string, msg: string) => {
              if (ch === channel) {
                resolve(msg);
              }
            });
            // Timeout after 30 seconds of no activity
            setTimeout(() => resolve(null), 30000);
          });

          if (message === null) {
            // Timeout - check if generation completed
            const currentState = await getState(messageId);
            if (!currentState || currentState.status !== 'generating') {
              break;
            }
            continue;
          }

          yield message;
        }
      }(subscriber);

      for await (const message of messageIterator) {
        const event = JSON.parse(message);
        
        if (event.type === 'chunk') {
          // Forward chunk events with thinking property if present
          yield { type: 'chunk', content: event.content, thinking: event.thinking };
        } else if (event.type === 'status') {
          yield { type: 'status', action: event.action, description: event.description };
        } else if (event.type === 'thinking') {
          yield { type: 'thinking', content: event.content };
        } else if (event.type === 'tool_status') {
          yield { type: 'tool_status', status: event.status, action: event.action };
        } else if (event.type === 'tool_event') {
          yield { type: 'tool_event', event: event.event };
        } else if (event.type === 'complete') {
          yield { type: 'complete', metadata: event.metadata };
          break;
        } else if (event.type === 'error') {
          yield { type: 'error', error: event.error };
          break;
        }
      }
    } finally {
      await cleanup();
    }
  }

  /**
   * Subscribe to a message stream with explicit ready signal
   * Returns a stream AND a ready promise that resolves when Redis subscription is established
   * This prevents race conditions where events are published before subscription is active
   */
  subscribeToMessageWithReady(messageId: string): {
    stream: AsyncGenerator<{
      type: 'init' | 'chunk' | 'status' | 'thinking' | 'complete' | 'error' | 'tool_status' | 'tool_event';
      content?: string;
      thinking?: boolean;
      existingContent?: string;
      metadata?: MessageGenerationState['metadata'];
      error?: string;
      action?: string;
      description?: string;
      status?: string;
      event?: any;
    }>;
    ready: Promise<void>;
  } {
    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    
    const self = this;
    
    // Set up subscription BEFORE creating the generator
    const subscriber = self.redis.duplicate();
    subscriber.setMaxListeners(50);
    const channel = `${self.PUBSUB_PREFIX}${messageId}`;
    
    // Use a proper async queue pattern instead of polling
    type QueueItem = { type: 'message', data: string } | { type: 'done' };
    const messageQueue: QueueItem[] = [];
    let messageResolver: ((item: QueueItem) => void) | null = null;
    
    const pushMessage = (item: QueueItem) => {
      if (messageResolver) {
        const resolver = messageResolver;
        messageResolver = null;
        resolver(item);
      } else {
        messageQueue.push(item);
      }
    };
    
    const pullMessage = (): Promise<QueueItem> => {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift()!);
      }
      return new Promise(resolve => {
        messageResolver = resolve;
      });
    };
    
    let messageHandler: ((ch: string, msg: string) => void) | null = null;
    
    // Start subscription immediately
    const subscriptionPromise = (async () => {
      await subscriber.subscribe(channel);
      
      // Set up message handler that pushes to the async queue
      messageHandler = (ch: string, msg: string) => {
        if (ch === channel) {
          pushMessage({ type: 'message', data: msg });
        }
      };
      subscriber.on('message', messageHandler);
      
      resolveReady();
    })();
    
    const stream = (async function* () {
      // Wait for subscription to be established first
      await subscriptionPromise;
      
      // Now get state and yield stored events
      const state = await self.getMessageState(messageId);
      if (!state) {
        throw new Error(`Message ${messageId} not found`);
      }

      // Yield existing content if any
      if (state.content) {
        yield { type: 'init' as const, existingContent: state.content };
      }
      
      // Yield existing tool events for reconnection (graph/node state recovery)
      if (state.toolEvents && state.toolEvents.length > 0) {
        for (const toolEvent of state.toolEvents) {
          yield { type: 'tool_event' as const, event: toolEvent };
        }
      }
      
      // Yield current status if any
      if (state.currentStatus) {
        const isToolStatus = state.currentStatus.action.includes('search') || state.currentStatus.action.includes('scrape') || state.currentStatus.action.includes('command');
        yield { 
          type: isToolStatus ? 'tool_status' as const : 'status' as const,
          action: state.currentStatus.action,
          description: state.currentStatus.description,
          status: state.currentStatus.description
        };
      }

      // If already completed, just send completion event and cleanup
      if (state.status === 'completed') {
        yield { type: 'complete' as const, metadata: state.metadata };
        await cleanup();
        return;
      }

      if (state.status === 'error') {
        yield { type: 'error' as const, error: state.error };
        await cleanup();
        return;
      }

      const getState = self.getMessageState.bind(self);
      let cleanedUp = false;
      
      async function cleanup() {
        if (cleanedUp) return;
        cleanedUp = true;
        try {
          if (messageHandler) {
            subscriber.off('message', messageHandler);
          }
          await subscriber.unsubscribe(channel);
          await subscriber.quit();
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      try {
        // Set up a timeout checker
        let lastActivityTime = Date.now();
        const timeoutInterval = setInterval(async () => {
          if (Date.now() - lastActivityTime > 30000) {
            // 30 second timeout - check if generation is still active
            const currentState = await getState(messageId);
            if (!currentState || currentState.status !== 'generating') {
              pushMessage({ type: 'done' });
              clearInterval(timeoutInterval);
            }
          }
        }, 5000);

        // Consume messages from the async queue
        while (true) {
          const item = await pullMessage();
          lastActivityTime = Date.now();
          
          if (item.type === 'done') {
            clearInterval(timeoutInterval);
            break;
          }
          
          const event = JSON.parse(item.data);
          
          if (event.type === 'chunk') {
            yield { type: 'chunk' as const, content: event.content, thinking: event.thinking };
          } else if (event.type === 'status') {
            yield { type: 'status' as const, action: event.action, description: event.description };
          } else if (event.type === 'thinking') {
            yield { type: 'thinking' as const, content: event.content };
          } else if (event.type === 'tool_status') {
            yield { type: 'tool_status' as const, status: event.status, action: event.action };
          } else if (event.type === 'tool_event') {
            yield { type: 'tool_event' as const, event: event.event };
          } else if (event.type === 'complete') {
            yield { type: 'complete' as const, metadata: event.metadata };
            clearInterval(timeoutInterval);
            break;
          } else if (event.type === 'error') {
            yield { type: 'error' as const, error: event.error };
            clearInterval(timeoutInterval);
            break;
          }
        }
      } finally {
        await cleanup();
      }
    })();
    
    return { stream, ready };
  }
}
