/**
 * Transform Step Executor
 * 
 * Executes data transformations on arrays and objects.
 * Supports map, filter, and select operations with template rendering.
 */

import type { TransformStepConfig } from '../types';
import { renderTemplate } from '../templateRenderer';
import { extractJSON } from '../../../utils/json-extractor';

/**
 * Execute a transform step
 * 
 * Operations:
 * - map: Apply transform template to each array element
 * - filter: Keep array elements where filterCondition evaluates to true
 * - select: Extract nested property from input using dot notation
 * 
 * @param config - Transform step configuration
 * @param state - Current graph state (includes accumulated updates from previous steps)
 * @returns Partial state with output field set to transformed data
 */
export function executeTransform(
  config: TransformStepConfig,
  state: any
): Partial<any> {
  try {
    // build-messages doesn't require inputField
    let inputData: any = undefined;
    
    if (config.inputField) {
      // Get input data from state (handles nested paths)
      inputData = getNestedProperty(state, config.inputField);
      
      // Fallback: try data. prefix if not found (migration support)
      if (inputData === undefined && !config.inputField.startsWith('data.') && !config.inputField.startsWith('state.')) {
        const dataPath = `data.${config.inputField}`;
        const dataValue = getNestedProperty(state, dataPath);
        if (dataValue !== undefined) {
          console.log(`[TransformExecutor] Legacy field '${config.inputField}' not found, using '${dataPath}' instead`);
          inputData = dataValue;
        }
      }
    }
    
    // Append, build-messages, set, and concat (with fallback) operations allow undefined input
    const allowUndefinedInput = config.operation === 'append' || 
                                config.operation === 'build-messages' || 
                                config.operation === 'set' ||
                                (config.operation === 'concat' && (config as any).fallbackToConcat);
    
    if (inputData === undefined && !allowUndefinedInput) {
      throw new Error(`Input field not found in state: ${config.inputField}`);
    }
    
    // Execute operation
    let result: any;
    
    switch (config.operation) {
      case 'map':
        result = executeMapOperation(config, inputData, state);
        break;
      
      case 'filter':
        result = executeFilterOperation(config, inputData, state);
        break;
      
      case 'select':
        result = executeSelectOperation(config, inputData);
        break;
      
      case 'set':
        result = executeSetOperation(config, state);
        break;
      
      case 'parse-json':
        result = executeParseJsonOperation(config, inputData);
        break;
      
      case 'append':
        result = executeAppendOperation(config, inputData, state);
        break;
      
      case 'concat':
        result = executeConcatOperation(config, inputData, state);
        break;
      
      case 'build-messages':
        result = executeBuildMessagesOperation(config, state);
        break;
      
      default:
        throw new Error(`Unknown transform operation: ${(config as any).operation}`);
    }
    
    // Return output field.
    // If an outputField is provided, keep the existing behavior and return
    // a single-field partial state. If no outputField is provided and the
    // result is an object, return that object directly so a single transform
    // step can set multiple fields (useful for initializing/incrementing
    // multiple state keys in one step). Otherwise, fall back to wrapping
    // the primitive result into a `result` field.
    if (config.outputField) {
      return { [config.outputField]: result };
    }

    if (result && typeof result === 'object' && !Array.isArray(result)) {
      // Return object directly as partial state
      return result;
    }

    // Fallback for primitives when no outputField specified
    return { result };
    
  } catch (error) {
    throw new Error(`Transform step failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Map operation: Apply transform template to each element
 * 
 * Example:
 * inputData: [{ url: "https://..." }, { url: "https://..." }]
 * transform: "{{item.url}}"
 * result: ["https://...", "https://..."]
 */
function executeMapOperation(
  config: TransformStepConfig,
  inputData: any,
  state: any
): any[] {
  if (!Array.isArray(inputData)) {
    throw new Error('Map operation requires input to be an array');
  }
  
  if (!config.transform) {
    throw new Error('Map operation requires transform template');
  }
  
  return inputData.map((item, index) => {
    // Create augmented state with item context
    // renderTemplate extracts the path after "state.", so we add item and index at root
    const itemState = {
      ...state,
      item,
      index
    };
    
    // Render transform template with item context
    // Template can use {{state.item.xxx}} or {{state.index}}
    return renderTemplate(config.transform!, itemState);
  });
}

/**
 * Filter operation: Keep elements where condition is true
 * 
 * Example:
 * inputData: [{ score: 0.8 }, { score: 0.3 }, { score: 0.9 }]
 * filterCondition: "{{item.score}} > 0.5"
 * result: [{ score: 0.8 }, { score: 0.9 }]
 */
function executeFilterOperation(
  config: TransformStepConfig,
  inputData: any,
  state: any
): any[] {
  if (!Array.isArray(inputData)) {
    throw new Error('Filter operation requires input to be an array');
  }
  
  if (!config.filterCondition) {
    throw new Error('Filter operation requires filterCondition');
  }
  
  return inputData.filter((item, index) => {
    // Create augmented state with item context
    // renderTemplate extracts the path after "state.", so we add item and index at root
    const itemState = {
      ...state,
      item,
      index
    };
    
    // Render condition template
    // Template can use {{state.item.xxx}} or {{state.index}}
    const conditionStr = renderTemplate(config.filterCondition!, itemState);
    
    // Evaluate condition (basic evaluation)
    return evaluateCondition(conditionStr);
  });
}

/**
 * Select operation: Extract nested property
 * 
 * Example:
 * inputData: { results: [{ url: "https://..." }] }
 * transform: "results"
 * result: [{ url: "https://..." }]
 * 
 * Or with array:
 * inputData: [{ data: { url: "..." } }]
 * transform: "data.url"
 * result: ["...", "..."]
 */
function executeSelectOperation(
  config: TransformStepConfig,
  inputData: any
): any {
  if (!config.transform) {
    throw new Error('Select operation requires transform (property path)');
  }
  
  const propertyPath = config.transform;
  
  // If input is array, extract property from each element
  if (Array.isArray(inputData)) {
    return inputData.map(item => getNestedProperty(item, propertyPath));
  }
  
  // Otherwise extract property from input object
  return getNestedProperty(inputData, propertyPath);
}

/**
 * Extract nested property using dot notation
 * 
 * @param obj - Object to extract from
 * @param path - Dot-separated path (e.g., "user.profile.name")
 * @returns Property value or undefined if not found
 */
function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Evaluate a simple boolean condition
 * 
 * Supports basic comparisons:
 * - "0.8 > 0.5" → true
 * - "10 < 5" → false
 * - "true" → true
 * - "false" → false
 * 
 * @param conditionStr - Condition string to evaluate
 * @returns Boolean result
 */
function evaluateCondition(conditionStr: string): boolean {
  const trimmed = conditionStr.trim();
  
  // Boolean literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  
  // Comparison operators
  const comparisonRegex = /^(.+?)\s*([<>]=?|[!=]=)\s*(.+)$/;
  const match = trimmed.match(comparisonRegex);
  
  if (match) {
    const [, left, operator, right] = match;
    const leftNum = parseFloat(left.trim());
    const rightNum = parseFloat(right.trim());
    
    if (!isNaN(leftNum) && !isNaN(rightNum)) {
      switch (operator) {
        case '>': return leftNum > rightNum;
        case '>=': return leftNum >= rightNum;
        case '<': return leftNum < rightNum;
        case '<=': return leftNum <= rightNum;
        case '==': return leftNum === rightNum;
        case '!=': return leftNum !== rightNum;
      }
    }
  }
  
  // Default: treat non-empty string as true
  return trimmed.length > 0 && trimmed !== '0';
}

/**
 * Parse JSON operation: Parse JSON string into object/array
 * 
 * Example:
 * inputData: '{"confidence": 0.9, "nextNode": "respond"}'
 * result: { confidence: 0.9, nextNode: "respond" }
 * 
 * @param config - Transform step configuration
 * @param inputData - JSON string to parse
 * @returns Parsed object or array
 */
function executeParseJsonOperation(
  config: TransformStepConfig,
  inputData: any
): any {
  if (typeof inputData !== 'string') {
    throw new Error('Parse JSON operation requires input to be a string');
  }
  
  // Try direct parse first (fast path for clean JSON)
  try {
    return JSON.parse(inputData.trim());
  } catch (directError) {
    // Direct parse failed - use robust extraction to handle noisy LLM output
    const extracted = extractJSON(inputData);
    
    if (extracted) {
      console.log('[TransformExecutor] ✓ Extracted JSON from noisy LLM response using robust parser');
      return extracted;
    }
    
    // Extraction failed - provide helpful error with preview
    const preview = inputData.substring(0, 300);
    throw new Error(
      `Failed to parse JSON: ${directError instanceof Error ? directError.message : String(directError)}\n` +
      `Preview: ${preview}${inputData.length > 300 ? '...' : ''}`
    );
  }
}

/**
 * Set operation: Set value directly from JavaScript expression evaluation
 * 
 * Supports complex expressions with array indexing, object access, logical operators
 * Example:
 * value: "{{state.executionPlan.steps[state.currentStepIndex || 0]}}"
 * result: {type: "search", searchQuery: "..."}
 * 
 * @param config - Transform step configuration with value expression
 * @param state - Current graph state for evaluation
 * @returns Evaluated value
 */
function executeSetOperation(
  config: TransformStepConfig,
  state: any
): any {
  if (config.value === undefined) {
    throw new Error('Set operation requires value expression');
  }
  
  // If value is a boolean, number, or null, return it directly without string conversion
  if (typeof config.value === 'boolean' || typeof config.value === 'number' || config.value === null) {
    console.log('[SetOperation] Returning primitive value:', {
      value: config.value,
      type: typeof config.value
    });
    return config.value;
  }
  
  const valueStr = String(config.value);
  
  console.log('[SetOperation] Processing value:', {
    valueStr,
    isTemplate: valueStr.startsWith('{{') && valueStr.endsWith('}}')
  });
  
  // If it's a template expression, evaluate it as JavaScript
  if (valueStr.startsWith('{{') && valueStr.endsWith('}}')) {
    const expression = valueStr.slice(2, -2); // Remove '{{' and '}}'
    
    console.log('[SetOperation] Evaluating expression:', expression);
    
    // Debug executor step 1 evaluation
    if (expression.includes('executorAwaitingReturn')) {
      console.log('[SetOperation] DEBUG - state.data.executorAwaitingReturn:', state.data?.executorAwaitingReturn);
      console.log('[SetOperation] DEBUG - typeof:', typeof state.data?.executorAwaitingReturn);
      console.log('[SetOperation] DEBUG - === true:', state.data?.executorAwaitingReturn === true);
      console.log('[SetOperation] DEBUG - currentStepIndex:', state.data?.currentStepIndex);
    }
    
    try {
      // Create a function that evaluates the expression with state in scope
      // The expression can be simple property access or complex JavaScript
      const evalFunc = new Function('state', `return ${expression}`);
      const result = evalFunc(state);
      
      console.log('[SetOperation] Evaluation result:', {
        resultType: typeof result,
        resultValue: result
      });
      
      return result;
    } catch (error) {
      console.error('[SetOperation] Evaluation failed:', error);
      throw new Error(`Failed to evaluate expression: ${expression} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Otherwise try template rendering for simple substitutions
  console.log('[SetOperation] Using template rendering');
  return renderTemplate(valueStr, state);
}

/**
 * Append operation: Append value to array
 * 
 * Example:
 * inputData: ["a", "b"]
 * value: "c"
 * result: ["a", "b", "c"]
 * 
 * If inputData is undefined, creates new array: [value]
 * 
 * @param config - Transform step configuration
 * @param inputData - Array to append to (or undefined)
 * @param state - Current graph state (for template rendering in value)
 * @returns Array with appended value
 */
function executeAppendOperation(
  config: TransformStepConfig,
  inputData: any,
  state: any
): any[] {
  if (!config.value) {
    throw new Error('Append operation requires value to append');
  }
  
  // If inputData is undefined, create new array
  const array = inputData === undefined ? [] : inputData;
  
  if (!Array.isArray(array)) {
    throw new Error('Append operation requires input to be an array or undefined');
  }
  
  // Check if condition is provided (optional)
  if (config.condition) {
    const conditionStr = renderTemplate(config.condition, state);
    const shouldAppend = evaluateCondition(conditionStr);
    
    if (!shouldAppend) {
      // Condition is false, return array unchanged
      console.log('[TransformExecutor] Append condition false, skipping append', {
        condition: config.condition,
        evaluatedTo: conditionStr
      });
      return array;
    }
    
    console.log('[TransformExecutor] Append condition true, appending value', {
      condition: config.condition,
      evaluatedTo: conditionStr
    });
  }
  
  // Render value if it contains template syntax
  let valueToAppend = config.value;
  if (typeof config.value === 'string' && config.value.includes('{{')) {
    // Support both {{field}} and {{state.field}} formats
    const template = config.value.includes('{{state.') 
      ? config.value 
      : config.value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, '{{state.$1}}');
    valueToAppend = renderTemplate(template, state);
  } else if (typeof config.value === 'object' && config.value !== null) {
    // For objects, recursively render any string properties that contain templates
    valueToAppend = renderObjectTemplates(config.value, state);
  }
  
  return [...array, valueToAppend];
}

/**
 * Recursively render templates in object properties
 */
function renderObjectTemplates(obj: any, state: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => renderObjectTemplates(item, state));
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.includes('{{')) {
        result[key] = renderTemplate(value, state);
      } else if (typeof value === 'object') {
        result[key] = renderObjectTemplates(value, state);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Concat operation: Concatenate two arrays
 * 
 * Example:
 * inputData: ["a", "b"]
 * value: "otherArrayField" (field name in state)
 * state.otherArrayField: ["c", "d"]
 * result: ["a", "b", "c", "d"]
 * 
 * @param config - Transform step configuration
 * @param inputData - First array
 * @param state - Current graph state (to lookup second array)
 * @returns Concatenated array
 */
function executeConcatOperation(
  config: TransformStepConfig,
  inputData: any,
  state: any
): any[] {
  const fallbackToConcat = (config as any).fallbackToConcat;
  const fallbackToInput = (config as any).fallbackToInput;
  
  // Support both 'value' and 'concatWith' field names
  const secondArrayField = config.value || (config as any).concatWith;
  
  if (!secondArrayField) {
    throw new Error('Concat operation requires value or concatWith (second array field name)');
  }
  
  // Get second array from state (handles nested paths)
  let secondArray = getNestedProperty(state, secondArrayField);
  
  // Fallback: try data. prefix if not found (migration support)
  if (secondArray === undefined && !secondArrayField.startsWith('data.') && !secondArrayField.startsWith('state.')) {
    const dataPath = `data.${secondArrayField}`;
    const dataValue = getNestedProperty(state, dataPath);
    if (Array.isArray(dataValue)) {
      console.log(`[ConcatOperation] Legacy field '${secondArrayField}' not found, using '${dataPath}' instead`);
      secondArray = dataValue;
    }
  }
  
  console.log('[ConcatOperation] Concatenating arrays:', {
    inputField: config.inputField,
    inputLength: Array.isArray(inputData) ? inputData.length : 'NOT_ARRAY',
    secondArrayField,
    secondArrayLength: Array.isArray(secondArray) ? secondArray.length : 'NOT_ARRAY',
    outputField: config.outputField
  });
  
  // Handle fallback scenarios
  if (inputData === undefined || !Array.isArray(inputData)) {
    if (fallbackToConcat && Array.isArray(secondArray)) {
      console.log('[ConcatOperation] Using fallback: only secondArray');
      // Use only secondArray
      return [...secondArray];
    }
    throw new Error('Concat operation requires input to be an array');
  }
  
  if (!Array.isArray(secondArray)) {
    if (fallbackToInput) {
      console.log('[ConcatOperation] Using fallback: only inputData');
      // Use only inputData
      return [...inputData];
    }
    throw new Error(`Concat operation requires second array at ${secondArrayField} to be an array`);
  }
  
  // Both arrays exist, concat them
  console.log('[ConcatOperation] Concatenating:', inputData.length, '+', secondArray.length, '=', inputData.length + secondArray.length);
  if (config.outputField === 'messages') {
    console.log('[ConcatOperation] === MESSAGES CONCAT ===');
    console.log('[ConcatOperation] Input array (first):', inputData.map((m: any) => `${m.role}: ${m.content?.substring(0, 50)}...`));
    console.log('[ConcatOperation] Second array:', secondArray.map((m: any) => `${m.role}: ${m.content?.substring(0, 50)}...`));
  }
  return [...inputData, ...secondArray];
}

/**
 * Build-messages operation: Build LLM message array with role/content pairs
 * 
 * Two modes:
 * 1. If useExistingField is set, return that field directly (pre-built messages)
 * 2. Otherwise, build from messages array, rendering templates
 * 
 * Example:
 * messages: [
 *   { role: 'system', content: '{{state.systemMessage}}' },
 *   { role: 'user', content: '{{state.query}}' }
 * ]
 * state.systemMessage: "You are a helpful assistant"
 * state.query: "What is AI?"
 * result: [
 *   { role: 'system', content: 'You are a helpful assistant' },
 *   { role: 'user', content: 'What is AI?' }
 * ]
 * 
 * @param config - Transform step configuration
 * @param state - Current graph state
 * @returns Array of message objects with role and content
 */
function executeBuildMessagesOperation(
  config: TransformStepConfig,
  state: any
): any[] {
  // Mode 1: Use existing field if specified
  if (config.useExistingField) {
    const existingMessages = getNestedProperty(state, config.useExistingField);
    
    if (existingMessages !== undefined) {
      if (!Array.isArray(existingMessages)) {
        throw new Error(`useExistingField ${config.useExistingField} is not an array`);
      }
      return existingMessages;
    }
    // If useExistingField is set but field doesn't exist, fall through to build from messages
  }
  
  // Mode 2: Build from messages array
  if (!config.messages || config.messages.length === 0) {
    throw new Error('build-messages operation requires either messages array or useExistingField');
  }
  
  const builtMessages: any[] = [];
  
  for (const message of config.messages) {
    if (!message.role || !message.content) {
      throw new Error('Each message must have role and content properties');
    }
    
    // Render content template
    const renderedContent = renderTemplate(message.content, state);
    
    builtMessages.push({
      role: message.role,
      content: renderedContent
    });
  }
  
  return builtMessages;
}
