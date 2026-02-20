/**
 * Node Registry
 * 
 * All graph nodes are executed by the universal node function.
 * The node's behavior is determined by its config (loaded from MongoDB),
 * not by a type enum.
 */

import { universalNode } from '../nodes/universal/universalNode';

/**
 * Type for node function signature
 * All node functions must accept state and return updated state
 */
export type NodeFunction = (state: any) => Promise<any>;

/**
 * The single node implementation used by the graph compiler.
 * Every node in every graph runs through universalNode,
 * which loads its step config from MongoDB by nodeId.
 */
export { universalNode } from '../nodes/universal/universalNode';

/**
 * Returns the node function for use by the compiler.
 * Kept as a function for API consistency if callers need it.
 */
export function getNodeFunction(): NodeFunction {
  return universalNode;
}
