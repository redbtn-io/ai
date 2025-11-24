/**
 * Graph System Type Definitions
 * 
 * Phase 1: Dynamic Graph System
 * These types define the structure for storing and compiling graph configurations.
 */

/**
 * Supported graph node types
 * Maps to implementation functions in nodeRegistry.ts
 */
export enum GraphNodeType {
  PRECHECK = 'precheck',
  FASTPATH = 'fastpath',
  CONTEXT = 'context',
  CLASSIFIER = 'classifier',
  ROUTER = 'router',
  PLANNER = 'planner',
  EXECUTOR = 'executor',
  RESPONDER = 'responder',
  SEARCH = 'search',
  SCRAPE = 'scrape',
  COMMAND = 'command',
  UNIVERSAL = 'universal'
}

/**
 * System default graph IDs (Phase 2: Dynamic Graph System)
 * Default graphs are stored with userId: 'system' and isDefault: true in MongoDB
 * These constants provide convenient access to system default graph IDs
 */
export const SYSTEM_TEMPLATES = {
  SIMPLE: 'red-chat',
  DEFAULT: 'red-assistant',
  // Future system graphs:
  // RESEARCH: 'research-assistant',
  // AUTOMATION: 'automation-agent',
  // ENTERPRISE: 'enterprise-workflow'
} as const;

export type SystemTemplateId = typeof SYSTEM_TEMPLATES[keyof typeof SYSTEM_TEMPLATES];

/**
 * Node definition in graph configuration
 */
export interface GraphNodeConfig {
  /** Unique node identifier within the graph (e.g., "classifier", "responder") */
  id: string;
  
  /** Node type - maps to implementation function via NODE_REGISTRY */
  type: GraphNodeType;
  
  /** Optional neuron override for this specific node (null = use user default) */
  neuronId?: string | null;
  
  /** Node-specific configuration options */
  config?: Record<string, any>;
}

/**
 * Edge definition in graph configuration
 * Can be either simple (direct connection) or conditional (branching logic)
 */
export interface GraphEdgeConfig {
  /** Source node ID or "__start__" */
  from: string;
  
  /** Target node ID or "__end__" (for simple edges) */
  to?: string;
  
  /** Optional condition expression for conditional edges */
  condition?: string;
  
  /** For conditional edges: map of condition results to target node IDs */
  targets?: Record<string, string>;
  
  /** Default target if condition evaluates false or undefined */
  fallback?: string;
}

/**
 * Graph-level configuration options
 */
export interface GraphGlobalConfig {
  /** Maximum number of planner replans allowed (default: 3) */
  maxReplans?: number;
  
  /** Maximum search loop iterations (default: 5) */
  maxSearchIterations?: number;
  
  /** Maximum execution time in seconds (default: 300) */
  timeout?: number;
  
  /** Enable precheck node for pattern matching (default: true) */
  enableFastpath?: boolean;
  
  /** Default neuron role for nodes without specific assignment */
  defaultNeuronRole?: 'chat' | 'worker' | 'specialist';
}

/**
 * Complete graph configuration (stored in MongoDB)
 * This is the authoritative source for graph structure and behavior
 */
export interface GraphConfig {
  /** Unique graph identifier (e.g., "red-graph-default", "user_123_custom") */
  graphId: string;
  
  /** Owner user ID: "system" for defaults, user ID for custom graphs */
  userId: string;
  
  /** True for system-provided template graphs */
  isDefault: boolean;
  
  /** Display name for UI presentation */
  name: string;
  
  /** User-facing description of graph purpose */
  description?: string;
  
  /** Minimum account tier required (AccountLevel enum value) */
  tier: number;
  
  /** Semantic version for graph updates (default: "1.0.0") */
  version?: string;
  
  // Graph structure
  
  /** All nodes in the graph */
  nodes: GraphNodeConfig[];
  
  /** All edges (simple and conditional) */
  edges: GraphEdgeConfig[];
  
  // Configuration
  
  /** Per-node neuron assignments (nodeId → neuronId) */
  neuronAssignments?: Record<string, string>;
  
  /** Graph-level configuration options */
  config?: GraphGlobalConfig;
  
  // Metadata
  
  /** Creation timestamp */
  createdAt?: Date;
  
  /** Last update timestamp */
  updatedAt?: Date;
  
  /** Number of times this graph has been executed */
  usageCount?: number;
}

/**
 * Compiled graph result (runtime representation)
 * Returned by GraphRegistry after JIT compilation
 */
export interface CompiledGraph {
  /** Graph identifier */
  graphId: string;
  
  /** Original configuration */
  config: GraphConfig;
  
  /** Compiled LangGraph StateGraph instance */
  graph: any; // LangGraph CompiledStateGraph (any to avoid import)
  
  /** Timestamp when graph was compiled */
  compiledAt: Date;
}

/**
 * Type guard to check if a string is a valid GraphNodeType
 */
export function isGraphNodeType(value: string): value is GraphNodeType {
  return Object.values(GraphNodeType).includes(value as GraphNodeType);
}

/**
 * Type guard to check if a string is a valid system template ID
 */
export function isSystemTemplate(value: string): value is SystemTemplateId {
  return Object.values(SYSTEM_TEMPLATES).includes(value as SystemTemplateId);
}
