import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { InvokeOptions } from '../../index';
import { routerNode } from "../nodes/router";
import { plannerNode } from "../nodes/planner";
import { executorNode } from "../nodes/executor";
import { respondNode } from "../nodes/respond";
import { searchNode } from "../nodes/search";
import { scrapeNode } from "../nodes/scrape";
import { commandNode } from "../nodes/command";
import type { ExecutionPlan } from "../nodes/planner";

/**
 * 1. Define the State using Annotation
 * This is the shared memory object that flows between nodes.
 */
const RedGraphState = Annotation.Root({
  query: Annotation<object>({
    reducer: (x: object, y: object) => y,
    default: () => ({})
  }),
  options: Annotation<InvokeOptions>({
    reducer: (x: InvokeOptions, y: InvokeOptions) => y,
    default: () => ({})
  }),
  // Per-user context annotations (Phase 0: Neuron System)
  userId: Annotation<string>({
    reducer: (x: string, y: string) => y,
    default: () => ''
  }),
  accountTier: Annotation<number>({
    reducer: (x: number, y: number) => y,
    default: () => 4 // FREE tier
  }),
  neuronRegistry: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  defaultNeuronId: Annotation<string>({
    reducer: (x: string, y: string) => y,
    default: () => 'red-neuron'
  }),
  defaultWorkerNeuronId: Annotation<string>({
    reducer: (x: string, y: string) => y,
    default: () => 'red-neuron'
  }),
  // Infrastructure components (available to all nodes)
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
  // Messages array that accumulates throughout the tool calling loop
  messages: Annotation<any[]>({
    reducer: (x: any[], y: any[]) => x.concat(y),
    default: () => []
  }),
  // Response contains the full AIMessage object with content, tokens, and metadata
  response: Annotation<any>({
    reducer: (x: any, y: any) => y
  }),
  nextGraph: Annotation<'homeGraph' | 'assistantGraph' | 'responder' | 'search' | 'scrape' | 'command' | undefined>({
    reducer: (x, y) => y,
    default: () => undefined
  }),
  // messageId for linking to Redis pub/sub and event publishing
  messageId: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y
  }),
  // finalResponse indicates a node has generated the complete answer (skip responder LLM call)
  finalResponse: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y
  }),
  // searchIterations tracks how many times search node has looped
  searchIterations: Annotation<number>({
    reducer: (x: number, y: number) => y,
    default: () => 0
  }),
  // toolParam allows passing parameters between nodes (e.g., refined search query)
  toolParam: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y
  }),
  // contextMessages holds the conversation history loaded once by context node
  contextMessages: Annotation<any[]>({
    reducer: (x: any[], y: any[]) => y,
    default: () => []
  }),
  // contextSummary stores the executive summary for quick prompting
  contextSummary: Annotation<string>({
    reducer: (x: string, y: string) => y,
    default: () => ''
  }),
  // contextLoaded ensures the context node only runs once per invocation
  contextLoaded: Annotation<boolean>({
    reducer: (x: boolean, y: boolean) => y,
    default: () => false
  }),
  // nodeNumber tracks current position in the graph (1st, 2nd, 3rd node, etc.)
  nodeNumber: Annotation<number>({
    reducer: (x: number, y: number) => y, // Each node can override
    default: () => 1 // Start at 1 (planner/router)
  }),
  // THREE-TIER ARCHITECTURE FIELDS
  // Precheck (Tier 0: Pattern matching)
  precheckDecision: Annotation<'fastpath' | 'router' | undefined>({
    reducer: (x: any, y: any) => y,
    default: () => undefined
  }),
  precheckMatch: Annotation<any | undefined>({
    reducer: (x: any, y: any) => y,
    default: () => undefined
  }),
  precheckReason: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
  }),
  // Fastpath execution
  fastpathTool: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
  }),
  fastpathServer: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
  }),
  fastpathParameters: Annotation<Record<string, string> | undefined>({
    reducer: (x: any, y: any) => y,
    default: () => undefined
  }),
  fastpathSuccess: Annotation<boolean | undefined>({
    reducer: (x: boolean | undefined, y: boolean | undefined) => y,
    default: () => undefined
  }),
  fastpathResult: Annotation<any | undefined>({
    reducer: (x: any, y: any) => y,
    default: () => undefined
  }),
  fastpathError: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
  }),
  fastpathMessage: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
  }),
  fastpathComplete: Annotation<boolean | undefined>({
    reducer: (x: boolean | undefined, y: boolean | undefined) => y,
    default: () => undefined
  }),
  // Classifier (Tier 1: Fast LLM routing)
  routerDecision: Annotation<'direct' | 'plan' | undefined>({
    reducer: (x: any, y: any) => y,
    default: () => undefined
  }),
  routerReason: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
  }),
  routerConfidence: Annotation<number | undefined>({
    reducer: (x: number | undefined, y: number | undefined) => y,
    default: () => undefined
  }),
  // Universal Node Dynamic Fields (Phase 2.5: Flat state refactoring)
  // routeDecision is set by router node for conditional edges
  routeDecision: Annotation<string | undefined>({
    reducer: (x: string | undefined, y: string | undefined) => y,
    default: () => undefined
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
  })
});

