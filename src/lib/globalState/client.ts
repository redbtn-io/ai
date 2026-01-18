/**
 * Global State Client for AI Library
 * 
 * Provides access to persistent global state that can be shared across
 * workflow executions. This enables workflows to read and write values
 * that persist beyond a single run.
 * 
 * Usage in templates:
 * - {{globalState.myNamespace.myKey}}
 * 
 * Usage in code:
 * - globalStateClient.getValue('myNamespace', 'myKey')
 * - globalStateClient.setValue('myNamespace', 'myKey', value)
 */

interface GlobalStateValue {
  key: string;
  value: any;
  valueType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  expiresAt?: Date;
  lastModifiedAt: Date;
  lastModifiedBy?: string;
  accessCount: number;
  lastAccessedAt?: Date;
}

interface GlobalStateNamespace {
  namespace: string;
  entries: GlobalStateValue[];
  keyCount: number;
}

interface GlobalStateClientOptions {
  /** Base URL for the API (e.g., http://localhost:3000) */
  baseUrl?: string;
  /** User ID for access control */
  userId?: string;
  /** Authorization header value */
  authToken?: string;
  /** Workflow/graph ID for tracking modifications */
  workflowId?: string;
  /** Internal service key for service-to-service authentication */
  internalKey?: string;
}

/**
 * Global State Client
 * 
 * Provides methods to interact with the global state API for reading
 * and writing persistent values across workflow executions.
 */
export class GlobalStateClient {
  private baseUrl: string;
  private userId?: string;
  private authToken?: string;
  private workflowId?: string;
  private internalKey?: string;
  private cache: Map<string, { value: any; timestamp: number }> = new Map();
  private cacheTTLMs = 5000; // 5 second cache for reads

  constructor(options: GlobalStateClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.WEBAPP_URL || 'http://localhost:3000';
    this.userId = options.userId;
    this.authToken = options.authToken;
    this.workflowId = options.workflowId;
    // Get internal service key from options or environment
    this.internalKey = options.internalKey || process.env.INTERNAL_SERVICE_KEY;
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    
    // For internal service calls, send both userId and internal key
    if (this.userId) {
      headers['X-User-Id'] = this.userId;
    }
    
    if (this.internalKey) {
      headers['X-Internal-Key'] = this.internalKey;
    }
    
    return headers;
  }

  /**
   * Get a value from global state
   * 
   * @param namespace - Namespace name
   * @param key - Key within the namespace
   * @returns The value, or undefined if not found
   */
  async getValue(namespace: string, key: string): Promise<any> {
    // Check cache first
    const cacheKey = `${namespace}.${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTLMs) {
      return cached.value;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/state/namespaces/${namespace}/values/${key}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return undefined;
        }
        throw new Error(`Failed to get global state value: ${response.statusText}`);
      }

      const data = await response.json();
      const value = data.value;
      
      // Update cache
      this.cache.set(cacheKey, { value, timestamp: Date.now() });
      
      return value;
    } catch (error) {
      console.error(`[GlobalStateClient] Error getting ${namespace}.${key}:`, error);
      return undefined;
    }
  }

  /**
   * Get all values from a namespace
   * 
   * @param namespace - Namespace name
   * @returns Object with all key-value pairs
   */
  async getNamespaceValues(namespace: string): Promise<Record<string, any>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/state/namespaces/${namespace}/values`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return {};
        }
        throw new Error(`Failed to get namespace values: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Update cache for all values
      for (const [key, value] of Object.entries(data.values || {})) {
        this.cache.set(`${namespace}.${key}`, { value, timestamp: Date.now() });
      }
      
      return data.values || {};
    } catch (error) {
      console.error(`[GlobalStateClient] Error getting namespace ${namespace}:`, error);
      return {};
    }
  }

  /**
   * Set a value in global state
   * 
   * @param namespace - Namespace name (will be created if doesn't exist)
   * @param key - Key within the namespace
   * @param value - Value to store
   * @param options - Additional options (description, TTL)
   * @returns Success boolean
   */
  async setValue(
    namespace: string,
    key: string,
    value: any,
    options?: { description?: string; ttlSeconds?: number }
  ): Promise<boolean> {
    try {
      // Determine the modifier based on context
      const modifiedBy = this.workflowId 
        ? `workflow:${this.workflowId}` 
        : 'system';

      const response = await fetch(
        `${this.baseUrl}/api/v1/state/namespaces/${namespace}/values`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            key,
            value,
            description: options?.description,
            ttlSeconds: options?.ttlSeconds,
            modifiedBy,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Failed to set value: ${response.statusText}`);
      }

      // Update cache
      this.cache.set(`${namespace}.${key}`, { value, timestamp: Date.now() });
      
      return true;
    } catch (error) {
      console.error(`[GlobalStateClient] Error setting ${namespace}.${key}:`, error);
      return false;
    }
  }

  /**
   * Delete a value from global state
   * 
   * @param namespace - Namespace name
   * @param key - Key to delete
   * @returns Success boolean
   */
  async deleteValue(namespace: string, key: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/state/namespaces/${namespace}/values/${key}`,
        {
          method: 'DELETE',
          headers: this.getHeaders(),
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete value: ${response.statusText}`);
      }

      // Remove from cache
      this.cache.delete(`${namespace}.${key}`);
      
      return true;
    } catch (error) {
      console.error(`[GlobalStateClient] Error deleting ${namespace}.${key}:`, error);
      return false;
    }
  }

  /**
   * Clear the value cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Pre-fetch a namespace's values into cache
   * 
   * Useful before template rendering to ensure all values are available.
   * 
   * @param namespace - Namespace to prefetch
   */
  async prefetch(namespace: string): Promise<void> {
    await this.getNamespaceValues(namespace);
  }

  /**
   * Resolve a globalState reference from template
   * 
   * Used by template renderer for {{globalState.namespace.key}} syntax.
   * 
   * @param path - Path after globalState. (e.g., "myNamespace.myKey")
   * @returns The resolved value or undefined
   */
  async resolveTemplatePath(path: string): Promise<any> {
    const parts = path.split('.');
    if (parts.length < 2) {
      console.warn(`[GlobalStateClient] Invalid globalState path: ${path}`);
      return undefined;
    }
    
    const [namespace, ...keyParts] = parts;
    const key = keyParts[0];
    
    const value = await this.getValue(namespace, key);
    
    // Handle nested property access within the value
    if (keyParts.length > 1 && value !== undefined && typeof value === 'object') {
      return keyParts.slice(1).reduce((obj, k) => obj?.[k], value);
    }
    
    return value;
  }
}

// Default singleton instance
let defaultClient: GlobalStateClient | null = null;

/**
 * Get or create the default GlobalStateClient instance
 */
export function getGlobalStateClient(options?: GlobalStateClientOptions): GlobalStateClient {
  if (!defaultClient || options) {
    defaultClient = new GlobalStateClient(options);
  }
  return defaultClient;
}

/**
 * Quick access to get a global state value
 */
export async function getGlobalValue(namespace: string, key: string): Promise<any> {
  return getGlobalStateClient().getValue(namespace, key);
}

/**
 * Quick access to set a global state value
 */
export async function setGlobalValue(
  namespace: string, 
  key: string, 
  value: any,
  options?: { description?: string; ttlSeconds?: number }
): Promise<boolean> {
  return getGlobalStateClient().setValue(namespace, key, value, options);
}
