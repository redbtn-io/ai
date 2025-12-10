/**
 * Generation MongoDB Model
 * 
 * Tracks AI generation metadata and status.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';

/**
 * Generation document interface
 */
export interface IGeneration {
  generationId: string;
  conversationId: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed';
  modelName?: string;
  nodeId?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tokensUsed?: number;
  error?: string;
  metadata?: {
    [key: string]: any;
  };
}

export interface GenerationDocument extends IGeneration, Document {}

const GenerationSchema = new Schema<GenerationDocument>(
  {
    generationId: { type: String, required: true, unique: true, index: true },
    conversationId: { type: String, required: true, index: true },
    status: { 
      type: String, 
      enum: ['pending', 'streaming', 'completed', 'failed'], 
      required: true,
      index: true 
    },
    modelName: String,
    nodeId: { type: String, index: true },
    startTime: { type: Date, required: true, index: true },
    endTime: Date,
    duration: Number,
    tokensUsed: Number,
    error: String,
    metadata: Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Prevent model recompilation in Next.js hot reload
export const Generation: Model<GenerationDocument> =
  mongoose.models.Generation || mongoose.model<GenerationDocument>('Generation', GenerationSchema);

export default Generation;
