/**
 * Template Renderer
 * 
 * Renders template variables in the format {{state.fieldName}} by substituting
 * them with actual values from the state object.
 * 
 * Supports:
 * - Simple fields: {{state.query}}
 * - Nested paths: {{state.user.name}}
 * - Multiple variables in same string
 * - Undefined variables are left as-is (not replaced)
 * 
 * Examples:
 * 
 * renderTemplate("Hello {{state.user.name}}", { user: { name: "Alice" } })
 * // Returns: "Hello Alice"
 * 
 * renderTemplate("Search: {{state.query}}", { query: "TypeScript" })
 * // Returns: "Search: TypeScript"
 * 
 * renderTemplate("Missing: {{state.unknown}}", {})
 * // Returns: "Missing: {{state.unknown}}" (variable not found, left as-is)
 */

/**
 * Render a template string by replacing {{state.field}} variables with actual values
 * 
 * Supports nested property access via dot notation.
 * 
 * @param template - Template string with {{state.field}} placeholders
 * @param state - State object containing values to substitute
 * @returns Rendered string with variables replaced
 */
export function renderTemplate(template: string, state: any): string {
  // Match all {{state.xxx}} patterns (supports nested paths like state.user.name)
  return template.replace(/\{\{state\.(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
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
}

/**
 * Render parameters object by replacing template variables in all string values
 * 
 * Used for tool parameters where multiple fields may contain template variables.
 * 
 * Example:
 * renderParameters(
 *   { query: "{{state.search}}", maxResults: 5, userId: "{{state.user.id}}" },
 *   { search: "TypeScript", user: { id: "123" } }
 * )
 * // Returns: { query: "TypeScript", maxResults: 5, userId: "123" }
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
    if (typeof value === 'string' && value.includes('{{state.')) {
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
 * 
 * @param str - String to check
 * @returns True if string contains {{state.xxx}} patterns
 */
export function hasTemplateVariables(str: string): boolean {
  return /\{\{state\.\w+(?:\.\w+)*\}\}/.test(str);
}

/**
 * Extract all template variable names from a string
 * 
 * Useful for validation - check if all required state fields are present.
 * 
 * Example:
 * extractTemplateVariables("Hello {{state.user.name}}, search: {{state.query}}")
 * // Returns: ["user.name", "query"]
 * 
 * @param template - Template string
 * @returns Array of variable paths (e.g., ["user.name", "query"])
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{state\.(\w+(?:\.\w+)*)\}\}/g);
  return Array.from(matches, match => match[1]);
}
