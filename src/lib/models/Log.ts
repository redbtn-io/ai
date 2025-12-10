/**
 * Log MongoDB Model
 * 
 * Stores system and generation logs with 6-month TTL.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';

/**
 * Log document interface
 */
export interface ILog {
  logId: string;
  generationId?: string;
  conversationId?: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'trace';
  category: string;
  message: string;
  timestamp: Date;
  nodeId?: string;
  metadata?: {
    duration?: number;
    statusCode?: number;
    error?: any;
    [key: string]: any;
  };
}

export interface LogDocument extends ILog, Document {}

const LogSchema = new Schema<LogDocument>(
  {
    logId: { type: String, required: true, unique: true },
    generationId: { type: String, index: true },
    conversationId: { type: String, index: true },
    level: { type: String, enum: ['info', 'warn', 'error', 'debug', 'trace'], required: true, index: true },
    category: { type: String, required: true, index: true },
    message: { type: String, required: true },
    timestamp: { type: Date, required: true },
    nodeId: String,
    metadata: Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// TTL index: automatically delete logs after 6 months (15552000 seconds)
LogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 15552000 });

// Prevent model recompilation in Next.js hot reload
export const Log: Model<LogDocument> =
  mongoose.models.Log || mongoose.model<LogDocument>('Log', LogSchema);

export default Log;
