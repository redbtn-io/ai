/**
 * Tool Step Executor
 * 
 * Executes MCP tool calls with parameter rendering and retry logic.
 * Supports any registered MCP tool (web_search, scrape_url, run_command, etc.)
 */

import type { ToolStepConfig } from '../types';
import { renderParameters } from '../templateRenderer';
import { executeWithErrorHandling } from './errorHandler';
import type { RunPublisher } from '../../../run/run-publisher';

// Debug logging - set to true to enable verbose logs
const DEBUG = false;

/**
 * Normalize tool step config by converting legacy inputMapping format to parameters format
 * 
 * Legacy format (UI): { toolName, inputMapping: { field1: value1, ... }, outputField }
 * New format (execution): { toolName, parameters: { field1: value1, ... }, outputField }
 * 
 * @param config - Tool step configuration that may use legacy format
 * @returns Normalized config with parameters field
 */
function normalizeToolStepConfig(config: any): ToolStepConfig {
  const normalized = { ...config };
  
  // Convert legacy inputMapping to parameters
  if (config.inputMapping && !config.parameters) {
    if (typeof config.inputMapping === 'object' && config.inputMapping !== null) {
      normalized.parameters = config.inputMapping;
    } else if (typeof config.inputMapping === 'string' && config.inputMapping.trim()) {
      // Legacy single string format - try to parse as object
      try {
        normalized.parameters = JSON.parse(config.inputMapping);
      } catch {
        // Treat as single parameter value
        normalized.parameters = { value: config.inputMapping };
      }
    } else {
      normalized.parameters = {};
    }
  }
  
  // Ensure parameters is always an object
  if (!normalized.parameters || typeof normalized.parameters !== 'object') {
    normalized.parameters = {};
  }
  
  return normalized;
}

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
  console.log('[ToolExecutor] ====== STARTING TOOL EXECUTION ======');
  console.log('[ToolExecutor] ToolName:', config.toolName);
  console.log('[ToolExecutor] OutputField:', config.outputField);
  console.log('[ToolExecutor] Parameters:', JSON.stringify(config.parameters));
  
  // Normalize legacy config format
  const normalizedConfig = normalizeToolStepConfig(config);
  
  // If error handling configured (new way), use it
  if (normalizedConfig.errorHandling) {
    return executeWithErrorHandling(
      () => executeToolInternal(normalizedConfig, state),
      normalizedConfig.errorHandling,
      { 
        type: 'tool', 
        field: normalizedConfig.outputField 
      }
    );
  }
  
  // Otherwise use legacy retry logic (backward compatibility)
  return executeToolInternal(normalizedConfig, state);
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
    // Validate required fields
    if (!config.toolName) {
      throw new Error('Tool step missing required field: toolName');
    }
    if (!config.outputField) {
      throw new Error('Tool step missing required field: outputField');
    }
    if (!config.parameters || typeof config.parameters !== 'object') {
      throw new Error(`Tool step "${config.toolName}" missing or invalid parameters object`);
    }
    
    // Get RunPublisher for tool events (only available in run path)
    const runPublisher = state.runPublisher as RunPublisher | undefined;
    
    // Generate unique tool execution ID
    const toolId = `tool_${config.toolName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    try {
    // Get MCP client from state (it's the registry)
    const mcpClient = state.mcpClient;
    if (!mcpClient) {
      throw new Error('MCP client not available in state');
    }
    
    // Render parameter templates with current state
    const renderedParams = renderParameters(config.parameters, state);
    
    if (DEBUG) console.log('[ToolExecutor] Executing tool step', {
      toolName: config.toolName,
      outputField: config.outputField
    });
    
    // Emit tool_start event
    if (runPublisher) {
      await runPublisher.toolStart(toolId, config.toolName, 'mcp', {
        input: renderedParams
      });
    }
    
    // Get metadata for tool execution
    // Note: messageId is in state.data.messageId (set by respond.ts initialState)
    const meta = {
      conversationId: state.options?.conversationId || state.data?.options?.conversationId,
      generationId: state.options?.generationId || state.data?.options?.generationId,
      messageId: state.messageId || state.data?.messageId
    };
    
    if (DEBUG) console.log('[ToolExecutor] Tool meta for event publishing:', {
      conversationId: meta.conversationId,
      messageId: meta.messageId
    });
    
    // Execute with retry logic
    const maxRetries = config.retryOnError ? (config.maxRetries ?? 3) : 0;
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Emit retry progress if not first attempt
        if (attempt > 0 && runPublisher) {
          await runPublisher.toolProgress(toolId, `retry_${attempt}`, {
            progress: attempt / (maxRetries + 1),
            data: { attempt, maxRetries }
          });
        }
        
        // Call tool via registry (handles server lookup and execution)
        if (DEBUG) console.log(`[ToolExecutor] Calling mcpClient.callTool: ${config.toolName}`);
        const result = await mcpClient.callTool(config.toolName, renderedParams, meta);
        if (DEBUG) console.log(`[ToolExecutor] mcpClient.callTool returned for ${config.toolName}`);
        
        if (DEBUG) console.log('[ToolExecutor] Tool call succeeded', {
          toolName: config.toolName,
          outputField: config.outputField,
          attempt: attempt + 1
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
        
        // Emit tool_complete event
        if (runPublisher) {
          const resultLength = typeof serializedResult === 'string' 
            ? serializedResult.length 
            : JSON.stringify(serializedResult).length;
          await runPublisher.toolComplete(toolId, serializedResult, {
            outputField: config.outputField,
            attempts: attempt + 1,
            resultLength,
          });
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
    
    // All retries exhausted - emit tool_error
    const errorMessage = lastError?.message || 'Tool call failed';
    if (runPublisher) {
      await runPublisher.toolError(toolId, errorMessage);
    }
    
    console.error('[ToolExecutor] Tool step failed after retries', {
      toolName: config.toolName,
      outputField: config.outputField,
      attempts: maxRetries + 1,
      error: errorMessage
    });
    throw lastError || new Error('Tool call failed');
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Emit tool_error if not already emitted (for non-retry errors)
    if (runPublisher) {
      await runPublisher.toolError(toolId, errorMessage);
    }
    
    console.error('[ToolExecutor] Tool step failed', {
      toolName: config.toolName,
      outputField: config.outputField,
      error: errorMessage
    });
    throw new Error(`Tool step failed: ${errorMessage}`);
  }
}
