#!/usr/bin/env tsx
/**
 * RAG MCP Server - Stdio Transport
 * Vector store operations for retrieval-augmented generation
 * Communicates via stdin/stdout for low-latency internal tool calls
 */

import { McpServerStdio } from '../server-stdio';
import { CallToolResult } from '../types';
import { VectorStoreManager, DocumentChunk } from '../../memory/vectors';

class RagServerStdio extends McpServerStdio {
  private vectorStore: VectorStoreManager;

  constructor() {
    super('rag', '1.0.0');
    this.vectorStore = new VectorStoreManager();
  }

  /**
   * Setup tools
   */
  protected async setup(): Promise<void> {
    this.defineTool({
      name: 'add_to_vector_store',
      description: 'Add documents to the vector store for semantic search.',
      inputSchema: {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Collection ID' },
          documents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                metadata: { type: 'object' }
              }
            }
          }
        },
        required: ['collectionId', 'documents']
      }
    });

    this.defineTool({
      name: 'search_vector_store',
      description: 'Search the vector store for relevant documents.',
      inputSchema: {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Collection ID' },
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results', default: 5 }
        },
        required: ['collectionId', 'query']
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
      case 'add_to_vector_store':
        return await this.addToVectorStore(args, meta);
      case 'search_vector_store':
        return await this.searchVectorStore(args, meta);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async addToVectorStore(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { collectionId, documents } = args as any;
      const chunks: DocumentChunk[] = documents.map((doc: any, i: number) => ({
        id: `chunk_${Date.now()}_${i}`,
        content: doc.content,
        metadata: doc.metadata || {},
        embedding: []
      }));

      await this.vectorStore.addDocuments(collectionId, chunks);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, count: chunks.length })
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  private async searchVectorStore(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { collectionId, query, limit = 5 } = args as any;
      const results = await this.vectorStore.search(collectionId, query, { topK: limit });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ results, count: results.length })
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
  const server = new RagServerStdio();
  server.start().catch((error) => {
    console.error('[RAG Server] Fatal error:', error);
    process.exit(1);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

export { RagServerStdio };
