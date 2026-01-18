/**
 * Run System
 *
 * Unified run execution system providing:
 * - RunPublisher: State management and event publishing
 * - RunLock: Distributed locking for concurrent execution control
 *
 * @module lib/run
 */

// Types
export {
  // State types
  type RunState,
  type RunStatus,
  type RunOutput,
  type CurrentStatus,
  type GraphTrace,
  type NodeProgress,
  type NodeStatus,
  type ToolExecution,
  type ToolStatus,
  type ProgressStep,
  type TokenMetadata,

  // Event types
  type RunEvent,
  type RunEventType,
  type RunStartEvent,
  type RunCompleteEvent,
  type RunErrorEvent,
  type StatusEvent,
  type GraphStartEvent,
  type GraphCompleteEvent,
  type GraphErrorEvent,
  type NodeStartEvent,
  type NodeProgressEvent,
  type NodeCompleteEvent,
  type NodeErrorEvent,
  type ChunkEvent,
  type ThinkingCompleteEvent,
  type ToolStartEvent,
  type ToolProgressEvent,
  type ToolCompleteEvent,
  type ToolErrorEvent,
  type InitEvent,

  // Key patterns and config
  RunKeys,
  RunConfig,

  // Factory functions
  createInitialRunState,
  createNodeProgress,
  createToolExecution,
} from './types';

// Publisher
export {
  RunPublisher,
  type RunPublisherOptions,
  type RunSubscription,
  createRunPublisher,
  getRunState,
  getActiveRunForConversation,
} from './run-publisher';

// Lock
export {
  RunLock,
  type LockResult,
  type AcquireLockOptions,
  type RunLockHandle,
  createRunLock,
  acquireRunLock,
  isConversationLocked,
  isGraphLocked, // deprecated
} from './run-lock';
