import { InvokeOptions } from '../..';

interface ContextNodeState {
  options?: InvokeOptions;
  messageId?: string;
  nodeNumber?: number;
  contextMessages?: any[];
  contextSummary?: string;
  contextLoaded?: boolean;
  // Phase 0: Infrastructure components
  logger?: any;
  mcpClient?: any;
}

export const contextNode = async (state: ContextNodeState) => {
  // Extract config options
  const nodeConfig = (state as any).nodeConfig || {};
  const {
    maxTokens = 30000,           // Max context tokens to load
    includeSummary = true,        // Whether to load executive summary
    summaryType = 'trailing',     // 'executive' | 'trailing'
    maxMessages,                  // Optional: Limit number of messages
  } = nodeConfig;
  
  const options = state.options || {};
  const conversationId = options.conversationId;
  const generationId = options.generationId;
  const messageId = state.messageId;
  const currentNodeNumber = state.nodeNumber || 1;
  const nextNodeNumber = currentNodeNumber + 1;

  // If context already loaded (or no conversation), skip work but advance node number
  if (state.contextLoaded || !conversationId) {
    return {
      contextLoaded: true,
      nodeNumber: nextNodeNumber
    };
  }

  let contextMessages: any[] = [];
  let contextSummary = '';

  await state.logger.log({
    level: 'info',
    category: 'context',
    message: `<cyan>🧱 Loading conversation context</cyan>`,
    conversationId,
    generationId,
  });

  try {
    const contextResult = await state.mcpClient.callTool(
      'get_context_history',
      {
        conversationId,
        maxTokens,
        includeSummary,
        summaryType,
        format: 'llm'
      },
      {
        conversationId,
        generationId,
        messageId
      }
    );

    if (!contextResult.isError && contextResult.content?.[0]?.text) {
      const contextData = JSON.parse(contextResult.content[0].text);
      const rawMessages = contextData.messages || [];

      console.log('[ContextNode] ===== RAW CONTEXT FROM MCP =====');
      console.log('[ContextNode] Raw message count:', rawMessages.length);
      rawMessages.forEach((msg: any, i: number) => {
        console.log(`[ContextNode]   [${i}] ${msg.role}: ${msg.content?.substring(0, 100)}... (id: ${msg.id || 'NO_ID'})`);
      });

      // Deduplicate by message ID if available, otherwise by position
      const seenIds = new Set<string>();
      contextMessages = rawMessages.filter((msg: any, index: number) => {
        // If message has an ID, use it for deduplication
        if (msg.id) {
          if (seenIds.has(msg.id)) {
            console.log(`[ContextNode] FILTERING OUT duplicate ID: ${msg.id}`);
            return false;
          }
          seenIds.add(msg.id);
          return true;
        }
        // If no ID, keep the message (can't reliably deduplicate without ID)
        return true;
      });

      console.log('[ContextNode] ===== AFTER DEDUPLICATION =====');
      console.log('[ContextNode] Final message count:', contextMessages.length);
      contextMessages.forEach((msg: any, i: number) => {
        console.log(`[ContextNode]   [${i}] ${msg.role}: ${msg.content?.substring(0, 100)}...`);
      });

      // Apply maxMessages limit if configured
      if (maxMessages !== undefined && contextMessages.length > maxMessages) {
        contextMessages = contextMessages.slice(-maxMessages);
        await state.logger.log({
          level: 'debug',
          category: 'context',
          message: `<yellow>ℹ Limited context to ${maxMessages} messages</yellow>`,
          conversationId,
          generationId,
        });
      }

      const removed = rawMessages.length - contextMessages.length;
      if (removed > 0) {
        await state.logger.log({
          level: 'debug',
          category: 'context',
          message: `<yellow>⚠ Removed ${removed} duplicate context messages</yellow>`,
          conversationId,
          generationId,
        });
      }
    }
  } catch (error) {
    console.warn('[ContextNode] Failed to load context history:', error);
  }

  try {
    // Only load summary if includeSummary is true
    if (!includeSummary) {
      await state.logger.log({
        level: 'debug',
        category: 'context',
        message: `<yellow>ℹ Skipping summary (includeSummary=false)</yellow>`,
        conversationId,
        generationId,
      });
      
      return {
        contextMessages,
        contextSummary,
        contextLoaded: true,
        nodeNumber: nextNodeNumber
      };
    }
    
    const summaryResult = await state.mcpClient.callTool(
      'get_summary',
      {
        conversationId,
        summaryType: 'executive'
      },
      {
        conversationId,
        generationId,
        messageId
      }
    );

    if (!summaryResult.isError && summaryResult.content?.[0]?.text) {
      const summaryData = JSON.parse(summaryResult.content[0].text);
      if (summaryData.summary) {
        contextSummary = summaryData.summary;
      }
    }
  } catch (error) {
    console.warn('[ContextNode] Failed to load executive summary:', error);
  }

  return {
    contextMessages,
    contextSummary,
    contextLoaded: true,
    nodeNumber: nextNodeNumber
  };
};
