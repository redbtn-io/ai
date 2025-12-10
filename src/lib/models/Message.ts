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
 * Message document interface
 */
export interface IMessage {
  messageId?: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolExecutions?: IToolExecution[];
  metadata?: {
    model?: string;
    tokens?: {
      input?: number;
      output?: number;
      total?: number;
    };
    toolCalls?: string[];
    source?: any;
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

const MessageSchema = new Schema<MessageDocument>(
  {
    messageId: { type: String, unique: true, sparse: true },
    conversationId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    toolExecutions: [ToolExecutionSchema],
    metadata: {
      model: String,
      tokens: {
        input: Number,
        output: Number,
        total: Number,
      },
      toolCalls: [String],
      source: Schema.Types.Mixed,
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