/**
 * Deep merge for data field reducer
 * Recursively merges nested objects to preserve all nested fields
 */
function deepMergeData(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  console.log('[DataReducer] Deep merging data:', {
    targetKeys: Object.keys(target || {}),
    sourceKeys: Object.keys(source || {}),
    targetExecutorFlag: target?.executorAwaitingReturn,
    sourceExecutorFlag: source?.executorAwaitingReturn
  });
  
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Recursively merge nested objects
      result[key] = deepMergeData(result[key] || {}, source[key]);
    } else {
      // Directly assign primitives, arrays, and null values
      result[key] = source[key];
    }
  }
  
  console.log('[DataReducer] Merge result keys:', Object.keys(result), 'executorFlag:', result.executorAwaitingReturn);
  
  return result;
}

type RedGraphStateType = typeof RedGraphState.State;

// --- Graph Definitions ---

// Import new nodes
import { precheckNode } from "../nodes/precheck";
import { contextNode } from "../nodes/context";
import { classifierNode } from "../nodes/classifier";
import { fastpathExecutorNode } from "../nodes/fastpath";

// ROUTER GRAPH WITH PRECHECK + CLASSIFIER (new default)
// Flow: precheck → [fastpath_executor OR classifier] → [responder OR planner+executor loop]
//
// Step 1: Precheck (pattern matching)
//   - Match → fastpath_executor (placeholder for now, will be implemented later)
//   - No match → classifier
//
// Step 2: Classifier (fast LLM routing with bias toward planning)
//   - Direct → responder (simple questions, greetings, knowledge queries)
//   - Plan → planner (default, anything needing tools/multi-step)
//
// Step 3a: Responder path (direct answer)
//   - Generate response → END
//
// Step 3b: Planner path (complex execution)
//   - planner → executor → [search/scrape/command] → executor (loop) → responder → END
const redGraphBuilderRouter = new StateGraph(RedGraphState)
  .addNode("precheck", precheckNode)
  .addNode("fastpathExecutor", fastpathExecutorNode)  // Placeholder - to be implemented
  .addNode("contextLoader", contextNode)
  .addNode("classifier", classifierNode)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("search", searchNode)
  .addNode("scrape", scrapeNode)
  .addNode("command", commandNode)
  .addNode("respond", respondNode)
  
  // START → precheck
  .addEdge("__start__", "precheck")
  
  // PRECHECK → [fastpath_executor OR contextLoader]
  .addConditionalEdges(
    "precheck",
    (state: RedGraphStateType) => {
      if (state.precheckDecision === 'fastpath') {
        return 'fastpath';
      }
      return 'context';
    },
    {
      "fastpath": "fastpathExecutor",
      "context": "contextLoader"
    }
  )

  // CONTEXT LOADER → classifier (non-fastpath flow)
  .addEdge("contextLoader", "classifier")
  
  // FASTPATH → END (placeholder, will be expanded later)
  .addEdge("fastpathExecutor", END)
  
  // CLASSIFIER → [responder OR planner]
  .addConditionalEdges(
    "classifier",
    (state: RedGraphStateType) => {
      if (state.routerDecision === 'direct') {
        return 'responder';
      }
      return 'planner';
    },
    {
      "respond": "respond",
      "planner": "planner"
    }
  )
  
  // PLANNER → executor (always)
  .addEdge("planner", "executor")
  
  // EXECUTOR → [search/scrape/command/responder] based on current step
  .addConditionalEdges(
    "executor",
    (state: RedGraphStateType) => {
      return state.nextGraph || "respond";
    },
    {
      "search": "search",
      "scrape": "scrape",
      "command": "command",
      "respond": "respond"
    }
  )
  
  // SEARCH → [search (loop) OR executor (next step) OR END]
  .addConditionalEdges(
    "search",
    (state: RedGraphStateType) => {
      // Legacy router mode support (allows search to loop back to itself)
      if (state.nextGraph === 'search') {
        return 'search';
      }
      // Check if we have more steps to execute
      const plan = state.data?.executionPlan;
      const stepIndex = state.data?.currentStepIndex || 0;
      if (plan && stepIndex < plan.steps?.length) {
        return 'executor';
      }
      // Plan complete
      return END;
    },
    {
      "search": "search",
      "executor": "executor",
      "__end__": END
    }
  )
  
  // SCRAPE → [executor (next step) OR END]
  .addConditionalEdges(
    "scrape",
    (state: RedGraphStateType) => {
      const plan = state.data?.executionPlan;
      const stepIndex = state.data?.currentStepIndex || 0;
      if (plan && stepIndex < plan.steps?.length) {
        return 'executor';
      }
      return END;
    },
    {
      "executor": "executor",
      "__end__": END
    }
  )
  
  // COMMAND → [executor (next step) OR END]
  .addConditionalEdges(
    "command",
    (state: RedGraphStateType) => {
      const plan = state.data?.executionPlan;
      const stepIndex = state.data?.currentStepIndex || 0;
      if (plan && stepIndex < plan.steps?.length) {
        return 'executor';
      }
      return END;
    },
    {
      "executor": "executor",
      "__end__": END
    }
  )
  
  // RESPONDER → [planner (replan) OR END]
  .addConditionalEdges(
    "respond",
    (state: RedGraphStateType) => {
      // Check if responder requested replanning
      if (state.data?.requestReplan && (state.data?.replannedCount || 0) < 3) {
        return 'planner';
      }
      return END;
    },
    {
      "planner": "planner",
      "__end__": END
    }
  );

