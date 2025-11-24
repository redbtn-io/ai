/**
 * Graph Compiler
 * 
 * Phase 1: Dynamic Graph System
 * Compiles graph configurations into LangGraph StateGraph instances.
 * Uses JIT (Just-In-Time) compilation with validation.
 */

import { StateGraph, END } from "@langchain/langgraph";
import { GraphConfig, GraphEdgeConfig, CompiledGraph } from '../types/graph';
import { NODE_REGISTRY, isValidNodeType, NodeFunction } from './nodeRegistry';
import { createConditionFunction } from './conditionEvaluator';

// Import RedGraphState from the static graph file
import { RedGraphState } from './red';

/**
 * Creates a configurable node wrapper that injects config into the state
 * This allows nodes to access custom configuration from GraphNodeConfig
 */
function createConfigurableNode(
  nodeFn: NodeFunction,
  config: Record<string, any>
): NodeFunction {
  return async (state: any) => {
    // Inject node config into state so the node can access it
    const enhancedState = {
      ...state,
      nodeConfig: config
    };
    
    return await nodeFn(enhancedState);
  };
}

/**
 * Compiles a graph configuration into a LangGraph CompiledStateGraph.
 * This is a JIT compilation process that happens at runtime when a graph is loaded.
 * 
 * @param config Graph configuration from MongoDB
 * @returns Compiled graph ready for invocation
 * @throws GraphCompilationError if graph is invalid
 */
export function compileGraphFromConfig(config: GraphConfig): CompiledGraph {
  console.log(`[GraphCompiler] Compiling graph: ${config.graphId}`);
  
  // Step 1: Validate configuration before compilation
  validateGraphConfig(config);
  
  // Step 2: Create StateGraph builder with RedGraphState annotations
  const builder = new StateGraph(RedGraphState);
  
  // Step 3: Add all nodes to the graph
  for (const node of config.nodes) {
    const nodeFn = NODE_REGISTRY[node.type];
    if (!nodeFn) {
      throw new GraphCompilationError(
        `Unknown node type: ${node.type} (node: ${node.id})`,
        config.graphId
      );
    }
    
    console.log(`[GraphCompiler]   Adding node: ${node.id} (type: ${node.type})`);
    
    // Wrap node function to inject config if provided
    const wrappedFn = node.config 
      ? createConfigurableNode(nodeFn, node.config)
      : nodeFn;
    
    builder.addNode(node.id, wrappedFn);
  }
  
  // Step 4: Add all edges (simple and conditional)
  for (const edge of config.edges) {
    if (edge.condition || edge.targets) {
      // Conditional edge with branching logic
      addConditionalEdge(builder, edge, config);
    } else {
      // Simple direct edge
      addSimpleEdge(builder, edge);
    }
  }
  
  // Step 5: Compile the graph
  const compiled = builder.compile();
  
  console.log(`[GraphCompiler] Successfully compiled graph: ${config.graphId}`);
  
  return {
    graphId: config.graphId,
    config,
    graph: compiled,
    compiledAt: new Date()
  };
}

/**
 * Validates graph configuration before compilation
 * Throws errors for critical issues, logs warnings for best practices
 */
