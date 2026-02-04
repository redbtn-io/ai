/**
 * Message MongoDB Model
 * 
 * Stores conversation messages for the AI system.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';

/**
 * Tool execution step interface
 */
export interface IToolStep {
  step: string;
  timestamp: Date;
  progress?: number;
  data?: any;
}

/**
 * Tool execution interface
 */
export interface IToolExecution {
  toolId: string;
  toolType: string;
  toolName: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  steps: IToolStep[];
  currentStep?: string;
  progress?: number;
  streamingContent?: string;
  result?: any;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Node progress interface for graph run tracking
 */
export interface INodeProgress {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  currentStep?: number;
  totalSteps?: number;
  stepName?: string;
  startTime?: number;
  endTime?: number;
  error?: string;
}

/**
 * Graph run interface for tracking graph execution history
 */
export interface IGraphRun {
  graphId: string;
  graphName?: string;
  runId?: string;
  status: 'running' | 'completed' | 'error';
  executionPath: string[];
  nodeProgress: Record<string, INodeProgress>;
  startTime?: number;
  endTime?: number;
  duration?: number;
  error?: string;
}

/**
 * Message document interface
 */
export interface IMessage {
  messageId?: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolExecutions?: IToolExecution[];
  graphRun?: IGraphRun;
  metadata?: {
    model?: string;
    tokens?: {
      input?: number;
      output?: number;
      total?: number;
    };
    toolCalls?: string[];
    source?: any;
    runId?: string;
  };
}

export interface MessageDocument extends IMessage, Document {}

const ToolStepSchema = new Schema<IToolStep>(
  {
    step: { type: String, required: true },
    timestamp: { type: Date, required: true },
    progress: Number,
    data: Schema.Types.Mixed,
  },
  { _id: false }
);

const ToolExecutionSchema = new Schema<IToolExecution>(
  {
    toolId: { type: String, required: true },
    toolType: { type: String, required: true },
    toolName: { type: String, required: true },
    status: { type: String, enum: ['running', 'completed', 'error'], required: true },
    startTime: { type: Date, required: true },
    endTime: Date,
    duration: Number,
    steps: [ToolStepSchema],
    currentStep: String,
    progress: Number,
    streamingContent: String,
    result: Schema.Types.Mixed,
    error: String,
    metadata: Schema.Types.Mixed,
  },
  { _id: false }
);

const NodeProgressSchema = new Schema<INodeProgress>(
  {
    nodeId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'error'], required: true },
    currentStep: Number,
    totalSteps: Number,
    stepName: String,
    startTime: Number,
    endTime: Number,
    error: String,
  },
  { _id: false }
);

const GraphRunSchema = new Schema<IGraphRun>(
  {
    graphId: { type: String, required: true },
    graphName: String,
    runId: String,
    status: { type: String, enum: ['running', 'completed', 'error'], required: true },
    executionPath: [{ type: String }],
    nodeProgress: { type: Schema.Types.Mixed, default: {} },
    startTime: Number,
    endTime: Number,
    duration: Number,
    error: String,
  },
  { _id: false }
);

const MessageSchema = new Schema<MessageDocument>(
  {
    messageId: { type: String, unique: true, sparse: true },
    conversationId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    toolExecutions: [ToolExecutionSchema],
    graphRun: GraphRunSchema,
    metadata: {
      model: String,
      tokens: {
        input: Number,
        output: Number,
        total: Number,
      },
      toolCalls: [String],
      source: Schema.Types.Mixed,
      runId: String,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
MessageSchema.index({ conversationId: 1, timestamp: 1 });

// Prevent model recompilation in Next.js hot reload
export const Message: Model<MessageDocument> =
  mongoose.models.Message || mongoose.model<MessageDocument>('Message', MessageSchema);

export default Message;
