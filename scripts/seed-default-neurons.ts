/**
 * Seed Default Neuron Templates
 * 
 * Phase 1: Dynamic Graph System
 * Creates system-owned neuron templates in MongoDB.
 */

import mongoose from 'mongoose';
import Neuron from '../src/lib/models/Neuron';
import { NeuronRole } from '../src/lib/types/neuron';

async function seedDefaultNeurons() {
  try {
    // Read MONGODB_URI from environment or use default
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/redbtn';
    
    console.log('[SeedNeurons] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[SeedNeurons] Connected successfully');
    
    // Delete existing system neurons (clean slate)
    const deleteResult = await Neuron.deleteMany({ userId: 'system' });
    console.log(`[SeedNeurons] Deleted ${deleteResult.deletedCount} existing system neurons`);
    
    // Define default neurons
    const neurons = [
      {
        neuronId: 'red-neuron',
        userId: 'system',
        isDefault: true,
        name: 'Red (Default Chat)',
        description: 'Default chat neuron using Ollama red model',
        provider: 'ollama',
        endpoint: process.env.CHAT_LLM_URL || 'http://localhost:11434',
        model: 'red',
        temperature: 0.7,
        maxTokens: 4096,
        role: 'chat' as NeuronRole,
        tier: 4 // FREE tier
      },
      {
        neuronId: 'red-worker',
        userId: 'system',
        isDefault: true,
        name: 'Red Worker',
        description: 'Worker neuron for task execution and planning',
        provider: 'ollama',
        endpoint: process.env.WORK_LLM_URL || 'http://localhost:11434',
        model: 'red',
        temperature: 0.0,
        maxTokens: 4096,
        role: 'worker' as NeuronRole,
        tier: 4 // FREE tier
      },
      {
        neuronId: 'deepseek-r1',
        userId: 'system',
        isDefault: false,
        name: 'DeepSeek R1 (Reasoning)',
        description: 'DeepSeek R1 model with advanced reasoning capabilities',
        provider: 'ollama',
        endpoint: process.env.CHAT_LLM_URL || 'http://localhost:11434',
        model: 'deepseek-r1',
        temperature: 0.7,
        maxTokens: 8192,
        role: 'chat' as NeuronRole,
        tier: 3 // TRIAL tier
      }
    ];
    
    console.log('[SeedNeurons] Creating system neurons...');
    
    for (const neuron of neurons) {
      const created = await Neuron.create(neuron);
      console.log(`[SeedNeurons] ✓ Created: ${created.neuronId} (${created.name}) - Role: ${created.role}, Tier: ${created.tier}`);
    }
    
    console.log(`[SeedNeurons] Successfully seeded ${neurons.length} default neurons`);
    
    // Disconnect
    console.log('[SeedNeurons] Disconnecting from MongoDB...');
    await mongoose.disconnect();
    console.log('[SeedNeurons] Done!');
    
  } catch (error) {
    console.error('[SeedNeurons] Error seeding neurons:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedDefaultNeurons();
}

export default seedDefaultNeurons;
