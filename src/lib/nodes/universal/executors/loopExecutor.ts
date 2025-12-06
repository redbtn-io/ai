/**
 * Loop Step Executor
 * 
 * Executes a sequence of steps repeatedly until an exit condition is met or max iterations reached.
 * Supports accumulation of results across iterations.
 * 
 * Use cases:
 * - Iterative web search (search → evaluate → refine → repeat)
 * - Retry logic with progressive refinement
 * - Batch processing with result accumulation
 */

import type { LoopStepConfig } from '../types';
import { executeStep } from '../stepExecutor';

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
 * Deep merge source into target (mutates target)
 */
function deepMergeInPlace(target: any, source: any): void {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Recursively merge nested objects
      if (!target[key]) {
        target[key] = {};
      }
      deepMergeInPlace(target[key], source[key]);
    } else {
      // Directly assign primitives, arrays, and null values
      target[key] = source[key];
    }
  }
}

/**
 * Execute a loop step - runs nested steps repeatedly until exit condition met
 * 
 * @param config - Loop configuration with maxIterations, exitCondition, steps, etc.
 * @param state - Current state (includes data from previous steps)
 * @returns Partial state update with loop results
 */
export async function executeLoop(
  config: LoopStepConfig,
  state: any
): Promise<Partial<any>> {
  const {
    maxIterations,
    exitCondition,
    accumulatorField,
    steps,
    onMaxIterations = 'continue'
  } = config;
  
  console.log(`[LoopExecutor] Starting loop (max: ${maxIterations} iterations)`);
  console.log(`[LoopExecutor] Exit condition: ${exitCondition}`);
  console.log(`[LoopExecutor] Steps per iteration: ${steps.length}`);
  
  // Validate loop has steps
  if (!steps || steps.length === 0) {
    throw new Error('[LoopExecutor] Loop must have at least one step');
  }
  
  // Initialize accumulator array if field specified
  const accumulatorArray: any[] = [];
  
  // Track iteration count (1-indexed for user-friendly exit conditions)
  let iteration = 0;
  let exitConditionMet = false;
  
  // Clone current state to avoid mutating during loop
  const loopState = { ...state };
  
  console.log('[LoopExecutor] Initial loop state keys:', Object.keys(loopState).filter(k => !k.startsWith('_') && !['mcpClient', 'logger', 'neuronRegistry'].includes(k)).join(', '));
  console.log('[LoopExecutor] executorAwaitingReturn in initial state:', 'executorAwaitingReturn' in loopState, loopState.executorAwaitingReturn);
  
  while (iteration < maxIterations && !exitConditionMet) {
    iteration++;
    
    console.log(`[LoopExecutor] --- Iteration ${iteration}/${maxIterations} ---`);
    
    // Execute all steps in this iteration
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const stepNumber = stepIndex + 1;
      
      console.log(`[LoopExecutor] Iteration ${iteration}, Step ${stepNumber}/${steps.length}: ${step.type}`);
      
      try {
        // Create iteration state with current loop data and metadata
        // Inject loop metadata into data object
        const iterationState = {
          ...loopState,
          data: {
            ...(loopState.data || {}),
            loopIteration: iteration,
            loopAccumulator: accumulatorArray
          }
        };
        
        // Execute step
        const stepUpdate = await executeStep(step, iterationState);
        
        // Convert flat dot-notation keys to nested and deep merge
        const nestedUpdate = convertFlatToNested(stepUpdate);
        deepMergeInPlace(loopState, nestedUpdate);
        
        console.log(
          `[LoopExecutor] Iteration ${iteration}, Step ${stepNumber} completed.`,
          `Updated:`, Object.keys(stepUpdate).join(', ')
        );
        
      } catch (error: any) {
        console.error(
          `[LoopExecutor] Iteration ${iteration}, Step ${stepNumber} (${step.type}) failed:`,
          error.message
        );
        throw new Error(
          `Loop iteration ${iteration}, step ${stepNumber} (${step.type}) failed: ${error.message}`
        );
      }
    }
    
    // Accumulate iteration result if field specified
    if (accumulatorField && loopState[accumulatorField] !== undefined) {
      accumulatorArray.push(loopState[accumulatorField]);
      // Safe stringify for logging (handle circular references)
      let valuePreview = '[complex object]';
      try {
        valuePreview = JSON.stringify(loopState[accumulatorField]).substring(0, 100);
      } catch {
        valuePreview = '[non-serializable object]';
      }
      console.log(
        `[LoopExecutor] Accumulated result from iteration ${iteration}:`,
        `${accumulatorField}=${valuePreview}...`
      );
    }
    
    // Evaluate exit condition
    try {
      exitConditionMet = evaluateExitCondition(exitCondition, {
        ...loopState,
        data: {
            ...(loopState.data || {}),
            loopIteration: iteration,
            loopAccumulator: accumulatorArray
        }
      });
      
      if (exitConditionMet) {
        console.log(
          `[LoopExecutor] Exit condition met after ${iteration} iteration(s)`
        );
      }
    } catch (error: any) {
      console.warn(
        `[LoopExecutor] Error evaluating exit condition: ${error.message}`,
        `Condition: ${exitCondition}`
      );
      // Continue loop on evaluation error (safer than crashing)
    }
  }
  
  // Handle max iterations reached
  if (iteration === maxIterations && !exitConditionMet) {
    console.warn(
      `[LoopExecutor] Max iterations (${maxIterations}) reached without meeting exit condition`
    );
    
    if (onMaxIterations === 'throw') {
      throw new Error(
        `Loop exceeded max iterations (${maxIterations}) without meeting exit condition: ${exitCondition}`
      );
    }
    // onMaxIterations === 'continue' - proceed with current state
  }
  
  console.log(
    `[LoopExecutor] Loop complete. Iterations: ${iteration}, Exit condition met: ${exitConditionMet}`
  );
  
  // Build result object - ONLY include data fields that changed during loop
  // Do NOT spread entire loopState (contains infrastructure like mcpClient, logger, etc.)
  const infrastructureKeys = ['mcpClient', 'logger', 'neuronRegistry', 'memory', 'messageQueue', 
                              'userId', 'accountTier', 'options', 'query', 'data']; // IMPORTANT: Don't return 'data' directly - it overwrites parent state!
  const result: Record<string, any> = {
    loopIterations: iteration,
    loopExitConditionMet: exitConditionMet
  };
  
  // Copy only data fields (not infrastructure) from loop state
  // IMPORTANT: Only include fields with defined values to avoid overwriting graph state with undefined
  for (const key in loopState) {
    if (!infrastructureKeys.includes(key) && !key.startsWith('_')) {
      const value = loopState[key];
      // Skip undefined values - let LangGraph preserve existing state values
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }
  
  // Handle data field separately - return as dot-notation updates to preserve parent state
  if (loopState.data && typeof loopState.data === 'object') {
    for (const dataKey in loopState.data) {
      if (loopState.data[dataKey] !== undefined) {
        result[`data.${dataKey}`] = loopState.data[dataKey];
      }
    }
  }
  
  console.log('[LoopExecutor] Returning fields:', Object.keys(result).join(', '));
  console.log('[LoopExecutor] executionPlan in result:', 'executionPlan' in result);
  console.log('[LoopExecutor] executionPlan VALUE:', result.executionPlan);
  console.log('[LoopExecutor] currentStepIndex in result:', 'currentStepIndex' in result);
  console.log('[LoopExecutor] currentStepIndex VALUE:', result.currentStepIndex);
  
  // Add accumulator array if used
  if (accumulatorField) {
    const accumulatorArrayField = `${accumulatorField}Array`;
    result[accumulatorArrayField] = accumulatorArray;
    result[`${accumulatorField}Count`] = accumulatorArray.length;
    
    console.log(
      `[LoopExecutor] Accumulated ${accumulatorArray.length} result(s) in ${accumulatorArrayField}`
    );
  }
  
  return result;
}

/**
 * Evaluate exit condition expression
 * 
 * Supports:
 * - Comparisons: ===, !==, >, <, >=, <=
 * - Logical: &&, ||
 * - State access: state.field, state.loopIteration, state.loopAccumulator
 * 
 * @param condition - Exit condition expression string
 * @param state - Current state with loop metadata
 * @returns True if loop should exit, false if should continue
 */
function evaluateExitCondition(condition: string, state: any): boolean {
  try {
    // Create safe evaluation context with only state access
    const context = {
      state: state
    };
    
    // Build evaluation function with restricted scope
    const evalFunc = new Function('context', `
      with (context) {
        return ${condition};
      }
    `);
    
    const result = evalFunc(context);
    
    // Ensure boolean result
    return Boolean(result);
    
  } catch (error: any) {
    console.error(
      `[LoopExecutor] Failed to evaluate exit condition: ${condition}`,
      error.message
    );
    // On error, don't exit loop (safer default)
    return false;
  }
}
