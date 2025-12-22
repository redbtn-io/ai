/**
 * @file src/lib/models/Library.ts
 * @description MongoDB model for Knowledge Libraries - user-owned collections of vector documents
 * 
 * Libraries provide a user-scoped organizational layer for vector storage.
 * Each library maps to a collection in the vector database (Qdrant/ChromaDB)
 * and tracks metadata, permissions, and document statistics.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// --- Type Definitions ---

/**
 * Access level for a library
 */
export enum LibraryAccess {
  PRIVATE = 'private',   // Only owner can view/edit
  SHARED = 'shared',     // Specific users can view/search
  PUBLIC = 'public',     // Anyone can view/search (read-only)
}

/**
 * Document source type for categorization
 */
export enum DocumentSourceType {
  FILE = 'file',           // Uploaded file (PDF, TXT, etc.)
  URL = 'url',             // Scraped from URL
  TEXT = 'text',           // Direct text input
  API = 'api',             // Ingested via API
  CONVERSATION = 'conversation', // From chat history
}

/**
 * Document metadata stored in MongoDB (vector content is in Qdrant)
 */
export interface LibraryDocument {
  documentId: string;         // Unique ID for this document
  title: string;              // Display title
  sourceType: DocumentSourceType;
  source?: string;            // Original source (URL, filename, etc.)
  mimeType?: string;          // File MIME type if applicable
  fileSize?: number;          // Original file size in bytes
  chunkCount: number;         // Number of vector chunks created
  charCount: number;          // Character count of original content
  addedAt: Date;              // When document was added
  addedBy?: string;           // User ID who added it
  metadata?: Record<string, unknown>; // Custom metadata
}

/**
 * Shared access entry
 */
export interface SharedAccess {
  userId: string;
  email?: string;             // For display purposes
  accessLevel: 'read' | 'write';
  grantedAt: Date;
  grantedBy: string;
}

/**
 * Library interface for TypeScript
 */
export interface ILibrary {
  libraryId: string;          // User-facing ID (e.g., "my-documents")
  userId: string;             // Owner's user ID
  name: string;               // Display name
  description?: string;       // Optional description
  icon?: string;              // Lucide icon name
  color?: string;             // Theme color (hex)
  access: LibraryAccess;
  sharedWith?: SharedAccess[];
  
  // Vector store configuration
  vectorCollection: string;   // Actual collection name in Qdrant/Chroma
  embeddingModel: string;     // Model used for embeddings
  chunkSize: number;          // Chunk size in characters
  chunkOverlap: number;       // Overlap between chunks
  
  // Document tracking
  documents: LibraryDocument[];
  documentCount: number;      // Total documents
  totalChunks: number;        // Total vector chunks
  totalSize: number;          // Total size in bytes
  
  // Usage stats
  searchCount: number;        // Number of searches performed
  lastSearchAt?: Date;        // Last search timestamp
  lastUpdatedAt: Date;        // Last document add/remove
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  
  // Soft delete
  isArchived: boolean;
  archivedAt?: Date;
}

/**
 * Mongoose document type
 */
export interface LibraryDocument extends ILibrary, Document {}

// --- Schema Definition ---

const SharedAccessSchema = new Schema<SharedAccess>({
  userId: { type: String, required: true },
  email: String,
  accessLevel: { 
    type: String, 
    enum: ['read', 'write'],
    default: 'read'
  },
  grantedAt: { type: Date, default: Date.now },
  grantedBy: { type: String, required: true },
}, { _id: false });

