/**
 * NeuronRegistry
 * 
 * Manages dynamic loading and configuration of AI models (neurons).
 * Provides LRU-cached config loading, tier-based access control, and provider factory.
 * 
 * Key Features:
 * - Per-user model instantiation (no shared state)
 * - LRU cache for configs (5min TTL)
 * - No model instance pooling (create fresh per call)
 * - Tier-based access validation
 * - Multiple provider support (Ollama, OpenAI, Anthropic, Google, custom)
 */

import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LRUCache } from "lru-cache";
import { createDecipheriv, createHash } from "crypto";
import { getDatabase, DatabaseManager } from "../memory/database";
import Neuron from "../models/Neuron";
import { NeuronConfig, NeuronDocument } from "../types/neuron";
import { createLogger } from "../utils/logger";
import type { RedConfig } from "../../index";

const log = createLogger('NeuronRegistry');

/**
 * Custom error classes for neuron operations
 */
export class NeuronNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeuronNotFoundError';
  }
}

export class NeuronAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeuronAccessDeniedError';
  }
}

export class NeuronProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeuronProviderError';
  }
}

/**
 * Runtime overrides that can be applied per-invocation
 * These override the neuron's stored configuration
 */
export interface ModelOverrides {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

/**
 * NeuronRegistry - Dynamic model loading and management
 */
export class NeuronRegistry {
  private configCache: LRUCache<string, NeuronConfig>;
  private db: DatabaseManager;
  private config: RedConfig;
  
  constructor(config: RedConfig) {
    this.config = config;
    // Use shared database singleton instead of creating a new instance
    this.db = getDatabase(config.databaseUrl);
    
    // LRU cache for neuron configs (5 minute TTL)
    this.configCache = new LRUCache<string, NeuronConfig>({
      max: 100,
      ttl: 5 * 60 * 1000, // 5 minutes
    });
  }
  
  /**
   * Initialize the registry (connect to database)
   */
  async initialize(): Promise<void> {
    await this.db.connect();
    log.info(' Initialized successfully');
  }
  
