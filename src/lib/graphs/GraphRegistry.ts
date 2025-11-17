/**
 * GraphRegistry
 * 
 * Phase 1: Dynamic Graph System
 * Manages dynamic loading, caching, and compilation of graph configurations.
 * Mirrors NeuronRegistry architecture pattern.
 * 
 * Key Features:
 * - LRU cache for compiled graphs (5min TTL)
 * - Per-user graph compilation
 * - Tier-based access control
 * - System default graphs + user custom graphs
 * - JIT compilation from MongoDB configs
 */

import { LRUCache } from "lru-cache";
import { DatabaseManager } from "../memory/database";
import { Graph, GraphDocument } from "../models/Graph";
import { GraphConfig, CompiledGraph } from "../types/graph";
import { compileGraphFromConfig, GraphCompilationError } from "./compiler";
import type { RedConfig } from "../../index";

/**
 * Custom error classes for graph operations
 */
export class GraphNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphNotFoundError';
  }
}

export class GraphAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphAccessDeniedError';
  }
}

/**
 * GraphRegistry - Dynamic graph loading and compilation
 */
export class GraphRegistry {
  private compiledCache: LRUCache<string, CompiledGraph>;
  private configCache: LRUCache<string, GraphConfig>;
  private db: DatabaseManager;
  private config: RedConfig;
  
  constructor(config: RedConfig) {
    this.config = config;
    this.db = new DatabaseManager(config.databaseUrl);
    
    // Cache compiled graphs (expensive to compile)
    this.compiledCache = new LRUCache<string, CompiledGraph>({
      max: 50,            // Fewer graphs than neurons typically
      ttl: 5 * 60 * 1000  // 5 minutes (same as NeuronRegistry)
    });
    
    // Cache graph configs (faster lookup, more entries)
    this.configCache = new LRUCache<string, GraphConfig>({
      max: 100,
      ttl: 5 * 60 * 1000
    });
  }
  
  /**
   * Initialize the registry (connect to database)
   */
  async initialize(): Promise<void> {
    await this.db.connect();
    console.log('[GraphRegistry] Initialized successfully');
  }
  
