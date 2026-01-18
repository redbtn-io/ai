/**
 * Node Model
 * 
 * Stores node configurations as JSON in MongoDB.
 * Collection name: nodes
 */

import mongoose from 'mongoose';

/**
 * Parameter Definition Schema
 * Defines an exposed parameter that can be customized at the graph level
 */
const ParameterDefinitionSchema = new mongoose.Schema({
  // Parameter type
  type: {
    type: String,
    enum: ['string', 'number', 'boolean', 'select', 'json'],
    required: true
  },
  
  // Default value (used when graph doesn't override)
  default: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  
  // Human-readable description
  description: {
    type: String,
    default: ''
  },
  
  // For number type: minimum value
  min: {
    type: Number,
    default: null
  },
  
  // For number type: maximum value
  max: {
    type: Number,
    default: null
  },
  
  // For select type: allowed values
  enum: {
    type: [mongoose.Schema.Types.Mixed],
    default: null
  },
  
  // Whether this parameter is required (no default fallback)
  required: {
    type: Boolean,
    default: false
  },
  
  // Which step index this parameter applies to (for UI hints)
  // If null, parameter is used in template rendering across all steps
  stepIndex: {
    type: Number,
    default: null
  },
  
  // The path within step config where this parameter is used
  // e.g., "config.temperature" or "config.systemPrompt"
  configPath: {
    type: String,
    default: null
  }
}, { _id: false });

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
  
  // Tags for flexible categorization (user-defined)
  tags: {
    type: [String],
    default: [],
    index: true
  },
  
  // Owner (system or user ID)
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // Original creator (never changes, used for attribution)
  creatorId: {
    type: String,
    index: true
  },
  
  // Owner's display name (denormalized for easy display)
  ownerName: {
    type: String,
    default: 'System'
  },
  
  // Node status: active, abandoned, or deleted
  status: {
    type: String,
    enum: ['active', 'abandoned', 'deleted'],
    default: 'active',
    index: true
  },
  
  // When the node was abandoned (for cleanup scheduling)
  abandonedAt: {
    type: Date,
    default: null
  },
  
  // Scheduled hard deletion date (90 days after abandon if no forks/usage)
  scheduledDeletionAt: {
    type: Date,
    default: null,
    index: true
  },
  
  // Is this a system-provided node?
  isSystem: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Is this node immutable? (system nodes are always immutable)
  // When true, editing creates a clone instead of modifying in place
  isImmutable: {
    type: Boolean,
    default: false
  },
  
  // Is this node public (visible to all users)?
  // Default is true (public). Private nodes are a paid feature (PRO tier or better).
  isPublic: {
    type: Boolean,
    default: true,
    index: true
  },
  
  // If this node was derived/cloned from another node
  parentNodeId: {
    type: String,
    default: null,
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
  
  // Exposed parameters that can be customized at graph level
  // Map of parameter name -> parameter definition
  parameters: {
    type: Map,
    of: ParameterDefinitionSchema,
    default: new Map()
  },
  
  // Usage statistics
  stats: {
    // How many times this node has been executed
    usageCount: {
      type: Number,
      default: 0
    },
    // How many times this node has been forked
    forkCount: {
      type: Number,
      default: 0
    },
    // When was this node last used
    lastUsedAt: {
      type: Date,
      default: null
    }
  },
  
  // Metadata (for migration/internal tracking and UI display)
  metadata: {
    // Display icon (lucide icon name)
    icon: String,
    
    // Display color (hex code, e.g. "#8B5CF6")
    color: String,
    
    // Node inputs
    inputs: {
      type: [String],
      default: ['state']
    },
    
    // Node outputs
    outputs: {
      type: [String],
      default: ['state']
    },
    
    // Original TypeScript file (for migration reference)
    originalFile: String,
    
    // Migration date
    migratedAt: Date,
    
    // Lines of code saved
    linesReduced: Number,
    
    // Legacy category field (deprecated, use tags instead)
    legacyCategory: String
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

// Text search index for full-text search
NodeSchema.index({ name: 'text', description: 'text', tags: 'text' });

// Indexes for efficient queries
NodeSchema.index({ userId: 1, isSystem: 1 });
NodeSchema.index({ tags: 1, isSystem: 1 });
NodeSchema.index({ isPublic: 1, isSystem: 1 });
NodeSchema.index({ 'stats.usageCount': -1 });
NodeSchema.index({ 'stats.lastUsedAt': -1 });
NodeSchema.index({ createdAt: -1 });

// Export model - uses 'nodes' collection
export const NodeModel = 
  mongoose.models.Node || 
  mongoose.model('Node', NodeSchema);

/**
 * TypeScript type for parameter definition
 */
export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'select' | 'json';
  default: any;
  description?: string;
  min?: number | null;
  max?: number | null;
  enum?: any[] | null;
  required?: boolean;
  stepIndex?: number | null;
  configPath?: string | null;
}

/**
 * TypeScript type for node parameters map
 */
export type NodeParameters = Record<string, ParameterDefinition>;

/**
 * TypeScript type for resolved parameter values
 */
export type ResolvedParameters = Record<string, any>;

/**
 * Validate a single parameter value against its definition
 * @returns null if valid, error message if invalid
 */
export function validateParameterValue(
  name: string,
  value: any,
  definition: ParameterDefinition
): string | null {
  // Check type
  switch (definition.type) {
    case 'string':
      if (typeof value !== 'string') {
        return `Parameter "${name}" must be a string, got ${typeof value}`;
      }
      break;
      
    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return `Parameter "${name}" must be a number, got ${typeof value}`;
      }
      if (definition.min !== null && definition.min !== undefined && value < definition.min) {
        return `Parameter "${name}" must be >= ${definition.min}, got ${value}`;
      }
      if (definition.max !== null && definition.max !== undefined && value > definition.max) {
        return `Parameter "${name}" must be <= ${definition.max}, got ${value}`;
      }
      break;
      
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Parameter "${name}" must be a boolean, got ${typeof value}`;
      }
      break;
      
    case 'select':
      if (!definition.enum || !definition.enum.includes(value)) {
        return `Parameter "${name}" must be one of [${definition.enum?.join(', ')}], got ${value}`;
      }
      break;
      
    case 'json':
      // JSON can be any valid value, just ensure it's not undefined
      if (value === undefined) {
        return `Parameter "${name}" must have a value`;
      }
      break;
  }
  
  return null; // Valid
}

/**
 * Validate all parameters against node's parameter definitions
 * @returns Array of error messages (empty if all valid)
 */
export function validateParameters(
  parameterValues: ResolvedParameters,
  parameterDefinitions: NodeParameters
): string[] {
  const errors: string[] = [];
  
  // Check for unknown parameters
  for (const name of Object.keys(parameterValues)) {
    if (!parameterDefinitions[name]) {
      errors.push(`Unknown parameter "${name}" - not defined in node`);
    }
  }
  
  // Validate each defined parameter
  for (const [name, definition] of Object.entries(parameterDefinitions)) {
    const value = parameterValues[name];
    
    // Check required
    if (definition.required && (value === undefined || value === null)) {
      errors.push(`Parameter "${name}" is required`);
      continue;
    }
    
    // Skip validation if value is not provided (will use default)
    if (value === undefined || value === null) {
      continue;
    }
    
    // Validate value
    const error = validateParameterValue(name, value, definition);
    if (error) {
      errors.push(error);
    }
  }
  
  return errors;
}

/**
 * Resolve parameters by merging graph-level overrides with node defaults
 * @param parameterDefinitions Node's parameter definitions
 * @param graphParameters Parameter values provided by the graph
 * @returns Resolved parameter values (defaults + overrides)
 */
export function resolveParameters(
  parameterDefinitions: NodeParameters,
  graphParameters: ResolvedParameters = {}
): ResolvedParameters {
  const resolved: ResolvedParameters = {};
  
  for (const [name, definition] of Object.entries(parameterDefinitions)) {
    // Use graph value if provided, otherwise use default
    if (graphParameters[name] !== undefined) {
      resolved[name] = graphParameters[name];
    } else {
      resolved[name] = definition.default;
    }
  }
  
  return resolved;
}

/**
 * Convert Mongoose Map to plain object for parameter definitions
 */
export function parametersMapToObject(parametersMap: Map<string, any> | any): NodeParameters {
  if (!parametersMap) return {};
  
  // If it's already a plain object, return as-is
  if (typeof parametersMap === 'object' && !(parametersMap instanceof Map)) {
    // Check if it's a Mongoose Map-like object with entries()
    if (typeof parametersMap.entries === 'function') {
      const result: NodeParameters = {};
      for (const [key, value] of parametersMap.entries()) {
        result[key] = value;
      }
      return result;
    }
    return parametersMap as NodeParameters;
  }
  
  // Convert Map to object
  const result: NodeParameters = {};
  for (const [key, value] of parametersMap.entries()) {
    result[key] = value;
  }
  return result;
}

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

/**
 * Get a node config with user priority resolution
 * 
 * Resolution order:
 * 1. User's own node with matching nodeId (could be a clone or custom node)
 * 2. System node with matching nodeId
 * 
 * @param nodeId The node identifier
 * @param userId The user ID (optional - if not provided, only system nodes are checked)
 */
export async function getNodeConfigForUser(nodeId: string, userId?: string): Promise<any | null> {
  if (userId) {
    // First try to find user's own node
    const userNode = await NodeModel.findOne({ nodeId, userId }).lean();
    if (userNode) {
      return userNode;
    }
  }
  
  // Fall back to system node
  return NodeModel.findOne({ nodeId, isSystem: true }).lean();
}

/**
 * Clone a node for a user with applied changes
 * 
 * @param sourceNodeId The node to clone from
 * @param userId The user who will own the clone
 * @param overrides Fields to override in the clone
 * @param newNodeId Optional custom nodeId for the clone (defaults to sourceNodeId-userId suffix)
 */
export async function cloneNodeForUser(
  sourceNodeId: string,
  userId: string,
  overrides: Partial<any> = {},
  newNodeId?: string
): Promise<any> {
  // Get the source node (could be system or another user's node)
  const sourceNode = await NodeModel.findOne({ nodeId: sourceNodeId }).lean();
  
  if (!sourceNode) {
    throw new Error(`Source node '${sourceNodeId}' not found`);
  }
  
  // Generate new nodeId if not provided
  const clonedNodeId = newNodeId || `${sourceNodeId}-${userId.slice(-6)}`;
  
  // Check if clone already exists
  const existingClone = await NodeModel.findOne({ nodeId: clonedNodeId, userId });
  if (existingClone) {
    // Update existing clone
    Object.assign(existingClone, overrides);
    existingClone.version += 1;
    existingClone.updatedAt = new Date();
    return existingClone.save();
  }
  
  // Increment fork count on source node
  await NodeModel.updateOne(
    { nodeId: sourceNodeId },
    { $inc: { 'stats.forkCount': 1 } }
  );
  
  // Create new clone
  const cloneData = {
    ...sourceNode,
    _id: undefined, // Let MongoDB generate new _id
    nodeId: clonedNodeId,
    userId,
    isSystem: false,
    isImmutable: false,
    isPublic: true, // Default to public (user can change if they have paid tier)
    parentNodeId: sourceNodeId,
    version: 1,
    stats: { usageCount: 0, forkCount: 0, lastUsedAt: null },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
  
  return NodeModel.create(cloneData);
}

/**
 * Record usage of a node (call when node is executed)
 */
export async function recordNodeUsage(nodeId: string): Promise<void> {
  await NodeModel.updateOne(
    { nodeId },
    { 
      $inc: { 'stats.usageCount': 1 },
      $set: { 'stats.lastUsedAt': new Date() }
    }
  );
}

/**
 * Search nodes with filters and sorting
 */
export interface NodeSearchOptions {
  // Text search query (searches name, description, tags)
  query?: string;
  // Filter by specific tags
  tags?: string[];
  // Filter by owner
  userId?: string;
  // Include system nodes
  includeSystem?: boolean;
  // Include public nodes from other users
  includePublic?: boolean;
  // Filter by parent node (find all forks of a node)
  parentNodeId?: string;
  // Date range filters
  createdAfter?: Date;
  createdBefore?: Date;
  // Sorting
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'usageCount' | 'forkCount' | 'lastUsedAt';
  sortOrder?: 'asc' | 'desc';
  // Pagination
  limit?: number;
  offset?: number;
  // Status filter (default: active only)
  status?: 'active' | 'abandoned' | 'all';
}

export async function searchNodes(options: NodeSearchOptions = {}): Promise<{ nodes: any[]; total: number }> {
  const {
    query,
    tags,
    userId,
    includeSystem = true,
    includePublic = true,
    parentNodeId,
    createdAfter,
    createdBefore,
    sortBy = 'name',
    sortOrder = 'asc',
    limit = 50,
    offset = 0,
    status = 'active'
  } = options;
  
  // Build query conditions
  const conditions: any[] = [];
  
  // Visibility: user's own nodes + system nodes + public nodes
  const visibilityConditions: any[] = [];
  if (userId) {
    visibilityConditions.push({ userId });
  }
  if (includeSystem) {
    visibilityConditions.push({ isSystem: true });
  }
  if (includePublic) {
    visibilityConditions.push({ isPublic: true, isSystem: false });
  }
  if (visibilityConditions.length > 0) {
    conditions.push({ $or: visibilityConditions });
  }
  
  // Status filter (exclude abandoned/deleted by default)
  if (status === 'active') {
    // Include nodes without status field (legacy) or with active status
    conditions.push({
      $or: [
        { status: 'active' },
        { status: { $exists: false } }
      ]
    });
  } else if (status === 'abandoned') {
    conditions.push({ status: 'abandoned' });
  }
  // If status === 'all', don't add any status filter
  
  // Text search - use regex for partial matching (more flexible than $text)
  if (query) {
    // Escape special regex characters and create case-insensitive pattern
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedQuery, 'i');
    
    // Search in name, description, and tags with partial matching
    conditions.push({
      $or: [
        { name: searchRegex },
        { description: searchRegex },
        { tags: searchRegex }
      ]
    });
  }
  
  // Tag filter
  if (tags && tags.length > 0) {
    conditions.push({ tags: { $in: tags } });
  }
  
  // Parent node filter (find forks)
  if (parentNodeId) {
    conditions.push({ parentNodeId });
  }
  
  // Date range
  if (createdAfter || createdBefore) {
    const dateCondition: any = {};
    if (createdAfter) dateCondition.$gte = createdAfter;
    if (createdBefore) dateCondition.$lte = createdBefore;
    conditions.push({ createdAt: dateCondition });
  }
  
  const filter = conditions.length > 0 ? { $and: conditions } : {};
  
  // Build sort object
  const sortFields: Record<string, string> = {
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    usageCount: 'stats.usageCount',
    forkCount: 'stats.forkCount',
    lastUsedAt: 'stats.lastUsedAt'
  };
  const sort: any = { [sortFields[sortBy] || 'name']: sortOrder === 'desc' ? -1 : 1 };
  
  const [nodes, total] = await Promise.all([
    NodeModel.find(filter)
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .lean(),
    NodeModel.countDocuments(filter)
  ]);
  
  return { nodes, total };
}

/**
 * Get all unique tags used across nodes (for tag suggestions)
 */
export async function getAllTags(userId?: string): Promise<string[]> {
  const match: any = {};
  if (userId) {
    match.$or = [
      { userId },
      { isSystem: true },
      { isPublic: true }
    ];
  }
  
  const result = await NodeModel.aggregate([
    { $match: match },
    { $unwind: '$tags' },
    { $group: { _id: '$tags' } },
    { $sort: { _id: 1 } }
  ]);
  
  return result.map(r => r._id);
}

// Re-export with old names for backwards compatibility
export const UniversalNodeConfigModel = NodeModel;
export const getUniversalNodeConfig = getNodeConfig;
export const listSystemUniversalNodes = listSystemNodes;
export const listUserUniversalNodes = listUserNodes;
export const saveUniversalNodeConfig = saveNodeConfig;