// PLANNER-BASED graph (kept for reference, but three-tier is now default)
const redGraphBuilderWithPlanner = new StateGraph(RedGraphState)
  .addNode("contextLoader", contextNode)
  .addNode("planner", plannerNode)      // Creates execution plan
  .addNode("executor", executorNode)    // Routes to appropriate step
  .addNode("search", searchNode)        // Web search node
  .addNode("scrape", scrapeNode)        // URL scraping node
  .addNode("command", commandNode)      // Command execution node
  .addNode("respond", respondNode)  // Final response generation node
  .addEdge("__start__", "contextLoader")
  .addEdge("contextLoader", "planner")
  .addConditionalEdges(
    "planner",
    (state: RedGraphStateType) => {
      // After planning, check if replanning was requested
      if (state.data?.requestReplan && (state.data?.replannedCount || 0) < 3) {
        // Exceeded max replans, go to executor anyway
        return "executor";
      }
      // Normal flow: go to executor to start executing plan
      return "executor";
    },
    {
      "executor": "executor"
    }
  )
  .addConditionalEdges(
    "executor",
    (state: RedGraphStateType) => {
      // Executor determines which specialized node to run based on current step
      return state.nextGraph || "respond";
    },
    {
      "search": "search",
      "scrape": "scrape",
      "command": "command",
      "respond": "respond"
    }
  )
  // After each specialized node, check if we need to continue execution or replan
  .addConditionalEdges(
    "search",
    (state: RedGraphStateType) => {
      // Legacy router mode support
      if (state.nextGraph === 'search') {
        return 'search';  // Old-style loop
      }
      
      // Check if we have more steps to execute
      const plan = state.data?.executionPlan;
      const stepIndex = state.data?.currentStepIndex || 0;
      if (plan && stepIndex < plan.steps?.length) {
        return 'executor';  // Continue with next step
      }
      
      // Plan complete
      return END;
    },
    {
      "search": "search",      // Legacy loop
      "executor": "executor",  // Continue plan
      "__end__": END
    }
  )
  .addConditionalEdges(
    "scrape",
    (state: RedGraphStateType) => {
      // Check if we have more steps to execute
      const plan = state.data?.executionPlan;
      const stepIndex = state.data?.currentStepIndex || 0;
      if (plan && stepIndex < plan.steps?.length) {
        return 'executor';
      }
      return END;
    },
    {
      "executor": "executor",
      "__end__": END
    }
  )
  .addConditionalEdges(
    "command",
    (state: RedGraphStateType) => {
      // Check if we have more steps to execute
      const plan = state.data?.executionPlan;
      const stepIndex = state.data?.currentStepIndex || 0;
      if (plan && stepIndex < plan.steps?.length) {
        return 'executor';
      }
      return END;
    },
    {
      "executor": "executor",
      "__end__": END
    }
  )
  .addConditionalEdges(
    "respond",
    (state: RedGraphStateType) => {
      // Check if responder requested replanning
      if (state.data?.requestReplan && (state.data?.replannedCount || 0) < 3) {
        return 'planner';  // Go back to planner for new plan
      }
      // Otherwise, we're done
      return END;
    },
    {
      "planner": "planner",
      "__end__": END
    }
  );

