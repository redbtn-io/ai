/**
 * Universal Node Orchestrator
 * 
 * Main entry point for universal nodes. Handles:
 * - Normalizing single-step and multi-step configurations
 * - Executing steps sequentially
 * - Accumulating state updates across steps
 * - Error handling with step context
 * 
 * Universal nodes can have 1-N steps that execute in order, with each step
 * able to read state fields set by previous steps.
 */

import type { UniversalNodeConfig, UniversalStep } from './types';
import { executeStep } from './stepExecutor';
import { getNodeSystemPrefix } from '../../utils/node-helpers';

/**
 * Universal node function compatible with NODE_REGISTRY
 * 
 * The universal node configuration is injected into state as nodeConfig by the compiler.
 * This follows the same pattern as other configurable nodes (responder, context, etc.)
 * 
 * Supports two configuration modes:
 * 1. Legacy: Full config with steps embedded (for backward compatibility)
 * 2. Registry: nodeId reference to load config from MongoDB (new approach)
 * 
 * @param state - Graph state with nodeConfig injected by compiler
 * @returns Partial state with updates from all executed steps
 */
export const universalNode = async (state: any): Promise<Partial<any>> => {
  // Extract node config (injected by compiler)
  let nodeConfig: UniversalNodeConfig = (state as any).nodeConfig || {};
  
  // Check if this is a nodeId reference (registry mode)
  if ((nodeConfig as any).nodeId && !(nodeConfig as any).steps) {
    const nodeId = (nodeConfig as any).nodeId;
    console.log(`[UniversalNode] Loading config from registry: ${nodeId}`);
    
    // Debug logging for executor to trace state persistence
    if (nodeId === 'executor') {
      console.log('[UniversalNode - EXECUTOR] Incoming state.data keys:', Object.keys(state.data || {}));
      console.log('[UniversalNode - EXECUTOR] executorAwaitingReturn:', state.data?.executorAwaitingReturn);
      console.log('[UniversalNode - EXECUTOR] currentStepIndex:', state.data?.currentStepIndex);
    }
    
    // Debug logging for respond node to trace context
    if (nodeId === 'respond') {
      console.log('[UniversalNode - RESPOND] ===== INCOMING STATE =====');
      console.log('[UniversalNode - RESPOND] contextMessages count:', state.contextMessages?.length || 0);
      if (state.contextMessages && state.contextMessages.length > 0) {
        console.log('[UniversalNode - RESPOND] Context messages:');
        state.contextMessages.forEach((msg: any, i: number) => {
          console.log(`[UniversalNode - RESPOND]   [${i}] ${msg.role}: ${msg.content?.substring(0, 80)}...`);
        });
      }
      console.log('[UniversalNode - RESPOND] messages count:', state.messages?.length || 0);
    }
    
    // Import registry dynamically to avoid circular dependencies
    const { getUniversalNode } = await import('../../registry/UniversalNodeRegistry');
    
    // Load full config from MongoDB
    const loadedConfig = await getUniversalNode(nodeId);
    if (!loadedConfig) {
      throw new Error(`[UniversalNode] Config not found in registry: ${nodeId}`);
    }
    
    // Use the loaded config directly (registry already formats it correctly)
    nodeConfig = loadedConfig;
    console.log(`[UniversalNode] Loaded config for ${nodeId} (${nodeConfig.steps?.length || 0} steps)`);
  }

  // Generate system prefix for this node execution
  const currentNodeCount = state.nodeCounter || 1;
  const nodeName = (nodeConfig as any).name || (nodeConfig as any).nodeId || 'Universal Node';
  const systemPrefix = getNodeSystemPrefix(currentNodeCount, nodeName);
  
  // Inject into state for steps to use (e.g. in neuronExecutor)
  state.systemPrefix = systemPrefix;
  
  console.log(`[UniversalNode] Executing node ${currentNodeCount}: ${nodeName}`);
  
  // Validate configuration
  if (!nodeConfig.steps && (!nodeConfig.type || !nodeConfig.config)) {
    throw new Error(
      '[UniversalNode] Invalid config: must provide either "steps" array or "type" + "config"'
    );
  }
  
  // Normalize to array of steps
  // Single-step format: { type: 'neuron', config: {...} }
  // Multi-step format: { steps: [...] }
  const steps: UniversalStep[] = nodeConfig.steps || [
    {
      type: nodeConfig.type!,
      config: nodeConfig.config as any
    }
  ];
  
  // Validate steps array
  if (!steps || steps.length === 0) {
    throw new Error('[UniversalNode] Invalid config: steps array cannot be empty');
  }
  
  
  // Track state updates from all steps (stored at top-level state)
  const stateUpdates: Record<string, any> = {
    nodeCounter: currentNodeCount + 1
  };
  
  // Execute steps sequentially
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNumber = i + 1;
    
    console.log(
      `[UniversalNode] Executing step ${stepNumber}/${steps.length}: ${step.type}`
    );
    
    try {
      // Set current step index in state
      // This allows respond.ts to know which step is currently executing
      state._currentStepIndex = i;
      
      // Execute step with current accumulated state
      // Each step can read:
      // - Original state fields (state.query, state.userId, etc.)
      // - Fields set by previous steps/nodes (state.contextMessages, state.routeDecision, etc.)
      // Convert flat updates to nested and deep merge with state
      const nestedUpdates = convertFlatToNested(stateUpdates);
      const currentState = deepMergeObjects(state, nestedUpdates);
      
      // Pass state (which contains infrastructure) to step executor
      const stepUpdate = await executeStep(step, currentState);
      
      // Accumulate state updates at top level (still flat for now)
      Object.assign(stateUpdates, stepUpdate);
      
      // Clear step index after execution
      state._currentStepIndex = undefined;
      
      const updatedFields = Object.keys(stepUpdate);
      console.log(
        `[UniversalNode] Step ${stepNumber} completed. Updated fields:`,
        updatedFields.join(', ')
      );
      
      // Log the actual values for debugging routing issues
      for (const field of updatedFields) {
        const value = stepUpdate[field];
        let valuePreview: string;
        
        if (value === undefined) {
          valuePreview = 'undefined';
        } else if (value === null) {
          valuePreview = 'null';
        } else if (typeof value === 'string') {
          valuePreview = value.length > 100 ? value.substring(0, 100) + '...' : value;
        } else {
          const stringified = JSON.stringify(value);
          valuePreview = stringified.length > 100 
            ? stringified.substring(0, 100) + '...'
            : stringified;
        }
        
        console.log(`[UniversalNode]   ${field} = ${valuePreview}`);
      }
      
    } catch (error: any) {
      // Provide detailed error context
      const errorMessage = `Step ${stepNumber} (${step.type}) failed: ${error.message}`;
      console.error(`[UniversalNode] ${errorMessage}`);
      
      // Safe stringify for step config (avoid circular references)
      try {
        console.error(`[UniversalNode] Step config:`, JSON.stringify(step.config, null, 2));
      } catch {
        console.error(`[UniversalNode] Step config: [contains circular references]`);
      }
      
      // Return error state to trigger fallback
      // This allows the graph compiler to route to the error_handler node
      console.log(`[UniversalNode] Triggering error fallback to 'error_handler'`);
      
      // Convert flat updates to nested before returning
      const nestedUpdates = convertFlatToNested(stateUpdates);
      
      return {
        ...nestedUpdates,
        data: {
          ...nestedUpdates.data,
          error: errorMessage,
          nextGraph: 'error_handler'
        }
      };
    }
  }
  
  console.log(
    `[UniversalNode] All ${steps.length} step(s) completed successfully.`,
    `Total fields updated:`, Object.keys(stateUpdates).join(', ')
  );
  
  // Convert flat dot-notation keys to nested objects
  // Example: { 'data.executionPlan': {...} } → { data: { executionPlan: {...} } }
  const nestedUpdates = convertFlatToNested(stateUpdates);
  
  // Return accumulated state updates
  // LangGraph will merge these using field-specific reducers
  return nestedUpdates;
};

