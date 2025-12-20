/**
 * Universal Node Config Model (Deprecated)
 * 
 * This file is kept for backwards compatibility.
 * All exports now come from Node.ts which uses the 'nodes' collection.
 * 
 * @deprecated Use imports from './Node' instead
 */

export {
  NodeModel as UniversalNodeConfigModel,
  getNodeConfig as getUniversalNodeConfig,
  getNodeConfigForUser,
  cloneNodeForUser,
  listSystemNodes as listSystemUniversalNodes,
  listUserNodes as listUserUniversalNodes,
  saveNodeConfig as saveUniversalNodeConfig,
} from './Node';
