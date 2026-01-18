/**
 * Unified Tool Event Protocol
 * 
 * Standardized event format for all tool executions (thinking, web search, 
 * database queries, code execution, etc.). Tools publish these events to 
 * Redis pub/sub for real-time client updates.
 */

export type ToolEventType = 
  | 'tool_start'      // Tool execution begins
  | 'tool_progress'   // Incremental progress update
  | 'tool_complete'   // Tool execution finished successfully
  | 'tool_error'      // Tool execution failed
  | 'graph_start'     // Graph execution begins
  | 'graph_complete'  // Graph execution finished
  | 'graph_error'     // Graph execution failed
  | 'node_start'      // Node execution begins
  | 'node_progress'   // Node step progress (e.g., thinking, calling model)
  | 'node_complete'   // Node execution finished
  | 'node_error';     // Node execution failed

export type ToolType = 
  | 'thinking'        // AI reasoning/planning
  | 'web_search'      // Web search tool
  | 'database_query'  // Database operations
  | 'code_execution'  // Code interpreter
  | 'file_operation'  // File system operations
  | 'api_call'        // External API calls
  | 'memory_retrieval'// Memory/context retrieval
  | 'custom';         // Custom tool types

/**
 * Base interface for all tool events
 */
export interface BaseToolEvent {
  type: ToolEventType;
  toolType: ToolType;
  toolName: string;           // Human-readable tool name
  toolId: string;             // Unique identifier for this tool execution
  messageId: string;          // Associated message ID
  conversationId: string;     // Associated conversation ID
  timestamp: number;          // Unix timestamp in milliseconds
}

/**
 * Tool execution start event
 */
export interface ToolStartEvent extends BaseToolEvent {
  type: 'tool_start';
  metadata?: {
    input?: any;              // Tool input parameters (sanitized)
    expectedDuration?: number; // Estimated duration in ms
    [key: string]: any;
  };
}

/**
 * Progress update during tool execution
 */
export interface ToolProgressEvent extends BaseToolEvent {
  type: 'tool_progress';
  step: string;               // Current step description
  progress?: number;          // Optional progress percentage (0-100)
  data?: any;                 // Step-specific data to display
  streamingContent?: string;  // For streaming text output (like thinking)
}

/**
 * Tool execution completion event
 */
export interface ToolCompleteEvent extends BaseToolEvent {
  type: 'tool_complete';
  result?: any;               // Final result (sanitized)
  metadata?: {
    tokensUsed?: number;
    sitesSearched?: number;
    recordsQueried?: number;
    [key: string]: any;
  };
}

/**
 * Tool execution error event
 */
export interface ToolErrorEvent extends BaseToolEvent {
  type: 'tool_error';
  error: string;              // Error message
  errorCode?: string;         // Optional error code
}

/**
 * Union type of all tool events
 */
export type ToolEvent = 
  | ToolStartEvent 
  | ToolProgressEvent 
  | ToolCompleteEvent 
  | ToolErrorEvent;

/**
 * Helper to create tool event IDs
 */
export const createToolId = (toolType: ToolType, messageId: string): string => {
  return `${toolType}_${messageId}_${Date.now()}`;
};

// ============================================================================
// Graph & Node Events (for visual graph viewer)
// ============================================================================

/**
 * Graph execution start event
 */
export interface GraphStartEvent {
  type: 'graph_start';
  graphId: string;            // Graph ID
  graphName: string;          // Graph name
  messageId: string;          // Associated message ID
  conversationId: string;     // Associated conversation ID
  runId: string;              // Unique run ID
  timestamp: number;
  nodeCount: number;          // Total nodes in graph
  entryNodeId: string;        // Starting node ID
}

/**
 * Graph execution complete event
 */
export interface GraphCompleteEvent {
  type: 'graph_complete';
  graphId: string;
  runId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  exitNodeId?: string;        // Final node executed
  totalDuration: number;      // Total execution time in ms
  nodesExecuted: number;      // Number of nodes executed
}

/**
 * Graph execution error event
 */
export interface GraphErrorEvent {
  type: 'graph_error';
  graphId: string;
  runId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  error: string;
  failedNodeId?: string;
}

/**
 * Node execution start event
 */
export interface NodeStartEvent {
  type: 'node_start';
  graphId: string;
  runId: string;
  nodeId: string;
  nodeType: string;           // e.g., 'neuron', 'router', 'planner'
  nodeName: string;           // Human-readable name
  messageId: string;
  conversationId: string;
  timestamp: number;
}

/**
 * Node step progress event
 */
export interface NodeProgressEvent {
  type: 'node_progress';
  graphId: string;
  runId: string;
  nodeId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  stepName: string;           // e.g., 'building_prompt', 'calling_model', 'parsing_output'
  stepIndex?: number;         // Optional step index
  totalSteps?: number;        // Optional total steps
  data?: any;                 // Step-specific data
}

/**
 * Node execution complete event
 */
export interface NodeCompleteEvent {
  type: 'node_complete';
  graphId: string;
  runId: string;
  nodeId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  duration: number;           // Execution time in ms
  nextNodeId?: string;        // Next node in the chain (if any)
  output?: any;               // Sanitized output (optional)
}

/**
 * Node execution error event
 */
export interface NodeErrorEvent {
  type: 'node_error';
  graphId: string;
  runId: string;
  nodeId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  error: string;
  willRetry?: boolean;
  retryCount?: number;
}

/**
 * Union type of all graph/node events
 */
export type GraphEvent = 
  | GraphStartEvent 
  | GraphCompleteEvent 
  | GraphErrorEvent
  | NodeStartEvent
  | NodeProgressEvent
  | NodeCompleteEvent
  | NodeErrorEvent;