function validateGraphConfig(config: GraphConfig): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Validate nodes exist
  if (!config.nodes || config.nodes.length === 0) {
    errors.push('Graph must have at least one node');
  }
  
  // Validate edges exist
  if (!config.edges || config.edges.length === 0) {
    errors.push('Graph must have at least one edge');
  }
  
  // Check all node types are valid
  for (const node of config.nodes || []) {
    if (!isValidNodeType(node.type)) {
      errors.push(`Invalid node type: ${node.type} (node: ${node.id})`);
    }
  }
  
  // Check for duplicate node IDs
  if (config.nodes) {
    const nodeIds = config.nodes.map(n => n.id);
    const uniqueIds = new Set(nodeIds);
    if (nodeIds.length !== uniqueIds.size) {
      const duplicates = nodeIds.filter((id, index) => 
        nodeIds.indexOf(id) !== index
      );
      errors.push(`Duplicate node IDs found: ${duplicates.join(', ')}`);
    }
  }
  
  // Validate edges reference valid nodes
  if (config.nodes && config.edges) {
    const validNodeIds = new Set([
      ...config.nodes.map(n => n.id),
      '__start__',
      '__end__',
      END
    ]);
    
    for (const edge of config.edges) {
      // Validate source node
      if (!validNodeIds.has(edge.from)) {
        errors.push(`Edge references unknown source node: ${edge.from}`);
      }
      
      // Validate target node (simple edge)
      if (edge.to && !validNodeIds.has(edge.to)) {
        errors.push(`Edge references unknown target node: ${edge.to}`);
      }
      
      // Validate all targets in conditional edges
      if (edge.targets) {
        for (const [key, target] of Object.entries(edge.targets)) {
          if (!validNodeIds.has(target)) {
            errors.push(`Edge references unknown target in '${key}': ${target}`);
          }
        }
      }
      
      // Validate fallback node
      if (edge.fallback && !validNodeIds.has(edge.fallback)) {
        errors.push(`Edge references unknown fallback node: ${edge.fallback}`);
      }
    }
  }
  
  // Validate tier value
  if (config.tier !== undefined && (config.tier < 0 || config.tier > 4)) {
    errors.push(`Invalid tier value: ${config.tier} (must be 0-4)`);
  }
  
  // Warnings: Check for orphaned nodes (no incoming edges)
  if (config.nodes && config.edges) {
    const nodesWithIncoming = new Set<string>();
    for (const edge of config.edges) {
      if (edge.to) {
        nodesWithIncoming.add(edge.to);
      }
      if (edge.targets) {
        for (const target of Object.values(edge.targets)) {
          nodesWithIncoming.add(target);
        }
      }
      if (edge.fallback) {
        nodesWithIncoming.add(edge.fallback);
      }
    }
    
    const orphanedNodes = config.nodes
      .map(n => n.id)
      .filter(id => !nodesWithIncoming.has(id) && id !== '__start__');
    
    if (orphanedNodes.length > 0) {
      warnings.push(`Orphaned nodes (no incoming edges): ${orphanedNodes.join(', ')}`);
    }
  }
  
  // Warnings: Check for very large graphs
  if (config.nodes && config.nodes.length > 20) {
    warnings.push(`Large graph detected: ${config.nodes.length} nodes (may impact performance)`);
  }
  
  // Log warnings
  for (const warning of warnings) {
    console.warn(`[GraphCompiler] WARNING: ${warning}`);
  }
  
  // Throw if any errors
  if (errors.length > 0) {
    throw new GraphCompilationError(
      `Graph validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      config.graphId
    );
  }
}

/**
 * Adds a simple edge to the graph builder
 */
function addSimpleEdge(
  builder: StateGraph<any>, 
  edge: GraphEdgeConfig
): void {
  const to = edge.to || END;
  console.log(`[GraphCompiler]   Adding edge: ${edge.from} → ${to}`);
  builder.addEdge(edge.from as any, to as any);
}

/**
 * Adds a conditional edge with branching logic to the graph builder
 */
function addConditionalEdge(
  builder: StateGraph<any>, 
  edge: GraphEdgeConfig,
  config: GraphConfig
): void {
  if (!edge.condition && !edge.targets) {
    throw new GraphCompilationError(
      `Conditional edge from ${edge.from} missing condition or targets`,
      config.graphId
    );
  }
  
  // Build condition function using safe evaluator
  const conditionFn = createConditionFunction(
    edge.condition || '',
    edge.targets || {},
    edge.fallback
  );
  
  // Build target mapping (all possible destinations)
  // LangGraph expects: conditionFn returns KEY → targetMap[KEY] = nodeId
  const targetMap: Record<string, string> = {};
  
  if (edge.targets) {
    // Explicit targets provided
    // The condition function will return the KEY (e.g., 'direct')
    // targetMap maps KEY → node ID (e.g., 'direct' → 'responder')
    for (const [key, value] of Object.entries(edge.targets)) {
      targetMap[key] = value;
    }
  } else if (edge.to) {
    // Simple condition with single target
    targetMap['true'] = edge.to;
  }
  
  if (edge.fallback) {
    // CRITICAL: Fallback must be in targetMap for LangGraph to see it as reachable
    // The condition function returns '__fallback__' when no match is found
    targetMap['__fallback__'] = edge.fallback;
  }
  
  // Always include __end__ as possible target
  targetMap['__end__'] = END;
  
  const targetKeys = Object.keys(edge.targets || {});
  console.log(`[GraphCompiler]   Adding conditional edge: ${edge.from} → [${targetKeys.join(', ')}]`);
  // Log the target map for easier diagnostics at runtime
  console.log(`[GraphCompiler]     targetMap keys: ${Object.keys(targetMap).join(', ')}`);
  console.log(`[GraphCompiler]     targetMap nodes: ${Object.values(targetMap).join(', ')}`);
  
  builder.addConditionalEdges(
    edge.from as any,
    conditionFn,
    targetMap as any
  );
}

/**
 * Custom error for graph compilation failures
 */
export class GraphCompilationError extends Error {
  constructor(message: string, public graphId?: string) {
    super(message);
    this.name = 'GraphCompilationError';
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GraphCompilationError);
    }
  }
}
