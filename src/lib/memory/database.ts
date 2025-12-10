/**
 * Database Manager - Mongoose-only implementation
 * 
 * Unified database connection using Mongoose for all operations.
 * Eliminates redundant MongoClient connections.
 */

import mongoose, { Connection } from 'mongoose';
import { ObjectId, Document } from 'mongodb';

// Import models
import Message, { IMessage, MessageDocument } from '../models/Message';
import Conversation, { IConversation, ConversationDocument } from '../models/Conversation';
import Log, { ILog, LogDocument } from '../models/Log';
import Generation, { IGeneration, GenerationDocument } from '../models/Generation';
import Thought, { IThought, ThoughtDocument } from '../models/Thought';

// ============================================================================
// TYPE RE-EXPORTS (for backward compatibility)
// ============================================================================

export type { IMessage as StoredMessage } from '../models/Message';
export type { IToolStep as StoredToolStep, IToolExecution as StoredToolExecution } from '../models/Message';
export type { IConversation as Conversation } from '../models/Conversation';
export type { ILog as StoredLog } from '../models/Log';
export type { IGeneration as Generation } from '../models/Generation';
export type { IThought as StoredThought } from '../models/Thought';

/**
 * Base document interface - all MongoDB documents extend this
 */
export interface BaseDocument {
  _id?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

// ============================================================================
// DATABASE MANAGER CLASS
// ============================================================================

/**
 * Universal database manager for MongoDB operations using Mongoose
 * Supports messages, conversations, logs, generations, and thoughts
 */
class DatabaseManager {
  private connectionPromise: Promise<void> | null = null;
  private isConnected: boolean = false;

  constructor(
    private mongoUrl: string = 'mongodb://localhost:27017',
    private dbName: string = 'redbtn'
  ) {}

  // ==========================================================================
  // CONNECTION MANAGEMENT
  // ==========================================================================

  /**
   * Connect to MongoDB using Mongoose
   */
  async connect(): Promise<void> {
    // Return existing promise if connecting
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Already connected
    if (mongoose.connection.readyState === 1) {
      this.isConnected = true;
      return;
    }

    this.connectionPromise = (async () => {
      try {
        console.log('[Database] Connecting to MongoDB via Mongoose...');
        
        await mongoose.connect(this.mongoUrl, {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 10000,
        });
        
        this.isConnected = true;
        console.log('[Database] Connected to MongoDB successfully');
      } catch (error) {
        console.error('[Database] Failed to connect to MongoDB:', error);
        console.error('[Database] Connection string:', this.mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'));
        this.connectionPromise = null;
        throw error;
      }
    })();

    return this.connectionPromise;
  }

  /**
   * Ensure connection is established
   */
  private async ensureConnected(): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
      await this.connect();
    }
  }

  // ==========================================================================
  // MESSAGE OPERATIONS
  // ==========================================================================

  /**
   * Store a message in the database
   */
  async storeMessage(message: IMessage, userId?: string): Promise<ObjectId> {
    await this.ensureConnected();
    
    console.log(`[Database] storeMessage called - messageId:${message.messageId}, role:${message.role}, userId:${userId}`);
    
    try {
      const doc = await Message.create(message);
      console.log(`[Database] Message stored successfully - messageId:${message.messageId}, _id:${doc._id}`);
      
      // Update conversation's updatedAt timestamp and set userId
      const updateDoc: any = {
        $set: { updatedAt: new Date() },
        $inc: { 'metadata.messageCount': 1 },
      };
      
      if (userId) {
        updateDoc.$setOnInsert = { userId, conversationId: message.conversationId };
        console.log(`[Database] Setting userId=${userId} for conversation ${message.conversationId} (upsert)`);
      }
      
      await Conversation.updateOne(
        { conversationId: message.conversationId },
        updateDoc,
        { upsert: true }
      );
      
      return doc._id as ObjectId;
    } catch (error: any) {
      // If duplicate key error, message already exists
      if (error.code === 11000) {
        console.log(`[Database] Message ${message.messageId} already exists, skipping duplicate`);
        return new ObjectId();
      }
      throw error;
    }
  }

