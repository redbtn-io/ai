/**
 * ToolRegistry MongoDB Model
 * 
 * Workers register their available tools on startup.
 * Webapp queries this collection to show available tools without needing MCP.
 */

import mongoose, { Schema, Document } from 'mongoose';

/**
 * Tool input schema definition
 */
export interface IToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
}

/**
 * Individual tool definition
 */
export interface IRegisteredTool {
  name: string;
  description?: string;
  inputSchema?: IToolInputSchema;
}

/**
 * Tool server registration
 */
export interface IToolServer {
  serverName: string;
  source: 'global' | 'custom';
  connectionId?: string;
  tools: IRegisteredTool[];
}

/**
 * Tool registry document interface
 */
export interface IToolRegistry {
  nodeId: string;              // Worker node that registered these tools
  userId?: string;             // For user-specific custom tools (null = global)
  servers: IToolServer[];      // Tools grouped by server
  registeredAt: Date;
  lastHeartbeat: Date;
  isActive: boolean;
}

export interface ToolRegistryDocument extends IToolRegistry, Document {}

const ToolInputSchemaDefinition = new Schema<IToolInputSchema>(
  {
    type: { type: String, required: true },
    properties: { type: Schema.Types.Mixed },
    required: { type: [String] },
    description: String,
  },
  { _id: false }
);

const RegisteredToolSchema = new Schema<IRegisteredTool>(
  {
    name: { type: String, required: true },
    description: String,
    inputSchema: ToolInputSchemaDefinition,
  },
  { _id: false }
);

const ToolServerSchema = new Schema<IToolServer>(
  {
    serverName: { type: String, required: true },
    source: { type: String, enum: ['global', 'custom'], required: true },
    connectionId: String,
    tools: [RegisteredToolSchema],
  },
  { _id: false }
);

const ToolRegistrySchema = new Schema<ToolRegistryDocument>(
  {
    nodeId: { type: String, required: true, index: true },
    userId: { type: String, sparse: true, index: true },
    servers: [ToolServerSchema],
    registeredAt: { type: Date, default: Date.now },
    lastHeartbeat: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    collection: 'toolregistries',
  }
);

// Compound index for efficient queries
ToolRegistrySchema.index({ nodeId: 1, userId: 1 }, { unique: true });
ToolRegistrySchema.index({ isActive: 1, userId: 1 });

// TTL index to auto-cleanup stale registrations (inactive for 5 minutes)
ToolRegistrySchema.index(
  { lastHeartbeat: 1 },
  { expireAfterSeconds: 300, partialFilterExpression: { isActive: false } }
);

/**
 * Register or update tools for a worker node
 */
ToolRegistrySchema.statics.registerTools = async function(
  nodeId: string,
  servers: IToolServer[],
  userId?: string
): Promise<ToolRegistryDocument> {
  return this.findOneAndUpdate(
    { nodeId, userId: userId || null },
    {
      $set: {
        servers,
        registeredAt: new Date(),
        lastHeartbeat: new Date(),
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );
};

/**
 * Update heartbeat for a worker node
 */
ToolRegistrySchema.statics.heartbeat = async function(
  nodeId: string,
  userId?: string
): Promise<void> {
  await this.updateOne(
    { nodeId, userId: userId || null },
    { $set: { lastHeartbeat: new Date(), isActive: true } }
  );
};

/**
 * Mark a worker node as inactive
 */
ToolRegistrySchema.statics.deactivate = async function(
  nodeId: string,
  userId?: string
): Promise<void> {
  await this.updateOne(
    { nodeId, userId: userId || null },
    { $set: { isActive: false } }
  );
};

/**
 * Get all active tools (global + user-specific if userId provided)
 */
ToolRegistrySchema.statics.getActiveTools = async function(
  userId?: string
): Promise<{ tools: Array<IRegisteredTool & { serverName: string; source: string; connectionId?: string }>; toolsByServer: IToolServer[] }> {
  // Build query - use FilterQuery type to allow MongoDB operators
  type ToolRegistryFilter = {
    isActive: boolean;
    userId?: string | null | { $in: (string | null)[] };
  };
  
  const query: ToolRegistryFilter = { isActive: true };
  
  if (userId) {
    // Include global tools (userId = null) and user-specific tools
    query.userId = { $in: [null, userId] };
  } else {
    // Only global tools
    query.userId = null;
  }
  
  const registrations = await this.find(query).lean();
  
  // Merge tools from all active workers, deduplicating by tool name
  const toolsMap = new Map<string, IRegisteredTool & { serverName: string; source: string; connectionId?: string }>();
  const serversMap = new Map<string, IToolServer>();
  
  for (const reg of registrations) {
    for (const server of reg.servers) {
      // For servers, use serverName + source as key
      const serverKey = `${server.serverName}:${server.source}:${server.connectionId || ''}`;
      
      if (!serversMap.has(serverKey)) {
        serversMap.set(serverKey, { ...server });
      }
      
      // For individual tools, use name as key (first registration wins)
      for (const tool of server.tools) {
        if (!toolsMap.has(tool.name)) {
          toolsMap.set(tool.name, {
            ...tool,
            serverName: server.serverName,
            source: server.source,
            connectionId: server.connectionId,
          });
        }
      }
    }
  }
  
  return {
    tools: Array.from(toolsMap.values()),
    toolsByServer: Array.from(serversMap.values()),
  };
};

// Add static methods to the model interface
export interface IToolRegistryModel extends mongoose.Model<ToolRegistryDocument> {
  registerTools(nodeId: string, servers: IToolServer[], userId?: string): Promise<ToolRegistryDocument>;
  heartbeat(nodeId: string, userId?: string): Promise<void>;
  deactivate(nodeId: string, userId?: string): Promise<void>;
  getActiveTools(userId?: string): Promise<{ 
    tools: Array<IRegisteredTool & { serverName: string; source: string; connectionId?: string }>; 
    toolsByServer: IToolServer[] 
  }>;
}

export const ToolRegistry = (mongoose.models.ToolRegistry as IToolRegistryModel) || 
  mongoose.model<ToolRegistryDocument, IToolRegistryModel>('ToolRegistry', ToolRegistrySchema);

export default ToolRegistry;
