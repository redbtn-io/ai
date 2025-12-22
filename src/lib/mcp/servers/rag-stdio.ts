#!/usr/bin/env tsx
/**
 * RAG MCP Server - Stdio Transport
 * Vector store operations for retrieval-augmented generation
 * Supports both raw collection access and Knowledge Library integration
 * Communicates via stdin/stdout for low-latency internal tool calls
 */

import { McpServerStdio } from '../server-stdio';
import { CallToolResult } from '../types';
import { VectorStoreManager, DocumentChunk, SearchResult } from '../../memory/vectors';

// MongoDB connection for library metadata (lazy loaded)
let mongoClient: any = null;
let mongoDb: any = null;

interface Library {
  libraryId: string;
  userId: string;
  name: string;
  description?: string;
  access: 'private' | 'shared' | 'public';
  vectorCollection: string;
  sharedWith?: Array<{ userId: string; accessLevel: 'read' | 'write' }>;
  documents: Array<{
    documentId: string;
    title: string;
    source?: string;
  }>;
}

class RagServerStdio extends McpServerStdio {
  private vectorStore: VectorStoreManager;

  constructor() {
    super('rag', '1.0.0');
    this.vectorStore = new VectorStoreManager();
  }

  /**
   * Get MongoDB connection (lazy)
   */
  private async getMongo() {
    if (!mongoDb) {
      const { MongoClient } = await import('mongodb');
      const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017';
      mongoClient = new MongoClient(mongoUrl);
      await mongoClient.connect();
      
      // Parse database name from URI or use env var or default
      const dbName = process.env.MONGODB_DB || this.parseDatabaseFromUri(mongoUrl) || 'redbtn';
      mongoDb = mongoClient.db(dbName);
    }
    return mongoDb;
  }

  /**
   * Parse database name from MongoDB URI
   */
  private parseDatabaseFromUri(uri: string): string | null {
    try {
      // URI format: mongodb://user:pass@host:port/database?options
      const url = new URL(uri);
      const pathParts = url.pathname.split('/').filter(Boolean);
      return pathParts[0] || null;
    } catch {
      // Fallback for non-standard URIs
      const match = uri.match(/\/([^?/]+)(?:\?|$)/);
      return match ? match[1] : null;
    }
  }

