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
  // console.log('[DataReducer] Deep merging data:', {
  //   targetKeys: Object.keys(target || {}),
  //   sourceKeys: Object.keys(source || {}),
  //   targetExecutorFlag: target?.executorAwaitingReturn,
  //   sourceExecutorFlag: source?.executorAwaitingReturn
  // });
  
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    if (key === 'messages' && Array.isArray(source[key]) && Array.isArray(result[key])) {
      // Special handling for messages: concat
      result[key] = result[key].concat(source[key]);
    } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Recursively merge nested objects
      result[key] = deepMergeData(result[key] || {}, source[key]);
    } else {
      // Directly assign primitives, arrays, and null values
      result[key] = source[key];
    }
  }
  
  // console.log('[DataReducer] Merge result keys:', Object.keys(result), 'executorFlag:', result.executorAwaitingReturn);
  
  return result;
}

export type RedGraphStateType = typeof RedGraphState.State;
