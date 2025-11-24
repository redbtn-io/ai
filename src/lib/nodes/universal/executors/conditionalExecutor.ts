/**
 * Conditional Step Executor
 * 
 * Evaluates boolean conditions and sets state fields based on result.
 * Used for routing logic, validation checks, and conditional field setting.
 */

import type { ConditionalStepConfig } from '../types';
import { renderTemplate } from '../templateRenderer';

/**
 * Execute a conditional step
 * 
 * Flow:
 * 1. Render condition template with current state
 * 2. Evaluate condition to boolean
 * 3. Set output field to trueValue or falseValue based on result
 * 
 * Example:
 * condition: "{{state.searchResults.length}} > 0"
 * setField: "hasResults"
 * trueValue: true
 * falseValue: false
 * 
 * Result: { hasResults: true } if searchResults has items
 * 
 * @param config - Conditional step configuration
 * @param state - Current graph state (includes accumulated updates from previous steps)
 * @returns Partial state with setField set to trueValue or falseValue
 */
export function executeConditional(
  config: ConditionalStepConfig,
  state: any
): Partial<any> {
  try {
    // Check if condition is a JavaScript expression (wrapped in {{ }})
    let conditionStr: string;
    let result: boolean;
    
    const trimmedCondition = config.condition.trim();
    
    // DEBUG: Log what we're checking
    console.log('[ConditionalExecutor] Checking condition:', {
      original: config.condition,
      trimmed: trimmedCondition,
      startsWithBraces: trimmedCondition.startsWith('{{'),
      endsWithBraces: trimmedCondition.endsWith('}}'),
      willEvalAsJS: trimmedCondition.startsWith('{{') && trimmedCondition.endsWith('}}')
    });
    
    if (trimmedCondition.startsWith('{{') && trimmedCondition.endsWith('}}')) {
      // Evaluate as JavaScript expression
      const expression = trimmedCondition.slice(2, -2).trim();
      try {
        // Special logging for executionPlan validation
        if (expression.includes('executionPlan')) {
          console.log('[ConditionalExecutor] DEBUG - Validating executionPlan:', {
            expression,
            executionPlan: state.data?.executionPlan,
            hasSteps: !!state.data?.executionPlan?.steps,
            stepsType: typeof state.data?.executionPlan?.steps,
            stepsLength: state.data?.executionPlan?.steps?.length,
            stepsValue: state.data?.executionPlan?.steps
          });
        }
        
        const evalFunc = new Function('state', `return ${expression}`);
        result = Boolean(evalFunc(state));
        conditionStr = trimmedCondition; // Keep original for logging
        
        console.log('[ConditionalExecutor] Evaluated JS condition:', {
          expression,
          result,
          type: typeof result
        });
      } catch (error) {
        console.error('[ConditionalExecutor] Failed to evaluate JS condition:', expression, error);
        // Fall back to template rendering
        conditionStr = renderTemplate(config.condition, state);
        result = evaluateCondition(conditionStr);
      }
    } else {
      // Render condition template with current state
      conditionStr = renderTemplate(config.condition, state);
      
      // Evaluate condition
      result = evaluateCondition(conditionStr);
    }
    
    // Evaluate or render true/false values (they might contain JavaScript expressions or templates)
    const trueValue = typeof config.trueValue === 'string' 
      ? evaluateValue(config.trueValue, state) 
      : config.trueValue;
      
    const falseValue = typeof config.falseValue === 'string'
      ? evaluateValue(config.falseValue, state)
      : config.falseValue;
    
    // Debug logging
    console.log(`[ConditionalExecutor] Condition: "${config.condition}" → rendered: "${conditionStr}" → result: ${result} → setting ${config.setField} = ${result ? trueValue : falseValue}`);
    
    // Return appropriate value
    return {
      [config.setField]: result ? trueValue : falseValue
    };
    
  } catch (error) {
    throw new Error(`Conditional step failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Evaluate a value that might be a JavaScript expression or a template
 * 
 * If the value is wrapped in {{ }}, evaluate it as JavaScript (supports optional chaining, etc.)
 * Otherwise, use the template renderer for simple {{state.field}} substitutions
 * 
 * @param valueStr - Value string to evaluate
 * @param state - Current state for evaluation
 * @returns Evaluated value
 */
function evaluateValue(valueStr: string, state: any): any {
  const trimmed = valueStr.trim();
  
  // If it's a JavaScript expression (wrapped in {{ }}), evaluate it
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    const expression = trimmed.slice(2, -2).trim();
    
    try {
      // Create a function that evaluates the expression with state in scope
      const evalFunc = new Function('state', `return ${expression}`);
      const result = evalFunc(state);
      
      console.log('[ConditionalExecutor] Evaluated JS expression:', {
        expression,
        result,
        type: typeof result
      });
      
      return result;
    } catch (error) {
      console.error('[ConditionalExecutor] Failed to evaluate expression:', expression, error);
      // Fall back to template rendering
      return renderTemplate(valueStr, state);
    }
  }
  
  // Otherwise use template rendering for simple substitutions
  return renderTemplate(valueStr, state);
}

/**
 * Strip surrounding quotes from a string
 * Handles both single and double quotes
 */
function stripQuotes(str: string): string {
  const trimmed = str.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Evaluate a boolean condition
 * 
 * Supports:
 * - Boolean literals: "true", "false"
 * - Comparison operators: >, >=, <, <=, ==, !=, ===, !==
 * - Numeric comparisons: "5 > 3" → true
 * - String comparisons: "search === 'search'" → true (quotes stripped)
 * - Existence checks: non-empty string → true, empty/0 → false
 * 
 * @param conditionStr - Condition string to evaluate
 * @returns Boolean result
 */
function evaluateCondition(conditionStr: string): boolean {
  const trimmed = conditionStr.trim();
  
  // Boolean literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  
  // Handle logical OR (||)
  if (trimmed.includes(' || ')) {
    const parts = trimmed.split(' || ');
    return parts.some(part => evaluateCondition(part.trim()));
  }
  
  // Handle logical AND (&&)
  if (trimmed.includes(' && ')) {
    const parts = trimmed.split(' && ');
    return parts.every(part => evaluateCondition(part.trim()));
  }
  
  // Comparison operators (supports ==, !=, ===, !==, <, >, <=, >=)
  const comparisonRegex = /^(.+?)\s*([<>]=?|[!=]==?)\s*(.+)$/;
  const match = trimmed.match(comparisonRegex);
  
  if (match) {
    const [, left, operator, right] = match;
    
    // Try numeric comparison
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
    
    // String comparison - strip quotes from both sides
    const leftStr = stripQuotes(left.trim());
    const rightStr = stripQuotes(right.trim());
    switch (operator) {
      case '==':
      case '===': return leftStr === rightStr;
      case '!=':
      case '!==': return leftStr !== rightStr;
    }
  }
  
  // Existence check: non-empty string is truthy
  return trimmed.length > 0 && trimmed !== '0' && trimmed !== 'null' && trimmed !== 'undefined';
}
