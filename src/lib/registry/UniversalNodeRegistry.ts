/**
 * Universal Node Registry
 * 
 * Loads and caches universal node configurations from MongoDB.
 * Replaces static TypeScript imports with dynamic database lookups.
 * 
 * Supports user-aware resolution:
 * 1. User's own node (clone or custom) takes priority
 * 2. Falls back to system node
 */

import { getNodeConfig, listSystemNodes, getNodeConfigForUser } from '../models/Node';
import type { NodeConfig } from '../nodes/universal/types';

class UniversalNodeRegistry {
  private cache: Map<string, NodeConfig> = new Map();
  private userCache: Map<string, NodeConfig> = new Map(); // key: userId:nodeId
  private initialized = false;
  
  /**
   * Initialize registry by loading all system nodes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('[UniversalNodeRegistry] Loading system nodes from MongoDB...');
    
    const systemNodes = await listSystemNodes();
    
    for (const node of systemNodes) {
      this.cache.set(node.nodeId, {
        nodeId: node.nodeId,
        name: node.name,
        steps: node.steps
      });
    }
    
    console.log(`[UniversalNodeRegistry] Loaded ${systemNodes.length} system nodes`);
    this.initialized = true;
  }
  
  /**
   * Get a universal node config by ID (system nodes only, for backwards compatibility)
   * Checks cache first, then database
   */
  async get(nodeId: string): Promise<NodeConfig | null> {
    // Check cache
    if (this.cache.has(nodeId)) {
      return this.cache.get(nodeId)!;
    }
    
    // Load from database
    const doc = await getNodeConfig(nodeId);
    
    if (!doc) {
      return null;
    }
    
    const config: NodeConfig = {
      nodeId: doc.nodeId,
      name: doc.name,
      steps: doc.steps
    };
    
    // Cache it
    this.cache.set(nodeId, config);
    
    return config;
  }
  
  /**
   * Get a universal node config with user priority resolution
   * 
   * Resolution order:
   * 1. User's own node (clone or custom)
   * 2. System node
   * 
   * @param nodeId The node identifier
   * @param userId The user ID for priority resolution
   */
  async getForUser(nodeId: string, userId: string): Promise<NodeConfig | null> {
    const userCacheKey = `${userId}:${nodeId}`;
    
    // Check user-specific cache first
    if (this.userCache.has(userCacheKey)) {
      return this.userCache.get(userCacheKey)!;
    }
    
    // Load from database with user priority
    const doc = await getNodeConfigForUser(nodeId, userId);
    
    if (!doc) {
      return null;
    }
    
    const config: NodeConfig = {
      nodeId: doc.nodeId,
      name: doc.name,
      steps: doc.steps
    };
    
    // Cache based on whether it's user-specific or system
    if (doc.userId === userId && !doc.isSystem) {
      this.userCache.set(userCacheKey, config);
    } else {
      this.cache.set(nodeId, config);
    }
    
    return config;
  }
  
  /**
   * Check if a node exists
   */
  async has(nodeId: string): Promise<boolean> {
    if (this.cache.has(nodeId)) {
      return true;
    }
    
    const config = await this.get(nodeId);
    return config !== null;
  }
  
  /**
   * Invalidate cache (useful after updates)
   */
  invalidate(nodeId?: string, userId?: string): void {
    if (nodeId && userId) {
      // Invalidate specific user's node
      this.userCache.delete(`${userId}:${nodeId}`);
    } else if (nodeId) {
      // Invalidate system node and all user versions
      this.cache.delete(nodeId);
      // Also clear any user-cached versions of this node
      for (const key of this.userCache.keys()) {
        if (key.endsWith(`:${nodeId}`)) {
          this.userCache.delete(key);
        }
      }
    } else {
      // Clear everything
      this.cache.clear();
      this.userCache.clear();
      this.initialized = false;
    }
  }
  
  /**
   * List all available node IDs
   */
  listNodeIds(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Singleton instance
export const universalNodeRegistry = new UniversalNodeRegistry();

/**
 * Helper function to get a universal node config
 * Ensures registry is initialized
 */
export async function getUniversalNode(nodeId: string): Promise<NodeConfig | null> {
  await universalNodeRegistry.initialize();
  return universalNodeRegistry.get(nodeId);
}

/**
 * Helper function to get the raw node document from MongoDB
 * Used to access parameter definitions and other metadata not in NodeConfig
 */
export async function getUniversalNodeRaw(nodeId: string): Promise<any | null> {
  return getNodeConfig(nodeId);
}
