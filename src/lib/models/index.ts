/**
 * Models barrel export
 */

export { default as Neuron } from './Neuron';
export type { NeuronDocument } from '../types/neuron';

export { Graph } from './Graph';
export type { GraphDocument } from './Graph';

// AI-specific models for conversations, logs, etc.
export { default as Message, Message as MessageModel } from './Message';
export type { IMessage, MessageDocument, IToolStep, IToolExecution } from './Message';

export { default as Conversation, Conversation as ConversationModel } from './Conversation';
export type { IConversation, ConversationDocument } from './Conversation';

export { default as Log, Log as LogModel } from './Log';
export type { ILog, LogDocument } from './Log';

export { default as Generation, Generation as GenerationModel } from './Generation';
export type { IGeneration, GenerationDocument } from './Generation';

export { default as Thought, Thought as ThoughtModel } from './Thought';
export type { IThought, ThoughtDocument } from './Thought';

// Node model
export { 
  NodeModel, 
  getNodeConfig, 
  saveNodeConfig,
  searchNodes,
  getAllTags,
  recordNodeUsage,
  cloneNodeForUser,
  getNodeConfigForUser,
  listSystemNodes,
  listUserNodes,
  // Parameter system
  validateParameterValue,
  validateParameters,
  resolveParameters,
  parametersMapToObject
} from './Node';
export type { 
  NodeSearchOptions,
  ParameterDefinition,
  NodeParameters,
  ResolvedParameters 
} from './Node';
