/**
 * Step Executor Dispatcher
 * 
 * Routes each step to the appropriate executor based on step type.
 * This is the central dispatch point for all universal node step execution.
 */

import type { UniversalStep } from './types';
import { executeNeuron } from './executors/neuronExecutor';
import { executeTool } from './executors/toolExecutor';
import { executeTransform } from './executors/transformExecutor';
import { executeConditional } from './executors/conditionalExecutor';
import { executeLoop } from './executors/loopExecutor';

/**
 * Execute a single step based on its type
 * 
 * @param step - Step configuration with type and config
 * @param state - Current state (includes original state + accumulated updates from previous steps)
 * @returns Partial state update from this step
 * @throws Error if step type is unknown or execution fails
 */
export async function executeStep(
  step: UniversalStep,
  state: any
): Promise<Partial<any>> {
  // Check optional condition
  if (step.condition) {
    const shouldRun = evaluateStepCondition(step.condition, state);
    if (!shouldRun) {
      // console.log(`[StepExecutor] Skipping step due to condition: ${step.condition}`);
      return {}; // Skip execution, return empty update
    }
  }

  switch (step.type) {
    case 'neuron':
      return await executeNeuron(step.config as any, state);
    
    case 'tool':
      return await executeTool(step.config as any, state);
    
    case 'transform':
      return executeTransform(step.config as any, state);
    
    case 'conditional':
      return executeConditional(step.config as any, state);
    
    case 'loop':
      return await executeLoop(step.config as any, state);
    
    default:
      throw new Error(`Unknown step type: ${(step as any).type}`);
  }
}

function evaluateStepCondition(condition: string, state: any): boolean {
  const trimmed = condition.trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    const expression = trimmed.slice(2, -2).trim();
    try {
      const evalFunc = new Function('state', `return ${expression}`);
      return Boolean(evalFunc(state));
    } catch (error) {
      console.error('[StepExecutor] Failed to evaluate condition:', expression, error);
      return false;
    }
  }
  // If not a JS expression, assume false for safety (or implement simple comparison if needed)
  return false;
}
