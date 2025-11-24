/**
 * Tool Step Executor
 * 
 * Executes MCP tool calls with parameter rendering and retry logic.
 * Supports any registered MCP tool (web_search, scrape_url, run_command, etc.)
 */

import type { ToolStepConfig } from '../types';
import { renderParameters } from '../templateRenderer';
import { executeWithErrorHandling } from './errorHandler';

/**
 * Execute a tool step (with error handling wrapper)
 * 
 * @param config - Tool step configuration
 * @param state - Current graph state
 * @returns Partial state with output field set to tool result
 */
export async function executeTool(
  config: ToolStepConfig,
  state: any
): Promise<Partial<any>> {
  // If error handling configured (new way), use it
  if (config.errorHandling) {
    return executeWithErrorHandling(
      () => executeToolInternal(config, state),
      config.errorHandling,
      { 
        type: 'tool', 
        field: config.outputField 
      }
    );
  }
  
  // Otherwise use legacy retry logic (backward compatibility)
  return executeToolInternal(config, state);
}

/**
 * Internal tool execution (actual MCP tool call logic)
 * 
 * Flow:
 * 1. Get tool from MCP registry
 * 2. Render parameter templates with current state
 * 3. Call tool with rendered parameters
 * 4. Retry on failure if configured (legacy retryOnError)
 * 5. Return result in specified output field
 * 
 * @param config - Tool step configuration
 * @param state - Current graph state (includes accumulated updates from previous steps + infrastructure)
 * @returns Partial state with output field set to tool result
 */
async function executeToolInternal(
  config: ToolStepConfig,
  state: any
): Promise<Partial<any>> {
    const logger = state.logger;
    
    try {
    // Get MCP client from state (it's the registry)
    const mcpClient = state.mcpClient;
    if (!mcpClient) {
      throw new Error('MCP client not available in state');
    }
    
    // Render parameter templates with current state
    const renderedParams = renderParameters(config.parameters, state);
    
    console.log('[ToolExecutor] Executing tool step', {
      toolName: config.toolName,
      parameters: renderedParams,
      outputField: config.outputField,
      retryOnError: config.retryOnError,
      maxRetries: config.maxRetries
    });
    
    // Get metadata for tool execution
    const meta = {
      conversationId: state.options?.conversationId,
      generationId: state.options?.generationId,
      messageId: state.messageId
    };
    
    // Execute with retry logic
    const maxRetries = config.retryOnError ? (config.maxRetries ?? 3) : 0;
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Call tool via registry (handles server lookup and execution)
        const result = await mcpClient.callTool(config.toolName, renderedParams, meta);
        
        console.log('[ToolExecutor] Tool call succeeded', {
          toolName: config.toolName,
          outputField: config.outputField,
          attempt: attempt + 1,
          resultType: typeof result,
          isError: result?.isError
        });
        
        // Check if result is serializable BEFORE processing
        try {
          JSON.stringify(result);
        } catch (preSerializationError) {
          console.error('[ToolExecutor] Tool result contains circular references from MCP!', {
            toolName: config.toolName,
            resultKeys: Object.keys(result || {})
          });
        }
        
        // Extract result content (MCP tools return {content: [...], isError: false})
        let extractedResult = result;
        if (result && !result.isError && result.content && Array.isArray(result.content)) {
          // Try to parse JSON content if it's text
          const firstContent = result.content[0];
          if (firstContent?.type === 'text' && firstContent.text) {
            try {
              extractedResult = JSON.parse(firstContent.text);
            } catch {
              // Not JSON, use raw text
              extractedResult = firstContent.text;
            }
          }
        }
        
        // Ensure result is JSON-serializable (remove circular references, MongoDB objects, etc.)
        let serializedResult;
        try {
          serializedResult = JSON.parse(JSON.stringify(extractedResult));
        } catch (serializationError) {
          console.warn('[ToolExecutor] Result contains circular references, extracting primitive data');
          // If serialization fails, try to extract only primitive data
          if (typeof extractedResult === 'string') {
            serializedResult = extractedResult;
          } else if (extractedResult && typeof extractedResult === 'object') {
            // Extract only serializable properties
            serializedResult = {} as Record<string, any>;
            for (const key in extractedResult) {
              try {
                const value = extractedResult[key];
                // Only include primitives, arrays, and plain objects
                if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                  JSON.stringify(value); // Test if serializable
                  serializedResult[key] = value;
                }
              } catch {
                // Skip non-serializable properties
              }
            }
          } else {
            serializedResult = String(extractedResult);
          }
        }
        
        // Return output field
        return {
          [config.outputField]: serializedResult
        };
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxRetries) {
          // Calculate exponential backoff: 1s, 2s, 3s
          const delayMs = (attempt + 1) * 1000;
          console.warn('[ToolExecutor] Tool call failed, retrying', {
            toolName: config.toolName,
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            error: lastError.message
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    // All retries exhausted
    console.error('[ToolExecutor] Tool step failed after retries', {
      toolName: config.toolName,
      outputField: config.outputField,
      attempts: maxRetries + 1,
      error: lastError?.message
    });
    throw lastError || new Error('Tool call failed');
    
  } catch (error) {
    console.error('[ToolExecutor] Tool step failed', {
      toolName: config.toolName,
      outputField: config.outputField,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error(`Tool step failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
