/**
 * Seed Default Graph Templates
 * 
 * Phase 1: Dynamic Graph System
 * Creates 3 system-owned graph templates in MongoDB:
 * 1. Simple Chat - Direct conversation (FREE tier)
 * 2. Default Graph - Current production three-tier architecture (FREE tier)
 * 3. Research Mode - Always searches web first (TRIAL tier)
 */

import mongoose from 'mongoose';
import { Graph } from '../src/lib/models/Graph';
import { GraphNodeType } from '../src/lib/types/graph';

async function seedDefaultGraphs() {
  try {
    // Read DATABASE_URL from environment or use default
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/redbtn';
    
    console.log('[SeedGraphs] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[SeedGraphs] Connected successfully');
    
    // Delete existing system graphs (clean slate)
    const deleteResult = await Graph.deleteMany({ userId: 'system' });
    console.log(`[SeedGraphs] Deleted ${deleteResult.deletedCount} existing system graphs`);
    
    // Define the 3 default graph templates
    const graphs = [
      // ========================================================================
      // 1. SIMPLE CHAT - Direct to responder
      // ========================================================================
      {
        graphId: 'red-graph-simple',
        userId: 'system',
        isDefault: true,
        name: 'Simple Chat',
        description: 'Direct conversation with no tools, planning, or web search. Fast and lightweight.',
        tier: 4, // FREE tier
        nodes: [
          { id: 'contextLoader', type: GraphNodeType.CONTEXT },
          { id: 'responder', type: GraphNodeType.RESPONDER }
        ],
        edges: [
          { from: '__start__', to: 'contextLoader' },
          { from: 'contextLoader', to: 'responder' },
          { from: 'responder', to: '__end__' }
        ],
        config: {
          maxReplans: 0,
          maxSearchIterations: 0,
          enableFastpath: false
        }
      },
      
      // ========================================================================
      // 2. DEFAULT GRAPH - Current production three-tier architecture
      // ========================================================================
      {
        graphId: 'red-graph-default',
        userId: 'system',
        isDefault: true,
        name: 'Default (Three-Tier)',
        description: 'Production architecture: Precheck → Classifier → Planner → Executor. Recommended for most use cases.',
        tier: 4, // FREE tier
        nodes: [
          { id: 'precheck', type: GraphNodeType.PRECHECK },
          { id: 'fastpathExecutor', type: GraphNodeType.FASTPATH },
          { id: 'contextLoader', type: GraphNodeType.CONTEXT },
          { id: 'classifier', type: GraphNodeType.CLASSIFIER },
          { id: 'planner', type: GraphNodeType.PLANNER },
          { id: 'executor', type: GraphNodeType.EXECUTOR },
          { id: 'search', type: GraphNodeType.SEARCH },
          { id: 'scrape', type: GraphNodeType.SCRAPE },
          { id: 'command', type: GraphNodeType.COMMAND },
          { id: 'responder', type: GraphNodeType.RESPONDER }
        ],
        edges: [
          // Start → Precheck
          { from: '__start__', to: 'precheck' },
          
          // Precheck → Fastpath OR Context
          { 
            from: 'precheck',
            condition: "state.precheckDecision",
            targets: { 
              'fastpath': 'fastpathExecutor'
            },
            fallback: 'contextLoader'
          },
          
          // Fastpath → End (short-circuit)
          { from: 'fastpathExecutor', to: '__end__' },
          
          // Context → Classifier
          { from: 'contextLoader', to: 'classifier' },
          
          // Classifier → Direct Responder OR Planner
          {
            from: 'classifier',
            condition: "state.routerDecision",
            targets: { 
              'direct': 'responder'
            },
            fallback: 'planner'
          },
          
          // Planner → Executor
          { from: 'planner', to: 'executor' },
          
          // Executor → Tool Nodes OR Responder
          {
            from: 'executor',
            condition: "state.nextNode",
            targets: {
              'search': 'search',
              'scrape': 'scrape',
              'command': 'command',
              'responder': 'responder'
            },
            fallback: 'responder'
          },
          
          // Tool nodes loop back to Executor OR end
          {
            from: 'search',
            condition: "state.executionPlan && state.currentStepIndex < state.executionPlan.steps.length",
            targets: { 
              'true': 'executor'
            },
            fallback: 'responder'
          },
          {
            from: 'scrape',
            condition: "state.executionPlan && state.currentStepIndex < state.executionPlan.steps.length",
            targets: { 
              'true': 'executor'
            },
            fallback: 'responder'
          },
          {
            from: 'command',
            condition: "state.executionPlan && state.currentStepIndex < state.executionPlan.steps.length",
            targets: { 
              'true': 'executor'
            },
            fallback: 'responder'
          },
          
          // Responder → End
          { from: 'responder', to: '__end__' }
        ],
        config: {
          maxReplans: 3,
          maxSearchIterations: 5,
          enableFastpath: true
        }
      },
      
      // ========================================================================
      // 3. RESEARCH MODE - Always searches web before answering
      // ========================================================================
      {
        graphId: 'red-graph-research',
        userId: 'system',
        isDefault: true,
        name: 'Research Mode',
        description: 'Always searches the web before answering. Best for up-to-date information and fact-checking.',
        tier: 3, // TRIAL tier (requires tier 3 or better)
        nodes: [
          { id: 'contextLoader', type: GraphNodeType.CONTEXT },
          { id: 'planner', type: GraphNodeType.PLANNER },
          { id: 'executor', type: GraphNodeType.EXECUTOR },
          { id: 'search', type: GraphNodeType.SEARCH },
          { id: 'scrape', type: GraphNodeType.SCRAPE },
          { id: 'responder', type: GraphNodeType.RESPONDER }
        ],
        edges: [
          // Start → Context → Planner (skip classifier, always plan)
          { from: '__start__', to: 'contextLoader' },
          { from: 'contextLoader', to: 'planner' },
          { from: 'planner', to: 'executor' },
          
          // Executor → Search/Scrape tools
          {
            from: 'executor',
            condition: "state.nextNode",
            targets: {
              'search': 'search',
              'scrape': 'scrape'
            },
            fallback: 'responder'
          },
          
          // Tool nodes loop back to Executor OR Responder
          {
            from: 'search',
            condition: "state.executionPlan && state.currentStepIndex < state.executionPlan.steps.length",
            targets: { 
              'true': 'executor'
            },
            fallback: 'responder'
          },
          {
            from: 'scrape',
            condition: "state.executionPlan && state.currentStepIndex < state.executionPlan.steps.length",
            targets: { 
              'true': 'executor'
            },
            fallback: 'responder'
          },
          
          // Responder → End
          { from: 'responder', to: '__end__' }
        ],
        config: {
          maxReplans: 2,
          maxSearchIterations: 10,
          enableFastpath: false
        }
      }
    ];
    
    // Insert all graphs into MongoDB
    console.log(`[SeedGraphs] Creating ${graphs.length} system graphs...`);
    for (const graphConfig of graphs) {
      const doc = await Graph.create(graphConfig);
      console.log(`[SeedGraphs] ✓ Created: ${graphConfig.graphId} (${graphConfig.name}) - Tier ${graphConfig.tier}`);
    }
    
    console.log(`[SeedGraphs] Successfully seeded ${graphs.length} default graphs`);
    console.log('[SeedGraphs] Disconnecting from MongoDB...');
    
    await mongoose.disconnect();
    console.log('[SeedGraphs] Done!');
    
    process.exit(0);
  } catch (error) {
    console.error('[SeedGraphs] Error seeding graphs:', error);
    process.exit(1);
  }
}

// Run the seed function
seedDefaultGraphs();
