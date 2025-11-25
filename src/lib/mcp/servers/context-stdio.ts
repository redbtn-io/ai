#!/usr/bin/env tsx
/**
 * Context MCP Server - Stdio Transport
 * Manages conversation context, history, and message storage
 * Communicates via stdin/stdout for low-latency internal tool calls
 */

import { McpServerStdio } from '../server-stdio';
import { CallToolResult } from '../types';
import { getDatabase, StoredMessage, StoredToolExecution } from '../../memory/database';

class ContextServerStdio extends McpServerStdio {
  constructor() {
    super('context', '1.0.0');
  }

  /**
   * Setup tools
   */
  protected async setup(): Promise<void> {
    // Define get_messages tool
    this.defineTool({
      name: 'get_messages',
      description: 'Fetch messages from a conversation. Returns messages with full metadata including tool executions.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID' },
          limit: { type: 'number', description: 'Maximum number of messages (default: 100)', default: 100 }
        },
        required: ['conversationId']
      }
    });

    // Define store_message tool
    this.defineTool({
      name: 'store_message',
      description: 'Store a new message in the conversation.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          userId: { type: 'string' },
          role: { type: 'string', enum: ['user', 'assistant', 'system'] },
          content: { type: 'string' },
          messageId: { type: 'string' }
        },
        required: ['conversationId', 'userId', 'role', 'content']
      }
    });

    // Define get_context_history tool
    this.defineTool({
      name: 'get_context_history',
      description: 'Build formatted conversation context for LLM consumption. Returns an array of messages ready for the LLM.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID' },
          maxTokens: { type: 'number', description: 'Max tokens for recent messages', default: 30000 }
        },
        required: ['conversationId']
      }
    });

    // Define get_conversation_metadata tool
    this.defineTool({
      name: 'get_conversation_metadata',
      description: 'Get conversation metadata including message count and timestamps.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID' }
        },
        required: ['conversationId']
      }
    });

    // Define pattern_matcher tool (now in context server)
    this.defineTool({
      name: 'pattern_matcher',
      description: 'Match text against predefined patterns to identify intents, entities, and context.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to analyze' },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: 'Pattern categories to match against (optional - matches all if not specified)'
          }
        },
        required: ['text']
      }
    });

    this.capabilities = { tools: { listChanged: false } };
  }

  /**
   * Execute tool
   */
  protected async executeTool(
    name: string,
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    switch (name) {
      case 'get_messages':
        return await this.getMessages(args, meta);
      case 'get_context_history':
        return await this.getContextHistory(args, meta);
      case 'get_conversation_metadata':
        return await this.getConversationMetadata(args, meta);
      case 'store_message':
        return await this.storeMessage(args, meta);
      case 'pattern_matcher':
        return await this.matchPatterns(args, meta);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async getMessages(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const conversationId = args.conversationId as string;
      const limit = (args.limit as number) || 100;

      const db = await getDatabase();
      const messages = await (await db.collection<StoredMessage>('messages'))
        .find({ conversationId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ messages: messages.reverse(), count: messages.length })
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  private async getContextHistory(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const conversationId = args.conversationId as string;
      const maxTokens = (args.maxTokens as number) || 30000;

      // Fetch recent messages from database
      const db = await getDatabase();
      const messages = await (await db.collection<StoredMessage>('messages'))
        .find({ conversationId })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();

      // Format as LLM messages - return array directly (matches SSE version)
      const llmMessages = messages.reverse().map(msg => ({
        id: msg.messageId,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp instanceof Date ? msg.timestamp.getTime() : msg.timestamp
      }));

      // Return array directly to match SSE version format
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(llmMessages)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  private async getConversationMetadata(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const conversationId = args.conversationId as string;

      const db = await getDatabase();
      const messages = await (await db.collection<StoredMessage>('messages'))
        .find({ conversationId })
        .toArray();

      const metadata = {
        conversationId,
        messageCount: messages.length,
        firstMessage: messages.length > 0 ? messages[0].timestamp : null,
        lastMessage: messages.length > 0 ? messages[messages.length - 1].timestamp : null
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(metadata)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  private async storeMessage(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { conversationId, userId, role, content, messageId } = args as any;

      const db = await getDatabase();
      const message: any = {
        conversationId,
        userId,
        role,
        content,
        messageId: messageId || `msg_${Date.now()}`,
        timestamp: new Date()
      };

      await (await db.collection('messages')).insertOne(message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, messageId: message.messageId })
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  private async matchPatterns(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const text = args.text as string;
      // Simplified pattern matching - can be enhanced later
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ matches: [], text })
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new ContextServerStdio();
  server.start().catch((error) => {
    console.error('[Context Server] Fatal error:', error);
    process.exit(1);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

export { ContextServerStdio };
