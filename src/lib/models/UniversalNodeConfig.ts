/**
 * Universal Node Config Model
 * 
 * Stores universal node configurations as JSON in MongoDB.
 * Replaces TypeScript config files with database-stored configs.
 */

import mongoose from 'mongoose';

const UniversalStepSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['neuron', 'tool', 'transform', 'conditional', 'loop'],
    required: true
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, { _id: false });

const UniversalNodeConfigSchema = new mongoose.Schema({
  // Unique identifier for this node configuration
  nodeId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Display name
  name: {
    type: String,
    required: true
  },
  
  // Description of what this node does
  description: {
    type: String,
    required: true
  },
  
  // Node category
  category: {
    type: String,
    enum: ['routing', 'execution', 'transformation', 'communication', 'utility'],
    required: true
  },
  
  // Owner (system or user ID)
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // Is this a system-provided node?
  isSystem: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Version for tracking changes
  version: {
    type: Number,
    default: 1
  },
  
  // The universal node configuration
  steps: {
    type: [UniversalStepSchema],
    required: true
  },
  
  // Metadata
  metadata: {
    // Original TypeScript file (for migration reference)
    originalFile: String,
    
    // Migration date
    migratedAt: Date,
    
    // Lines of code saved
    linesReduced: Number,
    
    // Tags for categorization
    tags: [String]
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
UniversalNodeConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for efficient queries
UniversalNodeConfigSchema.index({ userId: 1, isSystem: 1 });
UniversalNodeConfigSchema.index({ category: 1, isSystem: 1 });
UniversalNodeConfigSchema.index({ 'metadata.tags': 1 });

export const UniversalNodeConfigModel = 
  mongoose.models.UniversalNodeConfig || 
  mongoose.model('UniversalNodeConfig', UniversalNodeConfigSchema);

/**
 * Helper function to get a universal node config by ID
 */
export async function getUniversalNodeConfig(nodeId: string): Promise<any | null> {
  return UniversalNodeConfigModel.findOne({ nodeId }).lean();
}

/**
 * Helper function to list all system universal nodes
 */
export async function listSystemUniversalNodes(): Promise<any[]> {
  return UniversalNodeConfigModel.find({ isSystem: true }).lean();
}

/**
 * Helper function to list user's custom universal nodes
 */
export async function listUserUniversalNodes(userId: string): Promise<any[]> {
  return UniversalNodeConfigModel.find({ userId, isSystem: false }).lean();
}

/**
 * Helper function to save/update a universal node config
 */
export async function saveUniversalNodeConfig(config: any): Promise<any> {
  const existing = await UniversalNodeConfigModel.findOne({ nodeId: config.nodeId });
  
  if (existing) {
    // Update existing
    Object.assign(existing, config);
    existing.version += 1;
    existing.updatedAt = new Date();
    return existing.save();
  } else {
    // Create new
    return UniversalNodeConfigModel.create(config);
  }
}
