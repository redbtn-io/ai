/**
 * Node Registry
 * 
 * Phase 1: Dynamic Graph System
 * Maps GraphNodeType enum values to their implementation functions.
 * This is the authoritative registry for all supported node types.
 */

import { GraphNodeType } from '../types/graph';
import { universalNode } from '../nodes/universal/universalNode';

/**
 * Type for node function signature
 * All node functions must accept state and return updated state
 */
export type NodeFunction = (state: any) => Promise<any>;

/**
 * Registry mapping node types to implementation functions
 * This map is used by the graph compiler to build dynamic graphs
 */
export const NODE_REGISTRY: Record<GraphNodeType, NodeFunction> = {
  [GraphNodeType.PRECHECK]: universalNode,
  [GraphNodeType.FASTPATH]: universalNode,
  [GraphNodeType.CONTEXT]: universalNode,
  [GraphNodeType.CLASSIFIER]: universalNode,
  [GraphNodeType.ROUTER]: universalNode,
  [GraphNodeType.PLANNER]: universalNode,
  [GraphNodeType.EXECUTOR]: universalNode,
  [GraphNodeType.RESPONDER]: universalNode,
  [GraphNodeType.SEARCH]: universalNode,
  [GraphNodeType.SCRAPE]: universalNode,
  [GraphNodeType.COMMAND]: universalNode,
  [GraphNodeType.UNIVERSAL]: universalNode
};

/**
 * Validates that a node type is supported in the registry
 * @param type Node type to validate
 * @returns True if the node type has an implementation
 */
export function isValidNodeType(type: string): type is GraphNodeType {
  return type in NODE_REGISTRY;
}

/**
 * Gets the implementation function for a node type
 * @param type Node type from GraphNodeType enum
 * @returns The node implementation function
 * @throws Error if node type is not found in registry
 */
export function getNodeFunction(type: GraphNodeType): NodeFunction {
  const fn = NODE_REGISTRY[type];
  if (!fn) {
    throw new Error(`Unknown node type: ${type}. Node type must be registered in NODE_REGISTRY.`);
  }
  return fn;
}

/**
 * Gets all registered node types
 * @returns Array of all valid node type identifiers
 */
export function getRegisteredNodeTypes(): GraphNodeType[] {
  return Object.keys(NODE_REGISTRY) as GraphNodeType[];
}

/**
 * Gets human-readable information about registered nodes
 * Useful for debugging and documentation
 */
export function getNodeTypeInfo(): Array<{ type: GraphNodeType; name: string }> {
  return Object.values(GraphNodeType).map(type => ({
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1)
  }));
}
