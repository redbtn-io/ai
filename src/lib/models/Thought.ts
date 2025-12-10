/**
 * Thought MongoDB Model
 * 
 * Stores thinking/reasoning content separately from messages.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';

/**
 * Thought document interface
 */
export interface IThought {
  thoughtId: string;
  messageId?: string;
  conversationId: string;
  generationId?: string;
  source: 'chat' | 'router' | 'toolPicker';
  content: string;
  timestamp: Date;
  metadata?: {
    model?: string;
    [key: string]: any;
  };
}

export interface ThoughtDocument extends IThought, Document {}

const ThoughtSchema = new Schema<ThoughtDocument>(
  {
    thoughtId: { type: String, required: true, unique: true, index: true },
    messageId: { type: String, index: true },
    conversationId: { type: String, required: true, index: true },
    generationId: { type: String, index: true },
    source: { 
      type: String, 
      enum: ['chat', 'router', 'toolPicker'], 
      required: true,
      index: true 
    },
    content: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    metadata: Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Composite indexes for optimized queries
ThoughtSchema.index({ messageId: 1, timestamp: -1 });
ThoughtSchema.index({ conversationId: 1, timestamp: -1 });
ThoughtSchema.index({ generationId: 1, timestamp: 1 });
ThoughtSchema.index({ source: 1, conversationId: 1, timestamp: -1 });

// Prevent model recompilation in Next.js hot reload
export const Thought: Model<ThoughtDocument> =
  mongoose.models.Thought || mongoose.model<ThoughtDocument>('Thought', ThoughtSchema);

export default Thought;