// LEGACY: Create ROUTER-BASED graph (old architecture, kept for backwards compatibility)
const redGraphBuilderWithRouter = new StateGraph(RedGraphState)
  .addNode("contextLoader", contextNode)
  .addNode("router", routerNode)
  .addNode("search", searchNode)
  .addNode("scrape", scrapeNode)
  .addNode("command", commandNode)
  .addNode("respond", respondNode)
  .addEdge("__start__", "contextLoader")
  .addEdge("contextLoader", "router")
  .addConditionalEdges(
    "router",
    (state: RedGraphStateType) => {
      return state.nextGraph || "respond";
    },
    {
      "homeGraph": END,
      "assistantGraph": END,
      "search": "search",
      "scrape": "scrape",
      "command": "command",
      "respond": "respond",
    }
  )
  .addConditionalEdges(
    "search",
    (state: RedGraphStateType) => {
      if (state.nextGraph === 'search') {
        return 'search';
      }
      return 'responder';
    },
    {
      "search": "search",
      "respond": "respond"
    }
  )
  .addEdge("scrape", "respond")
  .addEdge("command", "respond")
  .addEdge("respond", END)
  .addEdge("respond", END);

// Export RedGraphState for use in graph compiler (Phase 1)
export { RedGraphState };

// Export ROUTER graph with precheck+classifier as default
export const redGraph = redGraphBuilderRouter.compile();

// Export PLANNER-BASED graph for reference (direct to planner, no classifier)
export const redGraphPlanner = redGraphBuilderWithPlanner.compile();

// Export LEGACY ROUTER-BASED graph for backwards compatibility (old single-step router)
export const redGraphLegacy = redGraphBuilderWithRouter.compile();