  /**
   * Setup tools
   */
  protected async setup(): Promise<void> {
    // Legacy tool - raw vector store access
    this.defineTool({
      name: 'add_to_vector_store',
      description: 'Add documents to a raw vector collection for semantic search.',
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

    // Legacy tool - raw vector store search
    this.defineTool({
      name: 'search_vector_store',
      description: 'Search a raw vector collection for relevant documents.',
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

    // NEW: List user's knowledge libraries
    this.defineTool({
      name: 'list_libraries',
      description: 'List all knowledge libraries accessible to the user. Use this to discover available knowledge bases before searching.',
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID to list libraries for' },
          includeShared: { type: 'boolean', description: 'Include libraries shared with user', default: true },
          includePublic: { type: 'boolean', description: 'Include public libraries', default: true }
        },
        required: ['userId']
      }
    });

    // NEW: Search a knowledge library by ID
    this.defineTool({
      name: 'search_library',
      description: 'Search a user\'s knowledge library for relevant documents. Returns semantically similar content from uploaded documents (PDFs, images, text, etc).',
      inputSchema: {
        type: 'object',
        properties: {
          libraryId: { type: 'string', description: 'Library ID to search' },
          query: { type: 'string', description: 'Search query (natural language)' },
          userId: { type: 'string', description: 'User ID for access control' },
          limit: { type: 'number', description: 'Max results to return', default: 5 },
          threshold: { type: 'number', description: 'Minimum similarity score (0-1)', default: 0.6 },
          includeMetadata: { type: 'boolean', description: 'Include document metadata in results', default: true }
        },
        required: ['libraryId', 'query', 'userId']
      }
    });

    // NEW: Search across ALL user libraries at once
    this.defineTool({
      name: 'search_all_libraries',
      description: 'Search across all of a user\'s knowledge libraries at once. Useful for broad knowledge retrieval when you don\'t know which library contains the answer.',
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results per library', default: 3 },
          threshold: { type: 'number', description: 'Minimum similarity', default: 0.6 },
          includeShared: { type: 'boolean', description: 'Include shared libraries', default: true }
        },
        required: ['userId', 'query']
      }
    });

    // NEW: Get library details
    this.defineTool({
      name: 'get_library_info',
      description: 'Get details about a specific knowledge library including document list and stats.',
      inputSchema: {
        type: 'object',
        properties: {
          libraryId: { type: 'string', description: 'Library ID' },
          userId: { type: 'string', description: 'User ID for access control' }
        },
        required: ['libraryId', 'userId']
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
      case 'list_libraries':
        return await this.listLibraries(args, meta);
      case 'search_library':
        return await this.searchLibrary(args, meta);
      case 'search_all_libraries':
        return await this.searchAllLibraries(args, meta);
      case 'get_library_info':
        return await this.getLibraryInfo(args, meta);
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

  /**
   * List libraries accessible to a user
   */
  private async listLibraries(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { userId, includeShared = true, includePublic = true } = args as any;
      
      if (!userId) {
        return { content: [{ type: 'text', text: 'Error: userId is required' }], isError: true };
      }

      const db = await this.getMongo();
      const librariesCollection = db.collection('libraries');

      // Build query for accessible libraries
      const orConditions: any[] = [{ userId }];
      
      if (includeShared) {
        orConditions.push({ 'sharedWith.userId': userId });
      }
      if (includePublic) {
        orConditions.push({ access: 'public' });
      }

      const libraries = await librariesCollection.find(
        { $or: orConditions, isArchived: { $ne: true } },
        { 
          projection: { 
            libraryId: 1, 
            name: 1, 
            description: 1, 
            access: 1,
            documentCount: 1,
            totalChunks: 1,
            userId: 1
          } 
        }
      ).toArray();

      const formatted = libraries.map((lib: any) => ({
        libraryId: lib.libraryId,
        name: lib.name,
        description: lib.description || '',
        access: lib.access,
        documentCount: lib.documentCount || 0,
        totalChunks: lib.totalChunks || 0,
        isOwned: lib.userId === userId
      }));

      return {
        content: [{
          type: 'text',
          text: `Found ${formatted.length} libraries:\n\n${JSON.stringify(formatted, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error listing libraries: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  /**
   * Search a specific library
   */
  private async searchLibrary(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { libraryId, query, userId, limit = 5, threshold = 0.6, includeMetadata = true } = args as any;

      if (!libraryId || !query || !userId) {
        return { content: [{ type: 'text', text: 'Error: libraryId, query, and userId are required' }], isError: true };
      }

      const db = await this.getMongo();
      const library = await db.collection('libraries').findOne({ libraryId }) as Library | null;

      if (!library) {
        return { content: [{ type: 'text', text: `Library '${libraryId}' not found` }], isError: true };
      }

      // Check access
      const hasAccess = 
        library.userId === userId ||
        library.access === 'public' ||
        library.sharedWith?.some(s => s.userId === userId);

      if (!hasAccess) {
        return { content: [{ type: 'text', text: `Access denied to library '${libraryId}'` }], isError: true };
      }

      // Search the vector collection
      const results = await this.vectorStore.search(
        library.vectorCollection,
        query,
        { topK: limit, threshold }
      );

      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No relevant results found in library "${library.name}" for query: "${query}"`
          }]
        };
      }

      // Format results
      const formattedResults = results.map((r: SearchResult, i: number) => {
        const docTitle = r.metadata?.title || r.metadata?.source || 'Unknown';
        const score = ((r.score || 0) * 100).toFixed(1);
        return `## Result ${i + 1} (${score}% match)\n**Document:** ${docTitle}\n\n${r.text}\n`;
      });

      return {
        content: [{
          type: 'text',
          text: `# Search Results from "${library.name}"\n\nQuery: "${query}"\nFound ${results.length} relevant result(s):\n\n${formattedResults.join('\n---\n\n')}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error searching library: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  /**
   * Search across all user libraries
   */
  private async searchAllLibraries(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { userId, query, limit = 3, threshold = 0.6, includeShared = true } = args as any;

      if (!userId || !query) {
        return { content: [{ type: 'text', text: 'Error: userId and query are required' }], isError: true };
      }

      const db = await this.getMongo();
      
      // Get all accessible libraries
      const orConditions: any[] = [{ userId }];
      if (includeShared) {
        orConditions.push({ 'sharedWith.userId': userId });
        orConditions.push({ access: 'public' });
      }

      const libraries = await db.collection('libraries').find(
        { $or: orConditions, isArchived: { $ne: true } }
      ).toArray() as Library[];

      if (libraries.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No libraries found for this user.'
          }]
        };
      }

      // Search each library
      const allResults: Array<{ library: string; libraryId: string; results: SearchResult[] }> = [];

      for (const lib of libraries) {
        try {
          const results = await this.vectorStore.search(
            lib.vectorCollection,
            query,
            { topK: limit, threshold }
          );

          if (results.length > 0) {
            allResults.push({
              library: lib.name,
              libraryId: lib.libraryId,
              results
            });
          }
        } catch (e) {
          // Skip libraries with search errors
          console.error(`[RAG] Error searching library ${lib.libraryId}:`, e);
        }
      }

      if (allResults.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No relevant results found across ${libraries.length} libraries for query: "${query}"`
          }]
        };
      }

      // Format results grouped by library
      const formatted = allResults.map(({ library, libraryId, results }) => {
        const resultTexts = results.map((r: SearchResult, i: number) => {
          const docTitle = r.metadata?.title || r.metadata?.source || 'Unknown';
          const score = ((r.score || 0) * 100).toFixed(1);
          return `  ${i + 1}. [${score}%] ${docTitle}\n     ${r.text.substring(0, 200)}...`;
        }).join('\n\n');
        
        return `## ${library} (${libraryId})\n${resultTexts}`;
      }).join('\n\n---\n\n');

      const totalResults = allResults.reduce((sum, r) => sum + r.results.length, 0);

      return {
        content: [{
          type: 'text',
          text: `# Cross-Library Search Results\n\nQuery: "${query}"\nSearched ${libraries.length} libraries, found ${totalResults} results in ${allResults.length} libraries:\n\n${formatted}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error searching libraries: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true
      };
    }
  }

  /**
   * Get library info
   */
  private async getLibraryInfo(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const { libraryId, userId } = args as any;

      if (!libraryId || !userId) {
        return { content: [{ type: 'text', text: 'Error: libraryId and userId are required' }], isError: true };
      }

      const db = await this.getMongo();
      const library = await db.collection('libraries').findOne({ libraryId }) as Library | null;

      if (!library) {
        return { content: [{ type: 'text', text: `Library '${libraryId}' not found` }], isError: true };
      }

      // Check access
      const hasAccess = 
        library.userId === userId ||
        library.access === 'public' ||
        library.sharedWith?.some(s => s.userId === userId);

      if (!hasAccess) {
        return { content: [{ type: 'text', text: `Access denied to library '${libraryId}'` }], isError: true };
      }

      const info = {
        libraryId: library.libraryId,
        name: library.name,
        description: library.description || '',
        access: library.access,
        documentCount: library.documents?.length || 0,
        documents: library.documents?.map(d => ({
          documentId: d.documentId,
          title: d.title,
          source: d.source
        })) || [],
        isOwned: library.userId === userId
      };

      return {
        content: [{
          type: 'text',
          text: `# Library: ${info.name}\n\n${info.description}\n\n**Documents (${info.documentCount}):**\n${info.documents.map((d: any) => `- ${d.title}`).join('\n')}\n\n**Full Info:**\n${JSON.stringify(info, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error getting library info: ${error instanceof Error ? error.message : 'Unknown error'}` }],
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