  /**
   * Store multiple messages in bulk
   */
  async storeMessages(messages: IMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.ensureConnected();
    
    await Message.insertMany(messages);
    
    // Update conversation timestamp
    const conversationId = messages[0].conversationId;
    await Conversation.updateOne(
      { conversationId },
      {
        $set: { updatedAt: new Date() },
        $inc: { 'metadata.messageCount': messages.length },
      },
      { upsert: true }
    );
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, limit: number = 0, skip: number = 0): Promise<IMessage[]> {
    await this.ensureConnected();
    
    let query = Message.find({ conversationId })
      .sort({ timestamp: 1 })
      .skip(skip);
    
    if (limit > 0) {
      query = query.limit(limit);
    }
    
    return await query.lean();
  }

  /**
   * Get the last N messages for a conversation
   */
  async getLastMessages(conversationId: string, count: number): Promise<IMessage[]> {
    await this.ensureConnected();
    
    const messages = await Message.find({ conversationId })
      .sort({ timestamp: -1 })
      .limit(count)
      .lean();
    
    // Reverse to get chronological order
    return messages.reverse();
  }

  /**
   * Get message count for a conversation
   */
  async getMessageCount(conversationId: string): Promise<number> {
    await this.ensureConnected();
    return await Message.countDocuments({ conversationId });
  }

  // ==========================================================================
  // CONVERSATION OPERATIONS
  // ==========================================================================