  /**
   * Get a compiled graph for the given graphId and user.
   * Loads from cache if available, otherwise compiles from config.
   * 
   * @param graphId The graph identifier (e.g., "red-graph-default")
   * @param userId The requesting user's ID
   * @returns Compiled LangGraph instance with metadata
   * @throws GraphNotFoundError if graph doesn't exist
   * @throws GraphAccessDeniedError if user lacks permission
   * @throws GraphCompilationError if compilation fails
   */
  async getGraph(graphId: string, userId: string): Promise<CompiledGraph> {
    const cacheKey = `${userId}:${graphId}`;
    
    // Check cache first
    let compiled = this.compiledCache.get(cacheKey);
    if (compiled) {
      console.log(`[GraphRegistry] Cache hit for graph: ${graphId} (user: ${userId})`);
      return compiled;
    }
    
    console.log(`[GraphRegistry] Cache miss for graph: ${graphId} (user: ${userId})`);
    
    // Load config from MongoDB
    const graphConfig = await this.getConfig(graphId, userId);
    
    // Validate access permissions
    await this.validateAccess(graphConfig, userId);
    
    // Compile graph from config
    try {
      compiled = compileGraphFromConfig(graphConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new GraphCompilationError(
        `Failed to compile graph '${graphId}': ${errorMessage}`,
        graphId
      );
    }
    
    // Cache it
    this.compiledCache.set(cacheKey, compiled);
    console.log(`[GraphRegistry] Compiled and cached graph: ${graphId}`);
    
    // Update usage stats in background (non-blocking)
    this.updateUsageStats(graphId, userId).catch(err => {
      console.error(`[GraphRegistry] Failed to update usage stats for ${graphId}:`, err);
    });
    
    return compiled;
  }
  
  /**
   * Load graph configuration from MongoDB (with caching)
   * 
   * @param graphId The graph identifier
   * @param userId The requesting user's ID
   * @returns Graph configuration
   * @throws GraphNotFoundError if graph not found
   */
  async getConfig(graphId: string, userId: string): Promise<GraphConfig> {
    const cacheKey = `${userId}:${graphId}`;
    
    // Check cache first
    let graphConfig = this.configCache.get(cacheKey);
    if (graphConfig) {
      console.log(`[GraphRegistry] Config cache hit: ${graphId}`);
      return graphConfig;
    }
    
    // Query MongoDB - find user's custom graph OR system default
    const doc = await Graph.findOne({
      graphId,
      $or: [
        { userId: userId },      // User's custom graph
        { userId: 'system' }     // System default graph
      ]
    });
    
    if (!doc) {
      throw new GraphNotFoundError(
        `Graph '${graphId}' not found for user ${userId}`
      );
    }
    
    // Convert to runtime config
    const rawConfig = doc.toObject();
    
    // CRITICAL: Convert Mongoose Map types to plain objects
    // Mongoose stores 'targets' as Map, but compiler expects Record<string, string>
    graphConfig = {
      ...rawConfig,
      edges: rawConfig.edges.map((edge: any) => ({
        ...edge,
        targets: edge.targets instanceof Map 
          ? Object.fromEntries(edge.targets) 
          : edge.targets
      }))
    } as GraphConfig;
    
    // Cache it
    this.configCache.set(cacheKey, graphConfig);
    console.log(`[GraphRegistry] Config loaded from DB: ${graphId}`);
    
    return graphConfig;
  }
  
  /**
   * Validate user has permission to use this graph
   * 
   * @param graphConfig The graph configuration
   * @param userId The requesting user's ID
   * @throws GraphAccessDeniedError if access denied
   */
  private async validateAccess(graphConfig: GraphConfig, userId: string): Promise<void> {
    // Users can always access their own graphs
    if (graphConfig.userId === userId) {
      return;
    }
    
    // For system graphs, check tier requirement
    if (graphConfig.userId === 'system') {
      const userTier = await this.getUserTier(userId);
      
      // Tier check: user tier must be <= graph tier (lower number = higher tier)
      // Tier 0 = ULTIMATE, Tier 1 = ADVANCED, etc.
      if (userTier > graphConfig.tier) {
        throw new GraphAccessDeniedError(
          `Graph '${graphConfig.graphId}' requires tier ${graphConfig.tier} or higher (user has tier ${userTier})`
        );
      }
      return;
    }
    
    // Other users' graphs are not accessible
    throw new GraphAccessDeniedError(
      `Graph '${graphConfig.graphId}' is private and owned by another user`
    );
  }
  
  /**
   * Get user's account tier from webapp User model
   * 
   * @param userId The user's ID
   * @returns Tier number (0=ULTIMATE, 1=ADVANCED, 2=BASIC, 3=TRIAL, 4=FREE)
   */
  private async getUserTier(userId: string): Promise<number> {
    try {
      // Load user tier from MongoDB (Mongoose already connected)
      const mongoose = require('mongoose');
      
      // Get or define User model
      let User;
      try {
        User = mongoose.model('User');
      } catch {
        const userSchema = new mongoose.Schema({}, { 
          collection: 'users',
          strict: false  // Allow reading all fields
        });
        User = mongoose.model('User', userSchema);
      }
      
      const user = await User.findById(userId).lean();
      if (user && typeof user.accountLevel === 'number') {
        return user.accountLevel;
      }
      
      // Default to FREE tier if user not found or no accountLevel
      return 4;
    } catch (error) {
      console.error('[GraphRegistry] Error loading user tier:', error);
      return 4; // Fail-safe: FREE tier
    }
  }
  
  /**
   * Get all graphs accessible by user (for UI display)
   * 
   * @param userId The user's ID
   * @returns Array of graph configurations
   */
  async getUserGraphs(userId: string): Promise<GraphConfig[]> {
    const userTier = await this.getUserTier(userId);
    
    const docs = await Graph.find({
      $or: [
        { userId: userId },                          // User's custom graphs
        { userId: 'system', tier: { $gte: userTier } } // System graphs user can access
      ]
    });
    
    return docs.map(doc => doc.toObject() as GraphConfig);
  }
  
  /**
   * Update usage statistics for a graph (async, non-blocking)
   */
  private async updateUsageStats(graphId: string, userId: string): Promise<void> {
    await Graph.updateOne(
      { 
        graphId, 
        $or: [
          { userId: userId },
          { userId: 'system' }
        ]
      },
      { 
        $inc: { usageCount: 1 },
        $set: { lastUsedAt: new Date() }
      }
    ).exec();
  }
  
  /**
   * Invalidate cache (after graph updates)
   * 
   * @param userId Optional - if provided, only clear this user's cache
   */
  async clearCache(userId?: string): Promise<void> {
    if (userId) {
      // Clear specific user's cache
      let clearedCount = 0;
      for (const key of this.compiledCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.compiledCache.delete(key);
          this.configCache.delete(key);
          clearedCount++;
        }
      }
      console.log(`[GraphRegistry] Cleared cache for user ${userId} (${clearedCount} entries)`);
    } else {
      // Clear all caches
      this.compiledCache.clear();
      this.configCache.clear();
      console.log('[GraphRegistry] Cleared all caches');
    }
  }
  
  /**
   * Get cache statistics (for monitoring/debugging)
   */
  getCacheStats() {
    return {
      compiled: {
        size: this.compiledCache.size,
        max: this.compiledCache.max
      },
      config: {
        size: this.configCache.size,
        max: this.configCache.max
      }
    };
  }
  
  /**
   * Shutdown registry (disconnect from database)
   */
  async shutdown(): Promise<void> {
    await this.db.close();
    console.log('[GraphRegistry] Shut down');
  }
}
