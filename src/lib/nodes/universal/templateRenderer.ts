/**
 * Template Renderer
 * 
 * Renders template variables in the format {{state.fieldName}} by substituting
 * them with actual values from the state object.
 * 
 * Supports:
 * - State fields: {{state.query}}, {{state.user.name}}
 * - Parameters: {{parameters.temperature}}, {{parameters.model}}
 * - Multiple variables in same string
 * - Undefined variables are left as-is (not replaced)
 * 
 * Examples:
 * 
 * renderTemplate("Hello {{state.user.name}}", { user: { name: "Alice" } })
 * // Returns: "Hello Alice"
 * 
 * renderTemplate("Temp: {{parameters.temperature}}", { parameters: { temperature: 0.7 } })
 * // Returns: "Temp: 0.7"
 * 
 * renderTemplate("Search: {{state.query}}", { query: "TypeScript" })
 * // Returns: "Search: TypeScript"
 * 
 * renderTemplate("Missing: {{state.unknown}}", {})
 * // Returns: "Missing: {{state.unknown}}" (variable not found, left as-is)
 */

/**
 * Render a template string by replacing {{state.field}} and {{parameters.field}} variables
 * 
 * Supports nested property access via dot notation.
 * 
 * @param template - Template string with {{state.field}} or {{parameters.field}} placeholders
 * @param state - State object containing values to substitute (includes parameters)
 * @returns Rendered string with variables replaced
 */
export function renderTemplate(template: string, state: any): string {
  // First, replace {{parameters.xxx}} patterns
  let result = template.replace(/\{\{parameters\.(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    // Get value from state.parameters
    const value = getNestedProperty(state.parameters || {}, path);
    
    if (value !== undefined) {
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
      return String(value);
    } else {
      console.warn(`[TemplateRenderer] Parameter not found: parameters.${path}`);
      return match;  // Return original {{parameters.xxx}} if not found
    }
  });
  
  // Then, replace {{state.xxx}} patterns (supports nested paths like state.user.name)
  result = result.replace(/\{\{state\.(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    // Get value from state (handles nested paths)
    const value = getNestedProperty(state, path);
    
    // If value exists, convert to string; otherwise leave template variable as-is
    if (value !== undefined) {
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
      return String(value);
    } else {
      // Fallback: try data. prefix (migration support)
      if (!path.startsWith('data.')) {
        const dataPath = `data.${path}`;
        const dataValue = getNestedProperty(state, dataPath);
        if (dataValue !== undefined) {
          // console.log(`[TemplateRenderer] Legacy variable 'state.${path}' not found, using 'state.${dataPath}' instead`);
          return String(dataValue);
        }
      }

      console.warn(`[TemplateRenderer] Variable not found: state.${path}`);
      return match;  // Return original {{state.xxx}} if not found
    }
  });
  
  return result;
}

/**
 * Render parameters object by replacing template variables in all string values
 * 
 * Used for tool parameters where multiple fields may contain template variables.
 * Supports both {{state.xxx}} and {{parameters.xxx}} syntax.
 * 
 * Example:
 * renderParameters(
 *   { query: "{{state.search}}", temp: "{{parameters.temperature}}", maxResults: 5 },
 *   { search: "TypeScript", parameters: { temperature: 0.7 } }
 * )
 * // Returns: { query: "TypeScript", temp: "0.7", maxResults: 5 }
 * 
 * @param parameters - Object with potentially templated string values
 * @param state - State object containing values to substitute
 * @returns New object with template variables replaced
 */
export function renderParameters(
  parameters: Record<string, any>,
  state: any
): Record<string, any> {
  const rendered: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string' && (value.includes('{{state.') || value.includes('{{parameters.'))) {
      // Render template if it contains variables
      rendered[key] = renderTemplate(value, state);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively render nested objects
      rendered[key] = renderParameters(value, state);
    } else {
      // Keep non-string values as-is
      rendered[key] = value;
    }
  }
  
  return rendered;
}

/**
 * Get a nested property from an object using dot notation
 * 
 * Examples:
 * getNestedProperty({ user: { name: "Alice" } }, "user.name")
 * // Returns: "Alice"
 * 
 * getNestedProperty({ user: { name: "Alice" } }, "user.age")
 * // Returns: undefined
 * 
 * getNestedProperty({ count: 5 }, "count")
 * // Returns: 5
 * 
 * @param obj - Object to extract property from
 * @param path - Dot-separated property path (e.g., 'user.name')
 * @returns Property value or undefined if not found
 */
export function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current?.[key];
  }, obj);
}

/**
 * Check if a string contains any template variables
 * 
 * Useful for optimization - skip rendering if no variables present.
 * Checks for both {{state.xxx}} and {{parameters.xxx}} patterns.
 * 
 * @param str - String to check
 * @returns True if string contains template patterns
 */
export function hasTemplateVariables(str: string): boolean {
  return /\{\{(state|parameters)\.\w+(?:\.\w+)*\}\}/.test(str);
}

/**
 * Extract all template variable names from a string
 * 
 * Useful for validation - check if all required state/parameter fields are present.
 * 
 * Example:
 * extractTemplateVariables("Hello {{state.user.name}}, temp: {{parameters.temperature}}")
 * // Returns: [{ type: "state", path: "user.name" }, { type: "parameters", path: "temperature" }]
 * 
 * @param template - Template string
 * @returns Array of variable info objects
 */
export function extractTemplateVariables(template: string): Array<{ type: 'state' | 'parameters'; path: string }> {
  const matches = template.matchAll(/\{\{(state|parameters)\.(\w+(?:\.\w+)*)\}\}/g);
  return Array.from(matches, match => ({ type: match[1] as 'state' | 'parameters', path: match[2] }));
}
