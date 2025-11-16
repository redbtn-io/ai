/**
 * Neuron Type Definitions
 * 
 * Defines the types and interfaces for the Neuron system.
 * Neurons are configurable LLM endpoints that can be dynamically loaded per-user.
 */

/**
 * Supported LLM providers
 */
export type NeuronProvider = 'ollama' | 'openai' | 'anthropic' | 'google' | 'custom';

/**
 * Neuron role categorization (for UI organization)
 */
export type NeuronRole = 'chat' | 'worker' | 'specialist';

/**
 * Runtime neuron configuration
 * Used internally by NeuronRegistry when creating model instances
 */
export interface NeuronConfig {
  id: string;                    // Unique identifier (e.g., "red-neuron", "user123-gpt4o")
  name: string;                  // Display name
  description?: string;          // User-facing description
  provider: NeuronProvider;      // LLM provider
  endpoint: string;              // API base URL
  model: string;                 // Model identifier
  apiKey?: string;               // Decrypted API key (never stored, runtime only)
  temperature?: number;          // Temperature parameter (default: 0.0)
  maxTokens?: number;            // Optional max output tokens
  topP?: number;                 // Optional nucleus sampling
  role: NeuronRole;              // Role categorization
  tier: number;                  // Minimum AccountLevel required to use
  userId?: string;               // Owner ("system" for defaults, user ID for custom)
}

/**
 * MongoDB document interface for neurons collection
 */
export interface NeuronDocument {
  _id?: any;                     // MongoDB ObjectId
  neuronId: string;              // Unique identifier (indexed)
  userId: string;                // Owner ("system" for defaults)
  isDefault: boolean;            // true for system defaults
  name: string;                  // Display name
  description?: string;          // User-facing description
  provider: NeuronProvider;      // LLM provider
  endpoint: string;              // API base URL
  model: string;                 // Model identifier
  apiKey?: string;               // ENCRYPTED API key (or null for Ollama)
  temperature: number;           // Temperature (default: 0.0)
  maxTokens?: number;            // Optional max output tokens
  topP?: number;                 // Optional nucleus sampling
  role: NeuronRole;              // Role categorization
  tier: number;                  // Minimum AccountLevel required
  createdAt: Date;               // Creation timestamp
  updatedAt: Date;               // Last update timestamp
  usageCount?: number;           // Track usage (future)
  lastUsedAt?: Date;             // Last usage timestamp (future)
}
