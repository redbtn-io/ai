/**
 * Node Model
 * 
 * Stores node configurations as JSON in MongoDB.
 * Collection name: nodes
 */

import mongoose from 'mongoose';

const StepSchema = new mongoose.Schema({
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

const NodeSchema = new mongoose.Schema({
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
  
  // The node configuration steps
  steps: {
    type: [StepSchema],
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
NodeSchema.pre('save', async function() {
  this.updatedAt = new Date();
});

// Indexes for efficient queries
NodeSchema.index({ userId: 1, isSystem: 1 });
NodeSchema.index({ category: 1, isSystem: 1 });
NodeSchema.index({ 'metadata.tags': 1 });

// Export model - uses 'nodes' collection
export const NodeModel = 
  mongoose.models.Node || 
  mongoose.model('Node', NodeSchema);

/**
 * Helper function to get a node config by ID
 */
export async function getNodeConfig(nodeId: string): Promise<any | null> {
  return NodeModel.findOne({ nodeId }).lean();
}

/**
 * Helper function to list all system nodes
 */
export async function listSystemNodes(): Promise<any[]> {
  return NodeModel.find({ isSystem: true }).lean();
}

/**
 * Helper function to list user's custom nodes
 */
export async function listUserNodes(userId: string): Promise<any[]> {
  return NodeModel.find({ userId, isSystem: false }).lean();
}

/**
 * Helper function to save/update a node config
 */
export async function saveNodeConfig(config: any): Promise<any> {
  const existing = await NodeModel.findOne({ nodeId: config.nodeId });
  
  if (existing) {
    // Update existing
    Object.assign(existing, config);
    existing.version += 1;
    existing.updatedAt = new Date();
    return existing.save();
  } else {
    // Create new
    return NodeModel.create(config);
  }
}

// Re-export with old names for backwards compatibility
export const UniversalNodeConfigModel = NodeModel;
export const getUniversalNodeConfig = getNodeConfig;
export const listSystemUniversalNodes = listSystemNodes;
export const listUserUniversalNodes = listUserNodes;
export const saveUniversalNodeConfig = saveNodeConfig;