/**
 * Convert flat dot-notation object to nested object
 * Example: { 'data.executionPlan': {...}, 'data.hasPlan': true } 
 *       → { data: { executionPlan: {...}, hasPlan: true } }
 */
function convertFlatToNested(flat: Record<string, any>): Record<string, any> {
  const nested: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(flat)) {
    if (!key.includes('.')) {
      // Top-level field, set directly
      nested[key] = value;
    } else {
      // Nested field with dot notation
      const parts = key.split('.');
      let current = nested;
      
      // Navigate/create nested structure
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current)) {
          current[part] = {};
        }
        current = current[part];
      }
      
      // Set the final value
      const lastPart = parts[parts.length - 1];
      current[lastPart] = value;
    }
  }
  
  return nested;
}

/**
 * Deep merge two objects, merging nested objects recursively
 */
function deepMergeObjects(target: any, source: any): any {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Recursively merge nested objects
      result[key] = deepMergeObjects(result[key] || {}, source[key]);
    } else {
      // Directly assign primitives, arrays, and null values
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Validate a universal node configuration
 * 
 * Checks for common configuration errors before execution.
 * Useful for API validation when users create graphs.
 * 
 * @param nodeConfig - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateUniversalNodeConfig(nodeConfig: UniversalNodeConfig): void {
  // Check for configuration format
  if (!nodeConfig.steps && (!nodeConfig.type || !nodeConfig.config)) {
    throw new Error(
      'Invalid universal node config: must provide either "steps" array or "type" + "config"'
    );
  }
  
  // Get steps array
  const steps = nodeConfig.steps || [
    {
      type: nodeConfig.type!,
      config: nodeConfig.config as any
    }
  ];
  
  // Validate steps array
  if (!steps || steps.length === 0) {
    throw new Error('Invalid universal node config: steps array cannot be empty');
  }
  
  // Validate each step
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNumber = i + 1;
    
    if (!step.type) {
      throw new Error(`Step ${stepNumber}: missing "type" field`);
    }
    
    if (!step.config) {
      throw new Error(`Step ${stepNumber}: missing "config" field`);
    }
    
    const validTypes = ['neuron', 'tool', 'transform', 'conditional', 'loop'];
    if (!validTypes.includes(step.type)) {
      throw new Error(
        `Step ${stepNumber}: invalid type "${step.type}". Must be one of: ${validTypes.join(', ')}`
      );
    }
    
    // Type-specific validation
    const config = step.config as any;
    
    switch (step.type) {
      case 'neuron':
        if (!config.userPrompt) {
          throw new Error(`Step ${stepNumber} (neuron): missing required field "userPrompt"`);
        }
        if (!config.outputField) {
          throw new Error(`Step ${stepNumber} (neuron): missing required field "outputField"`);
        }
        break;
        
      case 'tool':
        if (!config.toolName) {
          throw new Error(`Step ${stepNumber} (tool): missing required field "toolName"`);
        }
        if (!config.outputField) {
          throw new Error(`Step ${stepNumber} (tool): missing required field "outputField"`);
        }
        if (!config.parameters) {
          throw new Error(`Step ${stepNumber} (tool): missing required field "parameters"`);
        }
        break;
        
      case 'transform':
        if (!config.operation) {
          throw new Error(`Step ${stepNumber} (transform): missing required field "operation"`);
        }
        if (!config.inputField) {
          throw new Error(`Step ${stepNumber} (transform): missing required field "inputField"`);
        }
        if (!config.outputField) {
          throw new Error(`Step ${stepNumber} (transform): missing required field "outputField"`);
        }
        const validOps = ['map', 'filter', 'select'];
        if (!validOps.includes(config.operation)) {
          throw new Error(
            `Step ${stepNumber} (transform): invalid operation "${config.operation}". Must be one of: ${validOps.join(', ')}`
          );
        }
        break;
        
      case 'conditional':
        if (!config.condition) {
          throw new Error(`Step ${stepNumber} (conditional): missing required field "condition"`);
        }
        if (!config.setField) {
          throw new Error(`Step ${stepNumber} (conditional): missing required field "setField"`);
        }
        if (config.trueValue === undefined) {
          throw new Error(`Step ${stepNumber} (conditional): missing required field "trueValue"`);
        }
        if (config.falseValue === undefined) {
          throw new Error(`Step ${stepNumber} (conditional): missing required field "falseValue"`);
        }
        break;
        
      case 'loop':
        if (!config.maxIterations || config.maxIterations < 1) {
          throw new Error(`Step ${stepNumber} (loop): missing or invalid "maxIterations" (must be >= 1)`);
        }
        if (!config.exitCondition) {
          throw new Error(`Step ${stepNumber} (loop): missing required field "exitCondition"`);
        }
        if (!config.steps || config.steps.length === 0) {
          throw new Error(`Step ${stepNumber} (loop): missing or empty "steps" array`);
        }
        // Recursively validate nested loop steps
        for (let i = 0; i < config.steps.length; i++) {
          const nestedStep = config.steps[i];
          if (!nestedStep.type || !nestedStep.config) {
            throw new Error(
              `Step ${stepNumber} (loop): nested step ${i + 1} missing "type" or "config"`
            );
          }
        }
        break;
    }
  }
}
