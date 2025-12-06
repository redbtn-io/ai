/**
 * Graph MongoDB Model
 * 
 * Phase 1: Dynamic Graph System
 * Stores graph configurations in MongoDB for per-user dynamic loading
 */

import { Schema, model, Document } from 'mongoose';
import { GraphConfig, GraphNodeType } from '../types/graph';

/**
 * Graph document interface (Mongoose document)
 */
export interface GraphDocument extends Document, Omit<GraphConfig, '_id'> {
  _id: any;
}

/**
 * Graph node schema (embedded subdocument)
 */
const graphNodeSchema = new Schema({
  id: { 
    type: String, 
    required: true 
  },
  type: { 
    type: String, 
    required: true,
    enum: Object.values(GraphNodeType)
  },
  neuronId: { 
    type: String, 
    default: null 
  },
  config: { 
    type: Schema.Types.Mixed, 
    default: {} 
  }
}, { _id: false });

/**
 * Graph edge schema (embedded subdocument)
 */
const graphEdgeSchema = new Schema({
  from: { 
    type: String, 
    required: true 
  },
  to: { 
    type: String 
  },
  condition: { 
    type: String 
  },
  targets: { 
    type: Map, 
    of: String 
  },
  fallback: { 
    type: String 
  }
}, { _id: false });

/**
 * Graph global config schema (embedded subdocument)
 */
const graphConfigSchema = new Schema({
  maxReplans: { 
    type: Number, 
    default: 3 
  },
  maxSearchIterations: { 
    type: Number, 
    default: 5 
  },
  timeout: { 
    type: Number, 
    default: 300 
  },
  enableFastpath: { 
    type: Boolean, 
    default: true 
  },
  defaultNeuronRole: { 
    type: String, 
    enum: ['chat', 'worker', 'specialist'],
    default: 'chat'
  }
}, { _id: false });

/**
 * Node layout position schema (for Studio visual editor)
 */
const nodePositionSchema = new Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true }
}, { _id: false });

/**
 * Share permission schema (for collaborative editing)
 */
const sharePermissionSchema = new Schema({
  userId: { type: String, required: true },
  permission: { 
    type: String, 
    enum: ['view', 'edit'],
    default: 'view'
  },
  sharedAt: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Main graph schema
 */
const graphSchema = new Schema<GraphDocument>({
  graphId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  userId: { 
    type: String, 
    required: true,
    index: true,
    default: 'system'
  },
  isDefault: { 
    type: Boolean, 
    default: false,
    index: true
  },
  name: { 
    type: String, 
    required: true 
  },
  description: { 
    type: String 
  },
  tier: { 
    type: Number, 
    required: true,
    index: true,
    default: 4, // FREE tier
    validate: {
      validator: (v: number) => v >= 0 && v <= 4,
      message: 'Tier must be between 0 (ADMIN) and 4 (FREE)'
    }
  },
  version: { 
    type: String, 
    default: '1.0.0' 
  },
  
  // Graph structure
  nodes: { 
    type: [graphNodeSchema], 
    required: true,
    validate: {
      validator: (v: any[]) => v && v.length > 0,
      message: 'Graph must have at least one node'
    }
  },
  edges: { 
    type: [graphEdgeSchema], 
    required: true,
    validate: {
      validator: (v: any[]) => v && v.length > 0,
      message: 'Graph must have at least one edge'
    }
  },
  
  // Configuration
  neuronAssignments: { 
    type: Map, 
    of: String,
    default: {}
  },
  config: { 
    type: graphConfigSchema,
    default: {}
  },
  
  // Studio Layout (Phase 3)
  layout: {
    type: Map,
    of: nodePositionSchema,
    default: {}
  },
  thumbnail: {
    type: String,
    default: null
  },
  
  // Sharing & Discovery (Phase 3)
  isPublic: {
    type: Boolean,
    default: false,
    index: true
  },
  forkedFrom: {
    type: String,
    default: null,
    index: true
  },
  tags: {
    type: [String],
    default: [],
    index: true
  },
  sharedWith: {
    type: [sharePermissionSchema],
    default: []
  },
  
  // Metadata
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  usageCount: { 
    type: Number, 
    default: 0 
  }
}, {
  timestamps: true,
  collection: 'graphs'
});

// Indexes for efficient querying
graphSchema.index({ graphId: 1 }, { unique: true });
graphSchema.index({ userId: 1, isDefault: 1 });
graphSchema.index({ userId: 1, tier: 1 });
graphSchema.index({ tier: 1 });

/**
 * Pre-save validation: Ensure node IDs are unique within the graph
 */
graphSchema.pre('save', function(next) {
  const nodeIds = this.nodes.map((n: any) => n.id);
  const uniqueIds = new Set(nodeIds);
  
  if (nodeIds.length !== uniqueIds.size) {
    const duplicates = nodeIds.filter((id: string, index: number) => 
      nodeIds.indexOf(id) !== index
    );
    return next(new Error(`Duplicate node IDs found in graph: ${duplicates.join(', ')}`));
  }
  
  next();
});

/**
 * Pre-save validation: Ensure edges reference valid nodes
 */
graphSchema.pre('save', function(next) {
  const nodeIds = new Set(this.nodes.map((n: any) => n.id));
  nodeIds.add('__start__');
  nodeIds.add('__end__');
  
  for (const edge of this.edges) {
    // Validate 'from' node
    if (!nodeIds.has(edge.from)) {
      return next(new Error(`Edge references unknown source node: ${edge.from}`));
    }
    
    // Validate 'to' node (if specified)
    if (edge.to && !nodeIds.has(edge.to)) {
      return next(new Error(`Edge references unknown target node: ${edge.to}`));
    }
    
    // Validate all target nodes in conditional edges
    if (edge.targets && typeof edge.targets === 'object') {
      for (const [key, target] of Object.entries(edge.targets)) {
        // Skip Mongoose internal fields that start with $
        if (key.startsWith('$') || key.startsWith('_')) continue;
        if (typeof target === 'string' && !nodeIds.has(target)) {
          return next(new Error(`Edge references unknown target node in condition '${key}': ${target}`));
        }
      }
    }
    
    // Validate fallback node
    if (edge.fallback && !nodeIds.has(edge.fallback)) {
      return next(new Error(`Edge references unknown fallback node: ${edge.fallback}`));
    }
  }
  
  next();
});

/**
 * Pre-save validation: Update timestamp
 */
graphSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

/**
 * Instance method: Increment usage count
 */
graphSchema.methods.incrementUsage = async function() {
  this.usageCount = (this.usageCount || 0) + 1;
  await this.save();
};

/**
 * Static method: Find graphs accessible by user based on tier
 */
graphSchema.statics.findAccessibleByUser = async function(userId: string, userTier: number) {
  return this.find({
    $or: [
      { userId: userId }, // User's custom graphs
      { userId: 'system', tier: { $gte: userTier } } // System graphs user can access
    ]
  }).sort({ isDefault: -1, name: 1 });
};

/**
 * Export the Graph model
 * Use models.Graph if already compiled (hot reload), otherwise compile new model
 */
import { models } from 'mongoose';
export const Graph = models.Graph || model<GraphDocument>('Graph', graphSchema);