const LibraryDocumentSchema = new Schema<LibraryDocument>({
  documentId: { type: String, required: true },
  title: { type: String, required: true },
  sourceType: { 
    type: String, 
    enum: Object.values(DocumentSourceType),
    required: true 
  },
  source: String,
  mimeType: String,
  fileSize: Number,
  chunkCount: { type: Number, default: 0 },
  charCount: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now },
  addedBy: String,
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const LibrarySchema = new Schema<ILibrary>(
  {
    libraryId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    icon: {
      type: String,
      default: 'Library',
    },
    color: {
      type: String,
      default: '#ef4444',
    },
    access: {
      type: String,
      enum: Object.values(LibraryAccess),
      default: LibraryAccess.PRIVATE,
    },
    sharedWith: [SharedAccessSchema],
    
    // Vector store configuration
    vectorCollection: {
      type: String,
      required: true,
      unique: true,
    },
    embeddingModel: {
      type: String,
      default: 'nomic-embed-text',
    },
    chunkSize: {
      type: Number,
      default: 2000,
    },
    chunkOverlap: {
      type: Number,
      default: 200,
    },
    
    // Document tracking
    documents: [LibraryDocumentSchema],
    documentCount: {
      type: Number,
      default: 0,
    },
    totalChunks: {
      type: Number,
      default: 0,
    },
    totalSize: {
      type: Number,
      default: 0,
    },
    
    // Usage stats
    searchCount: {
      type: Number,
      default: 0,
    },
    lastSearchAt: Date,
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    
    // Soft delete
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedAt: Date,
  },
  {
    timestamps: true,
    collection: 'libraries',
  }
);

// Compound indexes for efficient queries
LibrarySchema.index({ userId: 1, libraryId: 1 }, { unique: true });
LibrarySchema.index({ userId: 1, isArchived: 1 });
LibrarySchema.index({ access: 1, isArchived: 1 }); // For public library discovery
LibrarySchema.index({ 'sharedWith.userId': 1 });

// --- Static Methods ---

LibrarySchema.statics.generateVectorCollectionName = function(
  userId: string, 
  libraryId: string
): string {
  // Generate a unique, deterministic collection name for the vector store
  return `lib_${userId.slice(-8)}_${libraryId.replace(/[^a-z0-9]/gi, '_').slice(0, 32)}`;
};

LibrarySchema.statics.findByUserAccess = async function(
  userId: string,
  options: { includePublic?: boolean; includeShared?: boolean; includeArchived?: boolean } = {}
): Promise<ILibrary[]> {
  const { includePublic = false, includeShared = true, includeArchived = false } = options;
  
  const conditions: Record<string, unknown>[] = [
    { userId, isArchived: includeArchived ? { $in: [true, false] } : false },
  ];
  
  if (includeShared) {
    conditions.push({ 
      'sharedWith.userId': userId, 
      isArchived: includeArchived ? { $in: [true, false] } : false 
    });
  }
  
  if (includePublic) {
    conditions.push({ 
      access: LibraryAccess.PUBLIC, 
      isArchived: false 
    });
  }
  
  return this.find({ $or: conditions }).sort({ updatedAt: -1 });
};

// --- Model Export ---

const LibraryModel: Model<ILibrary> = 
  mongoose.models.Library || mongoose.model<ILibrary>('Library', LibrarySchema);

export default LibraryModel;
export { LibraryModel };

// --- Helper Functions ---

/**
 * Generate a unique library ID from a name
 */
export function generateLibraryId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/**
 * Check if a user has access to a library
 */
export function hasLibraryAccess(
  library: ILibrary, 
  userId: string, 
  requiredLevel: 'read' | 'write' = 'read'
): boolean {
  // Owner always has full access
  if (library.userId === userId) {
    return true;
  }
  
  // Public libraries are read-only for everyone
  if (library.access === LibraryAccess.PUBLIC && requiredLevel === 'read') {
    return true;
  }
  
  // Check shared access
  if (library.access === LibraryAccess.SHARED || library.access === LibraryAccess.PRIVATE) {
    const sharedEntry = library.sharedWith?.find(s => s.userId === userId);
    if (sharedEntry) {
      if (requiredLevel === 'read') {
        return true;
      }
      return sharedEntry.accessLevel === 'write';
    }
  }
  
  return false;
}