  /**
   * Get a configured model instance for the given neuron and user.
   * Creates a new instance every time (no pooling).
   * 
   * @param neuronId The neuron identifier (e.g., "red-neuron", "red-smart")
   * @param userId The requesting user's ID
   * @param overrides Optional runtime overrides for temperature, maxTokens, etc.
   * @returns Configured LangChain chat model
   * @throws NeuronNotFoundError if neuron doesn't exist
   * @throws NeuronAccessDeniedError if user lacks permission
   * @throws NeuronProviderError if model creation fails
   */
  async getModel(neuronId: string, userId: string, overrides?: ModelOverrides): Promise<BaseChatModel> {
    // Load config (cached)
    const config = await this.getConfig(neuronId, userId);
    
    // Apply runtime overrides if provided
    const effectiveConfig = overrides ? {
      ...config,
      temperature: overrides.temperature ?? config.temperature,
      maxTokens: overrides.maxTokens ?? config.maxTokens,
      topP: overrides.topP ?? config.topP
    } : config;
    
    // Validate access permissions
    await this.validateAccess(config, userId);
    
    // Create model instance with error handling
    try {
      return this.createModel(effectiveConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new NeuronProviderError(
        `Failed to create model for neuron '${neuronId}' (provider: ${config.provider}): ${errorMessage}`
      );
    }
  }
  
  /**
   * Load neuron configuration (with LRU caching)
   * 
   * @param neuronId The neuron identifier
   * @param userId The requesting user's ID
   * @returns Neuron configuration
   * @throws NeuronNotFoundError if neuron doesn't exist
   */
  async getConfig(neuronId: string, userId: string): Promise<NeuronConfig> {
    const cacheKey = `${userId}:${neuronId}`;
    
    // Check cache first
    let config = this.configCache.get(cacheKey);
    if (config) {
      return config;
    }
    
    // Query MongoDB - find neuron owned by user OR system
    const doc = await Neuron.findOne({
      neuronId,
      $or: [
        { userId: userId },      // User's custom neuron
        { userId: 'system' }     // System default
      ]
    });
    
    if (!doc) {
      throw new NeuronNotFoundError(`Neuron '${neuronId}' not found`);
    }
    
    // Convert MongoDB document to runtime config
    config = {
      id: doc.neuronId,
      name: doc.name,
      provider: doc.provider,
      endpoint: doc.endpoint,
      model: doc.model,
      apiKey: doc.apiKey ? this.decryptApiKey(doc.apiKey) : undefined,
      temperature: doc.temperature,
      maxTokens: doc.maxTokens,
      topP: doc.topP,
      role: doc.role,
      tier: doc.tier,
      userId: doc.userId
    };
    
    // Cache it
    this.configCache.set(cacheKey, config);
    
    return config;
  }
  
  /**
   * Create model instance from config (provider factory)
   * 
   * @param config Neuron configuration
   * @returns Configured LangChain chat model
   * @throws NeuronProviderError if provider is unknown
   */
  private createModel(config: NeuronConfig): BaseChatModel {
    switch (config.provider) {
      case 'ollama':
        return new ChatOllama({
          baseUrl: config.endpoint,
          model: config.model,
          temperature: config.temperature ?? 0.0,
          numCtx: config.maxTokens,
          topP: config.topP,
          keepAlive: -1 // Keep models loaded
        });
        
      case 'openai':
        return new ChatOpenAI({
          modelName: config.model,
          temperature: config.temperature ?? 0.0,
          maxTokens: config.maxTokens,
          topP: config.topP,
          apiKey: config.apiKey,
          configuration: {
            baseURL: config.endpoint
          }
        });
        
      case 'anthropic':
        return new ChatAnthropic({
          model: config.model,
          temperature: config.temperature ?? 0.0,
          maxTokens: config.maxTokens,
          topP: config.topP,
          apiKey: config.apiKey,
          clientOptions: {
            baseURL: config.endpoint
          }
        });
        
      case 'google':
        return new ChatGoogleGenerativeAI({
          model: config.model,
          temperature: config.temperature ?? 0.0,
          maxOutputTokens: config.maxTokens,
          topP: config.topP,
          apiKey: config.apiKey
        });
        
      case 'custom':
        // Generic OpenAI-compatible endpoint
        return new ChatOpenAI({
          modelName: config.model,
          temperature: config.temperature ?? 0.0,
          maxTokens: config.maxTokens,
          topP: config.topP,
          apiKey: config.apiKey || 'not-needed',
          configuration: {
            baseURL: config.endpoint
          }
        });
        
      default:
        throw new NeuronProviderError(`Unknown provider: ${config.provider}`);
    }
  }
  
  /**
   * Validate user has permission to use this neuron
   * 
   * Rules:
   * - Users can always access their own neurons
   * - System neurons require sufficient tier (lower number = higher tier)
   * - Other users' neurons are private
   * 
   * @param config Neuron configuration
   * @param userId Requesting user's ID
   * @throws NeuronAccessDeniedError if access denied
   */
  private async validateAccess(config: NeuronConfig, userId: string): Promise<void> {
    // Users can always access their own neurons
    if (config.userId === userId) {
      return;
    }
    
    // For system neurons, check tier requirement
    if (config.userId === 'system') {
      const userTier = await this.getUserTier(userId);
      
      // Lower tier number = higher access level
      // ADMIN=0 > ENTERPRISE=1 > PRO=2 > BASIC=3 > FREE=4
      if (userTier > config.tier) {
        throw new NeuronAccessDeniedError(
          `Neuron '${config.id}' requires tier ${config.tier} or higher (user has tier ${userTier})`
        );
      }
      return;
    }
    
    // Other users' neurons are not accessible
    throw new NeuronAccessDeniedError(`Neuron '${config.id}' is private`);
  }
  
  /**
   * Get user's account tier
   * 
   * @param userId User ID
   * @returns AccountLevel number (0=ADMIN, 1=ENTERPRISE, 2=PRO, 3=BASIC, 4=FREE)
   */
  private async getUserTier(userId: string): Promise<number> {
    // TODO: Implement proper tier lookup via API or shared database manager
    // For Phase 1, default to FREE tier (allows system neurons only)
    // Phase 2 will integrate with User model for proper tier-based neuron access
    return 4; // FREE tier - grants access to system neurons
  }
  
  /**
   * Get all neurons accessible by user
   * 
   * @param userId User ID
   * @returns Array of neuron configs (without API keys)
   */
  async getUserNeurons(userId: string): Promise<NeuronConfig[]> {
    const userTier = await this.getUserTier(userId);
    
    const docs = await Neuron.find({
      $or: [
        { userId: userId },                          // User's custom neurons
        { userId: 'system', tier: { $gte: userTier } } // System neurons user can access
      ]
    }).sort({ tier: 1, neuronId: 1 }); // Sort by tier (highest first), then name
    
    return docs.map((doc: NeuronDocument) => ({
      id: doc.neuronId,
      name: doc.name,
      provider: doc.provider,
      endpoint: doc.endpoint,
      model: doc.model,
      apiKey: undefined, // Never expose API keys in list
      temperature: doc.temperature,
      maxTokens: doc.maxTokens,
      topP: doc.topP,
      role: doc.role,
      tier: doc.tier,
      userId: doc.userId
    }));
  }
  
  /**
   * Invalidate cache (call after neuron updates)
   * 
   * @param userId If provided, clear only this user's cache. Otherwise clear all.
   */
  async clearCache(userId?: string): Promise<void> {
    if (userId) {
      // Clear specific user's cache (collect keys first to avoid iterator invalidation)
      const keysToDelete: string[] = [];
      for (const key of this.configCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.configCache.delete(key));
      log.info(`Cleared ${keysToDelete.length} cache entries for user ${userId}`);
    } else {
      // Clear all
      this.configCache.clear();
      log.info('Cleared entire cache');
    }
  }
  
  /**
   * Decrypt API key using AES-256-GCM
   * Compatible with webapp's encryption format (iv:authTag:ciphertext)
   * 
   * @param encrypted Encrypted API key from database
   * @returns Decrypted API key
   */
  private decryptApiKey(encrypted: string): string {
    if (!encrypted) return '';
    
    // Check if value is encrypted (contains format separator)
    if (!encrypted.includes(':')) {
      // Not encrypted, return as-is (backward compatibility)
      return encrypted;
    }
    
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      // Invalid format, return as-is
      return encrypted;
    }
    
    const [ivBase64, authTagBase64, ciphertext] = parts;
    
    try {
      // Get encryption key from environment (same source as webapp)
      const keySource = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
      if (!keySource) {
        log.warn(' No encryption key available, returning encrypted value');
        return encrypted;
      }
      
      const key = createHash('sha256').update(keySource).digest();
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');
      
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      // Decryption failed - might be unencrypted legacy data
      log.warn(' Failed to decrypt API key, returning as-is');
      return encrypted;
    }
  }
  
  /**
   * Shutdown the registry (disconnect from database)
   */
  async shutdown(): Promise<void> {
    await this.db.close();
    this.configCache.clear();
    log.info(' Shutdown complete');
  }
}

// Export custom errors
export { NeuronConfig, NeuronDocument } from "../types/neuron";
