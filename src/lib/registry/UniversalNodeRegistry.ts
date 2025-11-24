/**
 * Universal Node Registry
 * 
 * Loads and caches universal node configurations from MongoDB.
 * Replaces static TypeScript imports with dynamic database lookups.
 */

import { getUniversalNodeConfig, listSystemUniversalNodes } from '../models/UniversalNodeConfig';
import type { UniversalNodeConfig } from '../nodes/universal/types';

class UniversalNodeRegistry {
  private cache: Map<string, UniversalNodeConfig> = new Map();
  private initialized = false;
  
  /**
   * Initialize registry by loading all system nodes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('[UniversalNodeRegistry] Loading system nodes from MongoDB...');
    
    const systemNodes = await listSystemUniversalNodes();
    
    for (const node of systemNodes) {
      this.cache.set(node.nodeId, {
        steps: node.steps
      });
    }
    
    console.log(`[UniversalNodeRegistry] Loaded ${systemNodes.length} system nodes`);
    this.initialized = true;
  }
  
  /**
   * Get a universal node config by ID
   * Checks cache first, then database
   */
  async get(nodeId: string): Promise<UniversalNodeConfig | null> {
    // Check cache
    if (this.cache.has(nodeId)) {
      return this.cache.get(nodeId)!;
    }
    
    // Load from database
    const doc = await getUniversalNodeConfig(nodeId);
    
    if (!doc) {
      return null;
    }
    
    const config: UniversalNodeConfig = {
      steps: doc.steps
    };
    
    // Cache it
    this.cache.set(nodeId, config);
    
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
  invalidate(nodeId?: string): void {
    if (nodeId) {
      this.cache.delete(nodeId);
    } else {
      this.cache.clear();
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
export async function getUniversalNode(nodeId: string): Promise<UniversalNodeConfig | null> {
  await universalNodeRegistry.initialize();
  return universalNodeRegistry.get(nodeId);
}
