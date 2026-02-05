import { Annotation } from "@langchain/langgraph";

/**
 * 1. Define the State using Annotation
 * This is the shared memory object that flows between nodes.
 */
export const RedGraphState = Annotation.Root({
  // Infrastructure components (available to all nodes)
  neuronRegistry: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  mcpClient: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  memory: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  messageQueue: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  logger: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  // NEW: RunPublisher for unified event publishing (run path)
  runPublisher: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x  // Keep existing if new is null/undefined
  }),
  // Graph event publisher for live visualization
  graphPublisher: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x  // Keep existing if new is null/undefined
  }),
  // Message ID for SSE event streaming
  messageId: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y ?? x
  }),
  // Graph metadata for event publishing
  graphName: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y ?? x
  }),
  graphId: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y ?? x
  }),
  // Universal Node Data - Container for all node-specific dynamic data
  // Use this for ANY data that is specific to a node/feature and not truly generic
  // Examples: executionPlan, currentStep, searchResults, routingDecision, etc.
  data: Annotation<Record<string, any>>({
    reducer: (x: Record<string, any>, y: Record<string, any>) => {
      // Deep merge nested objects so data.executionPlan + data.hasPlan don't overwrite each other
      return deepMergeData(x, y);
    },
    default: () => ({})
  }),
  // MCP Registry for universal nodes (Phase 2: Tool execution from config)
  mcpRegistry: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  // Node execution counter for system prompts
  nodeCounter: Annotation<number>({
    reducer: (x: number, y: number) => y,
    default: () => 1
  })
});

/**
 * Deep merge for data field reducer
 * Recursively merges nested objects to preserve all nested fields
 */
function deepMergeData(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const sourceKeys = Object.keys(source || {});
  if (sourceKeys.includes('messages') || sourceKeys.includes('contextMessages')) {
    console.log('[DataReducer] MESSAGES DETECTED! Deep merging data:', {
      targetKeys: Object.keys(target || {}),
      sourceKeys: sourceKeys,
      messagesType: Array.isArray(source?.messages) ? 'array' : typeof source?.messages
    });
  }
  
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    // For messages: REPLACE rather than concat to prevent duplication
    // Messages are built fresh by context node, not incrementally added
    if (key === 'messages' && Array.isArray(source[key])) {
      result[key] = source[key]; // Replace, don't concat
    } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Recursively merge nested objects
      result[key] = deepMergeData(result[key] || {}, source[key]);
    } else {
      // Directly assign primitives, arrays, and null values
      result[key] = source[key];
    }
  }
  
  const resultKeys = Object.keys(result);
  if (resultKeys.includes('messages') || resultKeys.includes('contextMessages')) {
    console.log('[DataReducer] MESSAGES IN RESULT! Merge result keys:', resultKeys);
  }
  
  return result;
}

export type RedGraphStateType = typeof RedGraphState.State;