  /**
   * Create or update a conversation
   */
  async upsertConversation(conversation: IConversation): Promise<void> {
    await this.ensureConnected();
    
    const { conversationId, ...updateData } = conversation;
    
    await Conversation.updateOne(
      { conversationId },
      {
        $set: { ...updateData, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  /**
   * Update conversation title
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.ensureConnected();
    await Conversation.updateOne(
      { conversationId },
      { $set: { title, updatedAt: new Date() } }
    );
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string): Promise<IConversation | null> {
    await this.ensureConnected();
    return await Conversation.findOne({ conversationId }).lean();
  }

  /**
   * Get all conversations for a user (sorted by most recent)
   */
  async getConversations(userId: string, limit: number = 50, skip: number = 0): Promise<IConversation[]> {
    await this.ensureConnected();
    return await Conversation.find({ userId })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.ensureConnected();
    await Message.deleteMany({ conversationId });
    await Conversation.deleteOne({ conversationId });
  }

  // ==========================================================================
  // LOG OPERATIONS
  // ==========================================================================

  /**
   * Store a log entry
   */
  async storeLog(log: ILog): Promise<ObjectId> {
    await this.ensureConnected();
    const doc = await Log.create(log);
    return doc._id as ObjectId;
  }

  /**
   * Store multiple log entries
   */
  async storeLogs(logs: ILog[]): Promise<ObjectId[]> {
    if (logs.length === 0) return [];
    await this.ensureConnected();
    const docs = await Log.insertMany(logs);
    return docs.map(d => d._id as ObjectId);
  }

  /**
   * Get logs by generation ID
   */
  async getLogsByGeneration(generationId: string, limit?: number): Promise<ILog[]> {
    await this.ensureConnected();
    let query = Log.find({ generationId }).sort({ timestamp: 1 });
    if (limit) query = query.limit(limit);
    return await query.lean();
  }

  /**
   * Get logs by conversation ID
   */
  async getLogsByConversation(conversationId: string, limit?: number): Promise<ILog[]> {
    await this.ensureConnected();
    let query = Log.find({ conversationId }).sort({ timestamp: -1 });
    if (limit) query = query.limit(limit);
    return await query.lean();
  }

  /**
   * Get logs by level
   */
  async getLogsByLevel(level: string, limit?: number): Promise<ILog[]> {
    await this.ensureConnected();
    let query = Log.find({ level }).sort({ timestamp: -1 });
    if (limit) query = query.limit(limit);
    return await query.lean();
  }

  /**
   * Get logs with filters
   */
  async getLogs(filter: any = {}, limit: number = 100, skip: number = 0): Promise<ILog[]> {
    await this.ensureConnected();
    return await Log.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  /**
   * Delete old logs (older than specified date)
   */
  async deleteOldLogs(olderThan: Date): Promise<number> {
    await this.ensureConnected();
    const result = await Log.deleteMany({ timestamp: { $lt: olderThan } });
    return result.deletedCount;
  }

  /**
   * Get all conversations that have logs with counts and metadata
   */
  async getConversationsWithLogs(): Promise<any[]> {
    await this.ensureConnected();
    
    // Aggregate logs by conversationId
    const logAggregation = await Log.aggregate([
      {
        $group: {
          _id: '$conversationId',
          logCount: { $sum: 1 },
          lastLogTime: { $max: '$timestamp' }
        }
      },
      { $sort: { lastLogTime: -1 } }
    ]);
    
    // Get generation counts
    const generationAggregation = await Generation.aggregate([
      {
        $group: {
          _id: '$conversationId',
          generationCount: { $sum: 1 }
        }
      }
    ]);
    
    // Create map for quick lookup
    const generationMap = new Map(
      generationAggregation.map(g => [g._id, g.generationCount])
    );
    
    // Build result with conversation titles
    const results = await Promise.all(
      logAggregation.map(async (agg) => {
        const conversationId = agg._id;
        const conversation = await Conversation.findOne({ conversationId }).lean();
        
        return {
          conversationId,
          title: conversation?.title,
          lastLogTime: agg.lastLogTime,
          logCount: agg.logCount,
          generationCount: generationMap.get(conversationId) || 0
        };
      })
    );
    
    return results;
  }

  // ==========================================================================
  // GENERATION OPERATIONS
  // ==========================================================================

  /**
   * Store a generation entry
   */
  async storeGeneration(generation: IGeneration): Promise<ObjectId> {
    await this.ensureConnected();
    const doc = await Generation.create(generation);
    return doc._id as ObjectId;
  }

  /**
   * Update generation status
   */
  async updateGenerationStatus(
    generationId: string,
    status: string,
    metadata?: any
  ): Promise<boolean> {
    await this.ensureConnected();
    
    const updateDoc: any = { status };
    if (status === 'completed' || status === 'failed') {
      updateDoc.endTime = new Date();
    }
    if (metadata) {
      Object.assign(updateDoc, metadata);
    }
    
    const result = await Generation.updateOne({ generationId }, { $set: updateDoc });
    return result.modifiedCount > 0;
  }

  /**
   * Get a generation by ID
   */
  async getGeneration(generationId: string): Promise<IGeneration | null> {
    await this.ensureConnected();
    return await Generation.findOne({ generationId }).lean();
  }

  /**
   * Get generations by conversation ID
   */
  async getGenerationsByConversation(conversationId: string, limit?: number): Promise<IGeneration[]> {
    await this.ensureConnected();
    let query = Generation.find({ conversationId }).sort({ startTime: -1 });
    if (limit) query = query.limit(limit);
    return await query.lean();
  }

  /**
   * Get active generations (pending or streaming)
   */
  async getActiveGenerations(): Promise<IGeneration[]> {
    await this.ensureConnected();
    return await Generation.find({ status: { $in: ['pending', 'streaming'] } })
      .sort({ startTime: -1 })
      .lean();
  }

  /**
   * Delete old generations (older than specified date)
   */
  async deleteOldGenerations(olderThan: Date): Promise<number> {
    await this.ensureConnected();
    const result = await Generation.deleteMany({
      startTime: { $lt: olderThan },
      status: { $in: ['completed', 'failed'] }
    });
    return result.deletedCount;
  }

  // ==========================================================================
  // THOUGHT OPERATIONS
  // ==========================================================================

  /**
   * Store a thought/reasoning entry
   */
  async storeThought(thought: IThought): Promise<ObjectId> {
    await this.ensureConnected();
    const doc = await Thought.create(thought);
    return doc._id as ObjectId;
  }

  /**
   * Store multiple thoughts in bulk
   */
  async storeThoughts(thoughts: IThought[]): Promise<void> {
    if (thoughts.length === 0) return;
    await this.ensureConnected();
    await Thought.insertMany(thoughts);
  }

  /**
   * Get thought by ID
   */
  async getThought(thoughtId: string): Promise<IThought | null> {
    await this.ensureConnected();
    return await Thought.findOne({ thoughtId }).lean();
  }

  /**
   * Get thoughts for a specific message
   */
  async getThoughtsByMessage(messageId: string): Promise<IThought[]> {
    await this.ensureConnected();
    return await Thought.find({ messageId }).sort({ timestamp: 1 }).lean();
  }

  /**
   * Get thoughts for a conversation
   */
  async getThoughtsByConversation(conversationId: string, limit?: number): Promise<IThought[]> {
    await this.ensureConnected();
    let query = Thought.find({ conversationId }).sort({ timestamp: -1 });
    if (limit) query = query.limit(limit);
    return await query.lean();
  }

  /**
   * Get thoughts for a generation
   */
  async getThoughtsByGeneration(generationId: string): Promise<IThought[]> {
    await this.ensureConnected();
    return await Thought.find({ generationId }).sort({ timestamp: 1 }).lean();
  }

  /**
   * Get thoughts by source (chat, router, toolPicker)
   */
  async getThoughtsBySource(source: string, conversationId?: string, limit?: number): Promise<IThought[]> {
    await this.ensureConnected();
    const filter: any = { source };
    if (conversationId) {
      filter.conversationId = conversationId;
    }
    let query = Thought.find(filter).sort({ timestamp: -1 });
    if (limit) query = query.limit(limit);
    return await query.lean();
  }

  /**
   * Delete old thoughts (older than specified date)
   */
  async deleteOldThoughts(olderThan: Date): Promise<number> {
    await this.ensureConnected();
    const result = await Thought.deleteMany({ timestamp: { $lt: olderThan } });
    return result.deletedCount;
  }

  // ==========================================================================
  // GENERIC COLLECTION ACCESS (for advanced use cases)
  // ==========================================================================

  /**
   * Get direct access to Mongoose connection for custom operations
   */
  getConnection(): Connection {
    return mongoose.connection;
  }

  /**
   * Get the native MongoDB database object (for rare cases needing direct access)
   */
  async getDb() {
    await this.ensureConnected();
    return mongoose.connection.db;
  }

  /**
   * Get a native MongoDB collection by name (for backward compatibility)
   * Prefer using Mongoose models when possible.
   */
  async collection<T extends Document = Document>(name: string) {
    await this.ensureConnected();
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');
    return db.collection<T>(name);
  }

  // ==========================================================================
  // CONNECTION MANAGEMENT
  // ==========================================================================

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      this.isConnected = false;
      this.connectionPromise = null;
      console.log('[Database] Closed MongoDB connection');
    }
  }
}

// ============================================================================
// SINGLETON & EXPORTS
// ============================================================================

// Singleton instance
let dbInstance: DatabaseManager | null = null;

/**
 * Get the singleton database instance
 * @param mongoUrl - MongoDB connection URL (default: from env or localhost)
 * @param dbName - Database name (default: from env or 'redbtn')
 */
export function getDatabase(mongoUrl?: string, dbName?: string): DatabaseManager {
  if (!dbInstance) {
    // Support both MONGODB_URI and MONGODB_URL
    const envUri = process.env.MONGODB_URI || process.env.MONGODB_URL || 'mongodb://localhost:27017';
    const url = mongoUrl || envUri;
    
    // Try to extract database name from URI if present
    let name = dbName;
    if (!name) {
      // Parse database name from URI like mongodb://user:pass@host:port/dbname
      const dbMatch = url.match(/\/([^/?]+)(\?|$)/);
      if (dbMatch && dbMatch[1]) {
        name = dbMatch[1];
      } else {
        name = process.env.MONGODB_NAME || 'redbtn';
      }
    }
    
    dbInstance = new DatabaseManager(url, name);
  }
  return dbInstance;
}

/**
 * Connect to database (convenience function)
 * Ensures the singleton is connected and returns it
 */
export async function connectDatabase(mongoUrl?: string): Promise<DatabaseManager> {
  const db = getDatabase(mongoUrl);
  await db.connect();
  return db;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetDatabase(): void {
  dbInstance = null;
}

export { DatabaseManager };
