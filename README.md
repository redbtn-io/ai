# Red AI Library (`@redbtn/ai`)

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.3.x-green.svg)](https://langchain-ai.github.io/langgraphjs/)

> A dynamic, graph-based AI agent library built on LangChain and LangGraph with MCP (Model Context Protocol) integration, per-user model configuration, and tier-based access control. Provides intelligent routing, persistent memory, and unified streaming/non-streaming interfaces.

---

## Table of Contents

1. [Features](#-features)
2. [Architecture Overview](#-architecture-overview)
3. [Workspace Layout](#-workspace-layout)
4. [Quick Start](#-quick-start)
5. [Core Concepts](#-core-concepts)
6. [API Reference](#-api-reference)
7. [Graph System](#-graph-system)
8. [Neuron System](#-neuron-system)
9. [MCP Protocol](#-mcp-protocol)
10. [Memory System](#-memory-system)
11. [Streaming & Reconnection](#-streaming--reconnection)
12. [Logging System](#-logging-system)
13. [Universal Nodes](#-universal-nodes)
14. [Webapp Integration](#-webapp-integration)
15. [Examples](#-examples)
16. [Environment Variables](#environment-variables)
17. [Development](#-development)
18. [Troubleshooting](#-troubleshooting)

---

## 🚀 Features

### Core Capabilities
- **Dynamic Graph System**: JIT-compiled LangGraph workflows from MongoDB-stored configurations
- **Per-User Neuron Assignment**: Each user can have custom model assignments per graph node
- **Tier-Based Access Control**: Account levels (0-4) control access to graphs, neurons, and features
- **MCP Integration**: Model Context Protocol servers for modular tool management via stdio transport
- **Intelligent Routing**: Confidence-scored routing to chat, web search, URL scraping, or system commands

### Streaming & Memory
- **Unified Streaming API**: Seamless streaming and non-streaming modes with identical interfaces
- **Stream Reconnection**: Redis-backed pub/sub for reliable mobile streaming with full replay
- **Three-Tier Memory**: Redis (hot), MongoDB (persistent), ChromaDB (vectors)
- **Token-Aware Context**: Automatic context management with configurable token limits

### AI Capabilities
- **Web Search & Scraping**: Google Custom Search API + custom content extraction
- **RAG Support**: ChromaDB vector store with Ollama embeddings (nomic-embed-text)
- **Thinking Extraction**: Captures `<think>...</think>` tags from DeepSeek-R1 and similar models
- **Tool Execution Tracking**: Complete history of tool usage with timing and progress

### Multi-Provider Support
- **Ollama**: Local models (default)
- **OpenAI**: GPT-4, GPT-3.5-turbo, etc.
- **Anthropic**: Claude 3, Claude 2
- **Google**: Gemini Pro, Gemini Ultra

### Developer Experience
- **Full TypeScript**: Complete type definitions and type guards
- **Comprehensive Logging**: MongoDB-persisted logs with real-time streaming
- **Network Resilience**: Automatic retry with exponential backoff
- **Extensible Architecture**: Easy to add custom nodes, graphs, and MCP servers

---

## 🏛️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RED AI SYSTEM                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         RED CLASS (index.ts)                          │   │
│  │  • load(nodeId?) - Initialize registries, MCP, memory                │   │
│  │  • respond(query, options) - Main entry point for AI responses       │   │
│  │  • think() - Autonomous thinking loop                                │   │
│  │  • shutdown() - Graceful cleanup of child processes                  │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
│  ┌──────────────────────────────┴───────────────────────────────────────┐   │
│  │                       CORE SUBSYSTEMS                                 │   │
│  │                                                                       │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐ │   │
│  │  │  Neuron     │ │   Graph     │ │    MCP      │ │    Memory       │ │   │
│  │  │  Registry   │ │  Registry   │ │  Stdio Pool │ │   Manager       │ │   │
│  │  │             │ │             │ │             │ │                 │ │   │
│  │  │ • getModel()│ │ • getGraph()│ │ • web       │ │ • Redis (hot)   │ │   │
│  │  │ • LRU cache │ │ • JIT build │ │ • system    │ │ • MongoDB       │ │   │
│  │  │ • Per-user  │ │ • LRU cache │ │ • rag       │ │ • ChromaDB      │ │   │
│  │  └─────────────┘ └─────────────┘ │ • context   │ │                 │ │   │
│  │                                  └─────────────┘ └─────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    DYNAMIC GRAPH COMPILATION                          │   │
│  │                                                                       │   │
│  │  MongoDB Config ──→ GraphRegistry ──→ LangGraph StateGraph           │   │
│  │                                                                       │   │
│  │  GraphConfig {                     CompiledGraph {                   │   │
│  │    nodes: [{id, type, neuronId}]     graph: StateGraph               │   │
│  │    edges: [{from, to, condition}]    config: GraphConfig             │   │
│  │    neuronAssignments: {...}        }                                 │   │
│  │  }                                                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      GRAPH NODE TYPES (12)                            │   │
│  │                                                                       │   │
│  │  Routing:      precheck, fastpath, classifier, router                │   │
│  │  Execution:    planner, executor, universal                          │   │
│  │  Communication: responder, respond                                   │   │
│  │  Tools:        search, scrape, command, context                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧭 Workspace Layout

This package is part of a monorepo workspace:

```
@redbtn/
├── ai/                           # This package - LangGraph-based AI library
│   ├── src/
│   │   ├── index.ts             # Red class - main export
│   │   ├── functions/           # Entry point functions
│   │   │   ├── respond.ts       # Main respond function
│   │   │   └── background/      # Background tasks (titles, summaries)
│   │   └── lib/
│   │       ├── graphs/          # Graph compilation & registry
│   │       ├── neurons/         # Model registry & factories
│   │       ├── nodes/           # Graph node implementations
│   │       ├── mcp/             # MCP protocol & servers
│   │       ├── memory/          # Memory, queue, vectors
│   │       ├── models/          # MongoDB schemas
│   │       ├── types/           # TypeScript type definitions
│   │       ├── logs/            # Logging system
│   │       ├── events/          # Event publishing
│   │       └── utils/           # Utilities (thinking, retry, etc.)
│   └── examples/
│       ├── discord/             # Discord bot example
│       └── rest-server/         # OpenAI-compatible REST API
│
├── webapp/                       # Next.js 15 chat application
│   ├── src/
│   │   ├── app/                 # App router pages
│   │   │   ├── page.tsx         # Main chat interface
│   │   │   ├── api/             # API routes (v1/chat/completions, etc.)
│   │   │   ├── explore/         # Graphs, neurons, nodes browser
│   │   │   ├── studio/          # Visual graph editor
│   │   │   └── logs/            # Log viewer with terminal UI
│   │   ├── components/          # React components
│   │   ├── contexts/            # Auth & Conversation contexts
│   │   ├── lib/                 # Utilities & stores
│   │   └── hooks/               # Custom hooks
│   └── public/                  # Static assets
│
├── scripts/                     # Shared automation scripts
├── explanations/                # Project documentation (non-README markdown)
└── run.sh                       # Quick start script
```

### Documentation Policy

Every markdown file that is **not** a README belongs under `/explanations`. The pre-commit hook enforces this:

```bash
# Setup git hooks (once per clone)
git config core.hooksPath .githooks

# Manual cleanup if needed
./scripts/pre-commit-cleanup.sh ./ai
```

## 📦 Installation

```bash
npm install @redbtn/ai
```

## 🏁 Quick Start

### Prerequisites

Ensure these services are running:

| Service | Default URL | Purpose |
|---------|-------------|---------|
| Redis | `redis://localhost:6379` | Hot state, pub/sub streaming, message queue |
| MongoDB | `mongodb://localhost:27017/redbtn` | Persistent storage (messages, logs, configs) |
| ChromaDB | `http://localhost:8024` | Vector store for RAG embeddings |
| Ollama | `http://localhost:11434` | LLM inference (default provider) |

```bash
# Start services (example with Docker)
docker run -d -p 6379:6379 redis
docker run -d -p 27017:27017 mongo
docker run -d -p 8024:8000 chromadb/chroma
ollama serve
```

### Basic Usage

```typescript
import { Red, RedConfig } from '@redbtn/ai';

// Configuration
const config: RedConfig = {
  redisUrl: "redis://localhost:6379",
  vectorDbUrl: "http://localhost:8024",
  databaseUrl: "mongodb://localhost:27017/redbtn",
  chatLlmUrl: "http://localhost:11434",  // Primary chat model
  workLlmUrl: "http://localhost:11434"   // Worker model (routing/tools)
};

// Initialize
const red = new Red(config);
await red.load("my-node-id");  // Optional node ID for distributed systems

// Non-streaming response
const response = await red.respond(
  { message: 'Hello!' },
  { 
    conversationId: 'conv_123',
    userId: 'user_456'  // Required for per-user model loading
  }
);

console.log(response.content);         // "Hello! How can I help?"
console.log(response.usage_metadata);  // { input_tokens: 10, output_tokens: 5, ... }

// Streaming response
const stream = await red.respond(
  { message: 'Search for TypeScript tutorials' },
  { 
    stream: true, 
    conversationId: 'conv_456',
    userId: 'user_789'
  }
);

for await (const chunk of stream) {
  if (typeof chunk === 'object' && chunk._metadata) {
    console.log('Conversation:', chunk.conversationId);
  } else if (typeof chunk === 'string') {
    process.stdout.write(chunk);
  } else {
    // Final AIMessage with token metadata
    console.log('\nTokens:', chunk.usage_metadata);
  }
}

// Graceful shutdown (kills MCP child processes)
await red.shutdown();
```

### Web Search Example

```typescript
// Router automatically detects web search intent
const response = await red.respond(
  { message: 'What is the weather in San Francisco today?' },
  { userId: 'user_123' }
);

// Flow: Router → Search Node (MCP web_search) → Responder
console.log(response.content);
```

## 📚 Core Concepts

### The Red Class

The `Red` class is the main entry point. It orchestrates all subsystems:

```typescript
// From src/index.ts
class Red {
  // Subsystems (accessible after load())
  public neuronRegistry: NeuronRegistry;    // Model management
  public graphRegistry: GraphRegistry;      // Graph compilation
  public memory: MemoryManager;             // Conversation storage
  public messageQueue: MessageQueue;        // Streaming state
  public logger: PersistentLogger;          // MongoDB logging
  public mcpRegistry: McpRegistry;          // Tool registration
  public mcpStdioPool: McpStdioPool;       // MCP server processes

  // Lifecycle
  constructor(config: RedConfig);
  async load(nodeId?: string): Promise<void>;  // Initialize all subsystems
  async respond(query, options): Promise<AIMessage | AsyncGenerator>;
  async think(): Promise<void>;                 // Autonomous thinking loop
  async shutdown(): Promise<void>;              // Graceful cleanup
}
```

### Invoke Options

```typescript
interface InvokeOptions {
  source?: {
    device?: 'phone' | 'speaker' | 'web';
    application?: 'redHome' | 'redChat' | 'redAssistant';
  };
  stream?: boolean;          // Enable streaming mode
  conversationId?: string;   // Auto-generated if omitted: conv_{timestamp}_{random}
  generationId?: string;     // Auto-generated for logging: gen_{timestamp}_{random}
  messageId?: string;        // For Redis pub/sub streaming reconnection
  userId: string;            // REQUIRED - for per-user model loading
  graphId?: string;          // Override default graph (defaults to 'red-assistant')
}
```

### Response Types

**Non-Streaming Mode** (`stream: false` or omitted):
Returns `AIMessage` directly with all metadata.

**Streaming Mode** (`stream: true`):
Returns `AsyncGenerator<string | AIMessage | StreamEvent>`:
1. First yield: `{ _metadata: true, conversationId: string }`
2. Multiple yields: `string` chunks as text arrives
3. Status yields: `{ _status: true, action: string, description: string }`
4. Thinking yields: `{ _thinkingChunk: true, ... }` (for DeepSeek-R1)
5. Tool yields: `{ _toolStatus: true, status: string, action: string }`
6. Final yield: `AIMessage` with complete token data

## 📖 API Reference

### RedConfig

```typescript
interface RedConfig {
  redisUrl: string;        // Redis for state & pub/sub streaming
  vectorDbUrl: string;     // ChromaDB for RAG embeddings (port 8024 default)
  databaseUrl: string;     // MongoDB for persistence
  chatLlmUrl: string;      // Primary chat model endpoint (Ollama)
  workLlmUrl: string;      // Worker model for routing/tools (Ollama)
}
```

### Red Class Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `constructor(config)` | `Red` | Create instance with configuration |
| `load(nodeId?)` | `Promise<void>` | Initialize all subsystems, start MCP servers |
| `respond(query, options)` | `Promise<AIMessage \| AsyncGenerator>` | Process user query |
| `think()` | `Promise<void>` | Start autonomous thinking loop |
| `stopThinking()` | `void` | Signal thinking loop to stop |
| `shutdown()` | `Promise<void>` | Graceful cleanup, kill MCP processes |
| `callMcpTool(name, args, meta)` | `Promise<CallToolResult>` | Direct MCP tool call |

### Red Class Properties (after load())

| Property | Type | Description |
|----------|------|-------------|
| `neuronRegistry` | `NeuronRegistry` | Model factory with LRU caching |
| `graphRegistry` | `GraphRegistry` | Graph compiler with LRU caching |
| `memory` | `MemoryManager` | Conversation history & summaries |
| `messageQueue` | `MessageQueue` | Streaming state & reconnection |
| `logger` | `PersistentLogger` | MongoDB-persisted logging |
| `mcpRegistry` | `McpRegistry` | Registered MCP tools |
| `mcpStdioPool` | `McpStdioPool` | MCP server child processes |

---

## 🔀 Graph System

Graphs define the AI workflow. They are stored in MongoDB and compiled to LangGraph StateGraph instances at runtime (JIT compilation).

### Graph Configuration Schema

```typescript
interface GraphConfig {
  graphId: string;         // Unique identifier (e.g., "red-assistant")
  userId: string;          // Owner ("system" for defaults, user ID for custom)
  isDefault: boolean;      // System default graph
  name: string;            // Display name
  description?: string;    // User-facing description
  tier: number;            // Minimum account level (0=admin, 4=free)
  
  nodes: GraphNodeConfig[];     // Node definitions
  edges: GraphEdgeConfig[];     // Edge connections
  
  neuronAssignments?: {         // Per-node model overrides
    [nodeId: string]: string;   // nodeId → neuronId
  };
  
  globalConfig?: {
    maxReplans?: number;        // Planner iteration limit (default: 3)
    maxSearchIterations?: number; // Search loop limit (default: 5)
    timeout?: number;           // Max execution seconds (default: 300)
    enableFastpath?: boolean;   // Pattern matching bypass (default: true)
    defaultNeuronRole?: 'chat' | 'worker' | 'specialist';
  };
  
  layout?: {                    // Visual editor positions
    [nodeId: string]: { x: number; y: number };
  };
}
```

### Graph Node Types (12 total)

| Type | Purpose | Category |
|------|---------|----------|
| `precheck` | Pattern matching for fast bypass | Routing |
| `fastpath` | Direct response without LLM | Routing |
| `classifier` | Categorize user intent | Routing |
| `router` | Confidence-scored path selection | Routing |
| `planner` | Break down complex tasks | Execution |
| `executor` | Execute planned steps | Execution |
| `universal` | Config-driven multi-step node | Execution |
| `responder` | Generate final LLM response | Communication |
| `context` | Load conversation history | Infrastructure |
| `search` | Web search via MCP | Tools |
| `scrape` | URL content extraction via MCP | Tools |
| `command` | System command execution via MCP | Tools |

### Edge Configuration

```typescript
// Simple edge (direct connection)
{ from: "router", to: "responder" }

// Conditional edge (branching)
{
  from: "router",
  condition: "route",
  targets: {
    "chat": "responder",
    "search": "search_node",
    "scrape": "scrape_node",
    "command": "command_node"
  },
  fallback: "responder"
}

// Start/End special edges
{ from: "__start__", to: "router" }
{ from: "responder", to: "__end__" }
```

### System Default Graphs

```typescript
// From src/lib/types/graph.ts
export const SYSTEM_TEMPLATES = {
  SIMPLE: 'red-chat',        // Direct chat (router → responder)
  DEFAULT: 'red-assistant',  // Full assistant with tools
} as const;
```

### Graph Registry (LRU Cache)

```typescript
// From src/lib/graphs/GraphRegistry.ts
const CACHE_CONFIG = {
  compiledGraphs: 50,    // Max compiled graphs in memory
  configs: 100,          // Max raw configs cached
  ttl: 5 * 60 * 1000     // 5 minute TTL
};

// Usage
const graph = await red.graphRegistry.getGraph(graphId, userId);
// Returns compiled LangGraph StateGraph ready for invoke()
```

### Graph Compilation Flow

```
MongoDB (GraphConfig) 
    ↓
GraphRegistry.getGraph(graphId, userId)
    ↓
[Cache Hit?] → Return cached CompiledGraph
    ↓ No
Load config from MongoDB
    ↓
Validate user tier access
    ↓
compileGraphFromConfig(config)
    ↓
  - Create StateGraph
  - Add nodes from NODE_REGISTRY
  - Add edges (simple + conditional)
  - Compile to runnable graph
    ↓
Cache compiled graph
    ↓
Return CompiledGraph { graph, config }
```

---

## 🧠 Neuron System

Neurons are configurable LLM endpoints. Each user can have custom model assignments.

### Neuron Configuration

```typescript
interface NeuronConfig {
  id: string;                    // Unique ID (e.g., "red-neuron", "user123-gpt4")
  name: string;                  // Display name
  provider: NeuronProvider;      // 'ollama' | 'openai' | 'anthropic' | 'google' | 'custom'
  endpoint: string;              // API base URL
  model: string;                 // Model identifier (e.g., "llama3.2", "gpt-4")
  apiKey?: string;               // Decrypted at runtime (never stored plaintext)
  temperature?: number;          // Default: 0.0
  maxTokens?: number;            // Optional limit
  topP?: number;                 // Nucleus sampling
  role: NeuronRole;              // 'chat' | 'worker' | 'specialist'
  tier: number;                  // Minimum account level to use
  userId?: string;               // Owner ("system" for defaults)
}

type NeuronProvider = 'ollama' | 'openai' | 'anthropic' | 'google' | 'custom';
type NeuronRole = 'chat' | 'worker' | 'specialist';
```

### Neuron Registry

```typescript
// From src/lib/neurons/NeuronRegistry.ts

// Create model instance (fresh per call, no pooling)
const model = await red.neuronRegistry.getModel(neuronId, userId);

// Get config only (cached)
const config = await red.neuronRegistry.getConfig(neuronId, userId);

// Provider factory creates appropriate LangChain model:
// - ChatOllama for 'ollama'
// - ChatOpenAI for 'openai'
// - ChatAnthropic for 'anthropic'
// - ChatGoogleGenerativeAI for 'google'
```

### Per-User Model Loading Flow

```
respond() called with userId
    ↓
Load user settings from MongoDB
    ↓
Get user's default neuronId (or system default)
    ↓
neuronRegistry.getModel(neuronId, userId)
    ↓
[Cache config] Check LRU cache for user:neuronId
    ↓
Load config from MongoDB (user's or system)
    ↓
Validate tier access
    ↓
Create fresh model instance (no pooling)
    ↓
Return BaseChatModel
```

---

## 🔧 MCP Protocol

Red AI uses the Model Context Protocol (MCP) for tool management. Tools run as stdio-based child processes for low-latency internal calls.

### MCP Server Pool

```typescript
// From src/lib/mcp/stdio-pool.ts
// 4 default servers started automatically in load()

const DEFAULT_SERVERS = ['web', 'system', 'rag', 'context'];

class McpStdioPool {
  async start(): Promise<void>;     // Spawn all server processes
  async stop(): Promise<void>;      // Kill all processes
  async callTool(serverName, toolName, args, meta): Promise<CallToolResult>;
  getAllTools(): ToolDefinition[];  // List all registered tools
}
```

### Available MCP Servers & Tools

#### 1. Web Server (`web-stdio.ts`)
```typescript
// Tools for web interaction
{
  name: 'web_search',
  description: 'Search the web using Google Custom Search API',
  inputSchema: {
    query: string,      // Search query
    count?: number      // Results (1-10, default: 10)
  }
}

{
  name: 'scrape_url',
  description: 'Extract clean text content from a URL',
  inputSchema: {
    url: string         // URL to scrape (http/https)
  }
}
```

#### 2. System Server (`system-stdio.ts`)
```typescript
// Whitelisted command execution
{
  name: 'execute_command',
  description: 'Execute safe system commands',
  inputSchema: {
    command: string,    // Command to run
    timeout?: number    // Timeout ms (default: 30000)
  }
}

// Allowed commands:
['ls', 'cat', 'pwd', 'echo', 'date', 'whoami', 
 'find', 'grep', 'head', 'tail', 'wc', 'df', 'du',
 'git', 'npm', 'node', 'python']
```

#### 3. RAG Server (`rag-stdio.ts`)
```typescript
// Vector store operations
{
  name: 'add_to_vector_store',
  description: 'Add documents for semantic search',
  inputSchema: {
    collectionId: string,
    documents: Array<{ content: string, metadata?: object }>
  }
}

{
  name: 'search_vector_store',
  description: 'Semantic search for relevant documents',
  inputSchema: {
    collectionId: string,
    query: string,
    limit?: number      // Default: 5
  }
}
```

#### 4. Context Server (`context-stdio.ts`)
```typescript
// Conversation context management
{
  name: 'get_messages',
  description: 'Retrieve conversation messages',
  inputSchema: {
    conversationId: string,
    limit?: number
  }
}

{
  name: 'store_message',
  description: 'Save message to MongoDB',
  inputSchema: {
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    messageId?: string,
    toolExecutions?: StoredToolExecution[]
  }
}

{
  name: 'get_context_history',
  description: 'Get formatted context for LLM',
  inputSchema: {
    conversationId: string
  }
}

{
  name: 'get_conversation_metadata',
  description: 'Get metadata (count, tokens, etc.)',
  inputSchema: {
    conversationId: string
  }
}

{
  name: 'pattern_matcher',
  description: 'Match patterns for fastpath routing',
  inputSchema: {
    query: string,
    patterns: string[]
  }
}
```

### Calling MCP Tools Directly

```typescript
const result = await red.callMcpTool(
  'web_search',                    // Tool name
  { query: 'TypeScript tutorials' }, // Arguments
  {                                // Metadata context
    conversationId: 'conv_123',
    generationId: 'gen_456',
    messageId: 'msg_789'
  }
);

if (result.isError) {
  console.error('Tool error:', result.content[0].text);
} else {
  const data = JSON.parse(result.content[0].text);
  console.log('Results:', data);
}
```

### MCP Communication Protocol

```
┌─────────────┐         JSON-RPC 2.0          ┌─────────────┐
│  Red Class  │ ────────── stdin ──────────→ │  MCP Server │
│             │ ←───────── stdout ─────────── │  (Child)    │
└─────────────┘                               └─────────────┘

Request:  { jsonrpc: "2.0", method: "tools/call", params: {...}, id: 1 }
Response: { jsonrpc: "2.0", result: { content: [...] }, id: 1 }
```

---

## 💾 Memory System

Three-tier memory architecture for conversation persistence and retrieval.

### Memory Manager (`memory.ts`)

```typescript
// From src/lib/memory/memory.ts

class MemoryManager {
  // Configuration
  private readonly MAX_CONTEXT_TOKENS = 30000;   // Token limit for context
  private readonly SUMMARY_CUSHION_TOKENS = 2000;
  private readonly REDIS_MESSAGE_LIMIT = 100;    // Hot cache limit

  // Core methods
  generateConversationId(seedMessage?: string): string;
  async addMessage(conversationId, message, userId?): Promise<void>;
  async getMessages(conversationId): Promise<ConversationMessage[]>;
  async getContextForConversation(conversationId): Promise<ConversationMessage[]>;
  async getContextSummary(conversationId): Promise<string | null>;
}
```

### Message Storage Flow

```
User sends message
    ↓
addMessage(conversationId, message)
    ↓
Check message ID index (prevent duplicates)
    ↓
Store in Redis list (last 100 messages)
    ↓
Store in MongoDB (permanent)
    ↓
Update conversation metadata
```

### Database Manager (`database.ts`)

Unified MongoDB operations for all collections:

```typescript
// Collections managed
- messages      // Conversation messages with tool executions
- conversations // Conversation metadata
- logs          // System/generation logs (6-month TTL)
- generations   // AI generation tracking
- thoughts      // Thinking/reasoning chains (separate from messages)
- users         // User accounts
- neurons       // Neuron configurations
- graphs        // Graph configurations
- universalnodeconfigs // Universal node configurations
```

### Vector Store Manager (`vectors.ts`)

ChromaDB integration for RAG:

```typescript
// From src/lib/memory/vectors.ts

class VectorStoreManager {
  // Configuration
  private readonly chromaUrl = 'http://localhost:8024';
  private readonly embeddingModel = 'nomic-embed-text';  // Ollama
  private readonly DEFAULT_CHUNK_SIZE = 2000;            // Characters
  private readonly DEFAULT_CHUNK_OVERLAP = 200;
  
  // Methods
  async addDocuments(collectionId, chunks: DocumentChunk[]): Promise<void>;
  async search(collectionId, query, config: SearchConfig): Promise<SearchResult[]>;
  async deleteCollection(collectionId): Promise<void>;
  async listCollections(): Promise<CollectionStats[]>;
}
```

---

## 🔄 Streaming & Reconnection

### MessageQueue (`queue.ts`)

Redis-backed streaming with full reconnection support:

```typescript
// From src/lib/memory/queue.ts

interface MessageGenerationState {
  conversationId: string;
  messageId: string;
  status: 'generating' | 'completed' | 'error';
  content: string;                    // Accumulated content
  thinking?: string;                  // Accumulated thinking
  toolEvents?: any[];                 // Tool events for replay
  startedAt: number;
  completedAt?: number;
  error?: string;
  currentStatus?: {
    action: string;
    description?: string;
    reasoning?: string;               // Router's reasoning
    confidence?: number;              // Router's confidence (0-1)
  };
  metadata?: {
    model?: string;
    tokens?: { input?: number; output?: number; total?: number; };
  };
}

class MessageQueue {
  // Redis key prefixes
  private readonly CONTENT_KEY_PREFIX = 'message:generating:';
  private readonly PUBSUB_PREFIX = 'message:stream:';
  private readonly STATE_TTL = 3600;  // 1 hour TTL

  // Methods
  async startGeneration(conversationId, messageId): Promise<void>;
  async appendContent(messageId, chunk): Promise<void>;
  async publishStatus(messageId, status): Promise<void>;
  async publishThinkingChunk(messageId, chunk): Promise<void>;
  async publishToolEvent(messageId, event): Promise<void>;
  async publishToolStatus(messageId, status): Promise<void>;
  async completeGeneration(messageId, metadata): Promise<void>;
  async failGeneration(messageId, error): Promise<void>;
  
  // Subscription
  async *subscribeToMessage(messageId): AsyncGenerator<StreamEvent>;
  async getGenerationState(messageId): Promise<MessageGenerationState | null>;
}
```

### Reconnection Flow

```
Client disconnects (network/app switch)
    ↓
Generation continues (decoupled from transport)
    ↓
Content accumulates in Redis state
    ↓
Client reconnects
    ↓
subscribeToMessage(messageId)
    ↓
[init event] All accumulated content sent immediately
    ↓
[chunk events] Continue receiving new chunks
    ↓
[complete event] Generation finished
```

### Stream Event Types

```typescript
type StreamEvent =
  | { type: 'init'; existingContent?: string; }
  | { type: 'chunk'; content: string; thinking?: boolean; }
  | { type: 'status'; action: string; description?: string; }
  | { type: 'tool_event'; event: ToolEvent; }
  | { type: 'tool_status'; status: string; action: string; }
  | { type: 'complete'; metadata?: object; }
  | { type: 'error'; error: string; };
```

---

## 📝 Logging System

MongoDB-persisted logging with real-time streaming.

### PersistentLogger

```typescript
// Log levels and categories
type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug' | 'trace';
type LogCategory = 'system' | 'router' | 'mcp' | 'memory' | 'responder' | 'tool';

// Log entry
await red.logger.log({
  level: 'info',
  category: 'router',
  message: 'Query classified as search intent',
  conversationId: 'conv_123',
  generationId: 'gen_456',
  nodeId: 'router',
  metadata: { confidence: 0.95, route: 'search' }
});

// Generation lifecycle tracking
const genId = await red.logger.startGeneration(conversationId);
await red.logger.completeGeneration(genId, {
  response: 'Here are the results...',
  thinking: 'I analyzed the query...',
  route: 'search',
  toolsUsed: ['web_search'],
  model: 'llama3.2',
  tokens: { input: 150, output: 200, total: 350 }
});
// Or on failure:
await red.logger.failGeneration(genId, 'Network timeout');

// Thinking/reasoning storage (separate from messages)
await red.logger.logThought({
  content: 'The user is asking about weather, which requires web search',
  source: 'router',
  conversationId: 'conv_123',
  generationId: 'gen_456',
  messageId: 'msg_789'
});

// Real-time log subscription
for await (const log of red.logger.subscribeToConversation('conv_123')) {
  console.log(`[${log.level}] ${log.category}: ${log.message}`);
}

// Query historical logs
const logs = await red.logger.getLogsForConversation('conv_123', {
  limit: 100,
  level: 'error',
  category: 'tool'
});
```

### Log Storage Schema

```typescript
interface StoredLog {
  logId: string;
  generationId?: string;
  conversationId?: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  timestamp: Date;
  nodeId?: string;
  metadata?: Record<string, any>;
}

// MongoDB indexes for fast queries:
// - conversationId + timestamp
// - generationId
// - level
// - category
// 6-month TTL with automatic cleanup
```

---

## 🔧 Universal Nodes

Config-driven nodes that execute 1-N steps without code deployment. Replace hardcoded nodes with MongoDB-stored configurations.

### Universal Step Types

```typescript
type StepType = 'neuron' | 'tool' | 'transform' | 'conditional' | 'loop';
```

#### Neuron Step (LLM Call)

```typescript
interface NeuronStepConfig {
  neuronId?: string;           // Model to use (default: user's default)
  systemPrompt?: string;       // System message
  userPrompt: string;          // User prompt (supports {{state.field}} templates)
  temperature?: number;        // Default: 0.7
  maxTokens?: number;          // Default: 2000
  outputField: string;         // State field to store response
  stream?: boolean;            // Stream to user? (default: false)
  outputSchema?: object;       // JSON schema for structured output
}
```

#### Tool Step (MCP Call)

```typescript
interface ToolStepConfig {
  toolName: string;            // MCP tool name
  args: Record<string, any>;   // Arguments (supports templates)
  outputField: string;         // State field for result
}
```

#### Transform Step (Data Processing)

```typescript
interface TransformStepConfig {
  operation: 'map' | 'filter' | 'select' | 'merge';
  inputField: string;          // Source state field
  outputField: string;         // Target state field
  // Operation-specific config
  mapTemplate?: string;        // For 'map'
  filterCondition?: string;    // For 'filter'
  selectFields?: string[];     // For 'select'
}
```

#### Conditional Step

```typescript
interface ConditionalStepConfig {
  condition: string;           // JavaScript expression
  thenField: string;           // Field to set if true
  thenValue: any;              // Value if true
  elseField?: string;          // Field to set if false
  elseValue?: any;             // Value if false
}
```

### Universal Node Configuration

```typescript
interface UniversalNodeConfig {
  nodeId: string;              // Unique ID
  name: string;                // Display name
  description: string;         // What this node does
  category: 'routing' | 'execution' | 'transformation' | 'communication' | 'utility';
  userId: string;              // Owner
  isSystem: boolean;           // System-provided?
  version: number;             // For tracking changes
  steps: UniversalStep[];      // Step definitions
}

// Steps execute sequentially, each can read state from previous steps
```

### Example: Multi-Step Universal Node

```typescript
// MongoDB document
{
  nodeId: "summarize-and-respond",
  name: "Summarize & Respond",
  description: "Summarizes research, then generates response",
  category: "communication",
  steps: [
    {
      type: "neuron",
      config: {
        userPrompt: "Summarize: {{state.searchResults}}",
        outputField: "summary",
        stream: false
      }
    },
    {
      type: "neuron",
      config: {
        systemPrompt: "You are a helpful assistant.",
        userPrompt: "Based on this summary: {{state.summary}}\n\nAnswer: {{state.query.message}}",
        outputField: "finalResponse",
        stream: true
      }
    }
  ]
}
```

---

## 🌐 Webapp Integration

The Next.js webapp (`webapp/`) provides a complete chat interface and integrates with the AI library.

### Red Instance Initialization

```typescript
// From webapp/src/lib/red.ts

import { Red, RedConfig } from '@redbtn/ai';

const config: RedConfig = {
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  vectorDbUrl: process.env.VECTOR_DB_URL || "http://localhost:8200",
  databaseUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/redbtn",
  chatLlmUrl: process.env.CHAT_LLM_URL || "http://localhost:11434",
  workLlmUrl: process.env.WORK_LLM_URL || "http://localhost:11434",
};

// Singleton pattern - one Red instance per server
let redInstance: Red | null = null;

export async function getRed(): Promise<Red> {
  if (!redInstance) {
    redInstance = new Red(config);
    await redInstance.load('webapp-api');
  }
  return redInstance;
}

// Graceful shutdown on SIGTERM/SIGINT
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### API Route: `/api/v1/chat/completions`

OpenAI-compatible chat completions endpoint:

```typescript
// POST /api/v1/chat/completions
{
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true,
  "model": "Red",
  "conversationId": "conv_123",  // Optional
  "graphId": "red-assistant"      // Optional - defaults to red-assistant
}

// Response (streaming):
// data: { type: 'init', messageId: 'msg_...', conversationId: 'conv_...' }
// data: { type: 'chunk', content: 'Hello' }
// data: { type: 'chunk', content: '!' }
// data: { type: 'status', action: 'thinking', description: 'Processing...' }
// data: { type: 'complete', metadata: { model: 'llama3.2', tokens: {...} } }
// data: [DONE]
```

### Webapp Pages

| Path | Purpose |
|------|---------|
| `/` | Main chat interface |
| `/explore/graphs` | Browse/search available graphs |
| `/explore/neurons` | Browse/search available neurons (models) |
| `/explore/nodes` | Browse universal node configurations |
| `/studio` | Graph editor home |
| `/studio/new` | Create new graph |
| `/studio/[graphId]` | Visual graph editor (ReactFlow) |
| `/studio/create-node` | Create universal node |
| `/logs` | Real-time log viewer (terminal UI) |

### State Management

**Zustand Stores:**
- `graphStore.ts` - Visual editor state (nodes, edges, selection, undo/redo)

**React Contexts:**
- `AuthContext` - User authentication state
- `ConversationContext` - Conversation list and current conversation

### Key Dependencies

```json
{
  "@redbtn/ai": "file:../ai/redbtn-ai-0.0.1.tgz",
  "next": "15.5.4",
  "react": "19.1.0",
  "reactflow": "^11.11.4",
  "zustand": "^5.0.8",
  "framer-motion": "^12.23.24",
  "mongoose": "^8.19.1",
  "ioredis": "^5.8.2"
}
```

---

## 📋 Examples

### Discord Bot (`examples/discord/`)

Full-featured Discord bot:
- Tag-based activation (responds when mentioned)
- Per-channel conversation management
- Multi-user context formatting
- Streaming responses with typing indicators

```bash
cd examples/discord && npm install && npm start
```

### REST API Server (`examples/rest-server/`)

OpenAI-compatible API server:
- Works with OpenWebUI, Cursor, Continue, etc.
- Streaming and non-streaming modes
- Bearer token authentication
- TypeScript client example

```bash
cd examples/rest-server && npm install && npm start
```

---

## Environment Variables

Create a `.env` file at the project root:

```bash
# ═══════════════════════════════════════════════════════════════════════════════
# REQUIRED - Core Services
# ═══════════════════════════════════════════════════════════════════════════════

# Redis - Message queue, streaming, hot cache
REDIS_URL=redis://localhost:6379

# MongoDB - Persistent storage (messages, conversations, logs, configs)
MONGODB_URI=mongodb://localhost:27017/redbtn

# ChromaDB - Vector store for RAG embeddings
VECTOR_DB_URL=http://localhost:8024

# ═══════════════════════════════════════════════════════════════════════════════
# REQUIRED - LLM Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

# Primary chat model (user interactions)
CHAT_LLM_URL=http://localhost:11434

# Worker model (routing, tool selection, internal operations)
WORK_LLM_URL=http://localhost:11434

# Default model name for Ollama
OLLAMA_MODEL=llama3.2

# ═══════════════════════════════════════════════════════════════════════════════
# REQUIRED - Web Search (for web_search MCP tool)
# ═══════════════════════════════════════════════════════════════════════════════

GOOGLE_API_KEY=your_google_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
# Alternative: GOOGLE_CSE_ID=your_search_engine_id

# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONAL - Additional LLM Providers
# ═══════════════════════════════════════════════════════════════════════════════

# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Google (for Gemini)
GOOGLE_GENERATIVE_AI_API_KEY=AIza...

# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONAL - Server Configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Server port (for examples/rest-server)
PORT=3000

# API authentication token
BEARER_TOKEN=red_ai_sk_...

# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONAL - Memory Configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Maximum tokens for context window (default: 30000)
MAX_CONTEXT_TOKENS=30000

# Token cushion for summaries (default: 2000)
SUMMARY_CUSHION_TOKENS=2000

# Message ID index TTL in seconds (default: 30 days)
CONVERSATION_MESSAGE_ID_TTL=2592000

# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONAL - System Prompt Override
# ═══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT="You are Red, an AI assistant..."
```

The library automatically loads `.env` using `dotenv/config` at startup.

---

## 🛠️ Development

### Prerequisites

- Node.js 18+
- TypeScript 5.x
- Redis (for state management)
- MongoDB (for persistence)
- ChromaDB (for vectors)
- Ollama (for local LLM)

### Setup

```bash
# Clone the repository
git clone https://github.com/redbtn-io/ai.git
cd ai

# Install dependencies
npm install

# Build
npm run build

# Pack for local linking
npm run pack
# Creates: redbtn-ai-0.0.1.tgz
```

### Available Scripts

```bash
# Build TypeScript to dist/
npm run build

# Build and create .tgz package
npm run pack

# Start example REST server (dev mode)
npm run dev:server

# Start example REST server
npm run start:server

# Database maintenance
npm run db:fix-messageids     # Fix null messageId values in MongoDB
npm run redis:cleanup-dupes   # Remove duplicate messages from Redis
```

### Project Structure

```
ai/
├── src/
│   ├── index.ts                    # Main Red class and exports
│   ├── functions/
│   │   ├── respond.ts              # Core response generation
│   │   └── background/             # Background tasks (titles, summaries)
│   └── lib/
│       ├── graphs/
│       │   ├── GraphRegistry.ts    # LRU-cached graph loading
│       │   ├── compiler.ts         # LangGraph StateGraph builder
│       │   └── nodeRegistry.ts     # NODE_REGISTRY mapping
│       ├── neurons/
│       │   └── NeuronRegistry.ts   # Model factory with LRU cache
│       ├── nodes/
│       │   ├── router.ts           # Confidence-scored routing
│       │   ├── respond.ts          # Final response generation
│       │   ├── classifier.ts       # Intent classification
│       │   ├── planner.ts          # Task decomposition
│       │   ├── executor.ts         # Plan execution
│       │   ├── fastpath.ts         # Pattern-matched bypass
│       │   ├── precheck.ts         # Pre-routing validation
│       │   ├── context.ts          # Context loading
│       │   ├── search/             # Web search implementation
│       │   ├── scrape/             # URL scraping implementation
│       │   ├── command/            # System command execution
│       │   └── universal/          # Config-driven universal nodes
│       │       ├── universalNode.ts
│       │       ├── stepExecutor.ts
│       │       ├── types.ts
│       │       └── executors/      # Step type executors
│       ├── mcp/
│       │   ├── server-stdio.ts     # Base stdio MCP server
│       │   ├── stdio-pool.ts       # MCP server process pool
│       │   ├── client.ts           # MCP JSON-RPC client
│       │   ├── registry.ts         # Tool registration
│       │   └── servers/            # MCP server implementations
│       │       ├── web-stdio.ts    # web_search, scrape_url
│       │       ├── system-stdio.ts # execute_command
│       │       ├── rag-stdio.ts    # vector store operations
│       │       └── context-stdio.ts # conversation context
│       ├── memory/
│       │   ├── memory.ts           # MemoryManager (Redis + MongoDB)
│       │   ├── queue.ts            # MessageQueue (streaming)
│       │   ├── database.ts         # MongoDB operations
│       │   └── vectors.ts          # ChromaDB operations
│       ├── models/
│       │   ├── Graph.ts            # Graph MongoDB schema
│       │   ├── Neuron.ts           # Neuron MongoDB schema
│       │   └── UniversalNodeConfig.ts # Universal node schema
│       ├── types/
│       │   ├── graph.ts            # GraphNodeType, GraphConfig
│       │   └── neuron.ts           # NeuronConfig, NeuronProvider
│       ├── logs/
│       │   ├── persistent-logger.ts # MongoDB logging
│       │   └── colors.ts           # Console colors
│       ├── events/
│       │   └── tool-events.ts      # Tool event types
│       ├── registry/
│       │   └── UniversalNodeRegistry.ts
│       └── utils/
│           ├── thinking.ts         # <think> tag extraction
│           ├── retry.ts            # Network retry logic
│           ├── tokenizer.ts        # Token counting
│           └── json-extractor.ts   # Robust JSON parsing
├── examples/
│   ├── discord/                    # Discord bot
│   └── rest-server/                # OpenAI-compatible API
└── package.json
```

---

## 🔍 Troubleshooting

### MCP Server Issues

**Symptom**: Tool calls failing, "MCP server not found" errors
```
⚠️ MCP server registration failed
Tool calls will fail.
```

**Solution**: MCP servers are started automatically in `load()`. Check:
1. No port conflicts on stdio pipes
2. Environment variables are set (especially GOOGLE_API_KEY for web search)
3. Check logs for child process spawn errors

---

**Symptom**: Web search returns empty results

**Solution**:
```bash
# Verify Google API credentials
echo $GOOGLE_API_KEY
echo $GOOGLE_SEARCH_ENGINE_ID

# Test directly
curl "https://www.googleapis.com/customsearch/v1?key=$GOOGLE_API_KEY&cx=$GOOGLE_SEARCH_ENGINE_ID&q=test"
```

### Database Issues

**Symptom**: MongoDB authentication errors
```
Command find requires authentication
```

**Solution**: Update MongoDB URI with credentials:
```bash
MONGODB_URI=mongodb://username:password@localhost:27017/redbtn?authSource=admin
```

---

**Symptom**: Duplicate messages appearing

**Solution**: Run cleanup scripts:
```bash
npm run redis:cleanup-dupes
npm run db:fix-messageids
```

### Redis Issues

**Symptom**: "Redis connection failed" or stream reconnection not working

**Solution**:
1. Verify Redis is running: `redis-cli ping` → `PONG`
2. Check Redis URL in environment
3. Ensure Redis accepts external connections (check `bind` in `redis.conf`)
4. Check memory limits: `redis-cli info memory`

### LLM Issues

**Symptom**: Network timeout errors, slow responses

**Solution**:
1. Check Ollama is running: `curl http://localhost:11434/api/tags`
2. Verify model is loaded: `ollama list`
3. Network retry will handle transient failures automatically
4. For persistent issues, increase timeout in neuron config

---

**Symptom**: "Neuron not found" errors

**Solution**:
1. Check MongoDB `neurons` collection for the neuronId
2. Verify user has access tier for the neuron
3. System neurons should have `userId: 'system'`

### Graph Issues

**Symptom**: "Graph not found" or "access denied"

**Solution**:
1. Check MongoDB `graphs` collection for the graphId
2. Verify user's account tier meets graph's minimum tier
3. System graphs should have `userId: 'system'` and `isDefault: true`

### Memory Issues

**Symptom**: Context too long, token limit exceeded

**Solution**: Configure memory limits in environment:
```bash
MAX_CONTEXT_TOKENS=30000
SUMMARY_CUSHION_TOKENS=2000
```

The system automatically:
- Trims older messages when limit is reached
- Generates trailing summaries for trimmed content
- Manages executive summaries for long conversations

### Thinking Extraction Issues

**Symptom**: DeepSeek-R1 thinking not captured

**Solution**:
1. Verify model outputs `<think>...</think>` tags
2. Check `thoughts` collection in MongoDB
3. Thinking is stored separately from message content
4. Enable debug logging to see extraction

### ChromaDB Issues

**Symptom**: Vector operations failing

**Solution**:
1. Check ChromaDB is running: `curl http://localhost:8024/api/v1/heartbeat`
2. Verify Ollama embedding model: `ollama pull nomic-embed-text`
3. Check collection exists before querying

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style
- TypeScript strict mode
- Use async/await over raw promises
- Document public APIs with JSDoc
- Add types to all function parameters

---

## 📄 License

ISC License - see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- **GitHub**: [redbtn-io/ai](https://github.com/redbtn-io/ai)
- **LangChain JS**: [js.langchain.com](https://js.langchain.com)
- **LangGraph JS**: [langchain-ai.github.io/langgraphjs](https://langchain-ai.github.io/langgraphjs)
- **Model Context Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **ChromaDB**: [docs.trychroma.com](https://docs.trychroma.com)
- **Ollama**: [ollama.ai](https://ollama.ai)

---

## 📞 Support

For questions and support, please open an issue on GitHub.

---

**Built with ❤️ by the Red Button team**
