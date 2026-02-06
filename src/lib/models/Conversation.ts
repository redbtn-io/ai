/**
 * Conversation MongoDB Model (AI Package)
 * 
 * Stores conversation metadata for the AI system.
 * Note: This is separate from the webapp's UserConversation model.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';

/**
 * Conversation source types
 */
export type ConversationSource = 'chat' | 'terminal' | 'api';

/**
 * Conversation document interface
 */
export interface IConversation {
  conversationId: string;
  title?: string;
  userId?: string;
  source?: ConversationSource;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: {
    application?: string;
    messageCount?: number;
  };
}

export interface ConversationDocument extends IConversation, Document {}

const ConversationSchema = new Schema<ConversationDocument>(
  {
    conversationId: { type: String, required: true, unique: true, index: true },
    title: String,
    userId: { type: String, index: true },
    source: { type: String, enum: ['chat', 'terminal', 'api'], default: 'chat', index: true },
    metadata: {
      application: String,
      messageCount: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ConversationSchema.index({ updatedAt: -1 });

// Prevent model recompilation in Next.js hot reload
export const Conversation: Model<ConversationDocument> =
  mongoose.models.AIConversation || mongoose.model<ConversationDocument>('AIConversation', ConversationSchema, 'conversations');

export default Conversation;
