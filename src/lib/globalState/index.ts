/**
 * Global State Module
 * 
 * Provides access to persistent global state that can be shared across
 * workflow executions. This enables workflows to read and write values
 * that persist beyond a single run.
 */

export {
  GlobalStateClient,
  getGlobalStateClient,
  getGlobalValue,
  setGlobalValue,
} from './client';
