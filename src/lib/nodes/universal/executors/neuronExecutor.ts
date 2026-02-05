/**
 * Neuron Step Executor
 * 
 * Executes LLM calls with template rendering for prompts.
 * Supports custom neurons or default LLM with configurable parameters.
 * 
 * Parameter Override Flow:
 * 1. Node definition has `parameters` map with defaults (e.g., temperature: 0.1)
 * 2. Graph can override via `config.parameters: { temperature: 0.3 }`
 * 3. Resolved parameters are injected into state as `state.parameters`
 * 4. Step configs can use `"{{parameters.temperature}}"` to reference them
 * 5. This executor resolves those templates to actual values before using them
 */

import type { NeuronStepConfig } from '../types';
import { renderTemplate, getNestedProperty } from '../templateRenderer';
import { executeWithErrorHandling } from './errorHandler';

// Debug logging - set to true to enable verbose logs
const DEBUG = false;

/**
 * Resolve a config value that might be a template string like "{{parameters.temperature}}"
 * Returns the resolved value (as number if it was a parameter reference) or the original value
 */
function resolveConfigValue(value: any, state: any): any {
  if (typeof value !== 'string') {
    return value;
  }
  
  // Check if it's a simple parameter template like "{{parameters.temperature}}"
  const paramMatch = value.match(/^\{\{parameters\.(\w+)\}\}$/);
  if (paramMatch && state.parameters) {
    const paramName = paramMatch[1];
    const resolved = state.parameters[paramName];
    if (resolved !== undefined) {
      if (DEBUG) console.log(`[NeuronExecutor] Resolved parameter ${paramName}:`, resolved);
      return resolved;
    }
  }
  
  // Check if it's a state reference like "{{state.data.someValue}}"
  const stateMatch = value.match(/^\{\{state\.(.+)\}\}$/);
  if (stateMatch) {
    const path = stateMatch[1];
    const resolved = getNestedProperty(state, path);
    if (resolved !== undefined) {
      if (DEBUG) console.log(`[NeuronExecutor] Resolved state path ${path}:`, resolved);
      return resolved;
    }
  }
  
  // Not a template or couldn't resolve - return as-is
  return value;
}

/**
 * Execute a neuron step (with error handling wrapper)
 * 
 * @param config - Neuron step configuration
 * @param state - Current graph state
 * @returns Partial state with output field set to LLM response
 */
export async function executeNeuron(
  config: NeuronStepConfig,
  state: any
): Promise<Partial<any>> {
  // If error handling configured, wrap execution
  if (config.errorHandling) {
    return executeWithErrorHandling(
      () => executeNeuronInternal(config, state),
      config.errorHandling,
      { 
        type: 'neuron', 
        field: config.outputField 
      }
    );
  }
  
  // Otherwise execute directly
  return executeNeuronInternal(config, state);
}

/**
 * Internal neuron execution (actual LLM call logic)
 * 
 * Flow:
 * 1. Get neuron instance (or use default LLM)
 * 2. Render system and user prompt templates
 * 3. Build messages array
 * 4. Invoke LLM with configured parameters
 * 5. Return result in specified output field
 * 
 * @param config - Neuron step configuration
 * @param state - Current graph state (includes accumulated updates from previous steps + infrastructure)
 * @returns Partial state with output field set to LLM response
 */
async function executeNeuronInternal(
  config: NeuronStepConfig,
  state: any
): Promise<Partial<any>> {
  try {
    // Get neuron registry from state
    const neuronRegistry = state.neuronRegistry;
    
    // Determine which neuron ID to use
    const neuronId = config.neuronId || state.defaultNeuronId || state.data?.defaultNeuronId;
    
    if (!neuronId) {
      throw new Error('No neuron available: config.neuronId not set and no default neuron in state');
    }
    
    // Resolve any template values in config (e.g., "{{parameters.temperature}}" -> 0.3)
    const resolvedTemperature = resolveConfigValue(config.temperature, state);
    const resolvedMaxTokens = resolveConfigValue(config.maxTokens, state);
    
    // Build overrides object for model creation (only include resolved numeric values)
    const modelOverrides: { temperature?: number; maxTokens?: number } = {};
    if (typeof resolvedTemperature === 'number') {
      modelOverrides.temperature = resolvedTemperature;
    }
    if (typeof resolvedMaxTokens === 'number') {
      modelOverrides.maxTokens = resolvedMaxTokens;
    }
    
    if (DEBUG && Object.keys(modelOverrides).length > 0) {
      console.log('[NeuronExecutor] Applying model overrides:', modelOverrides);
    }
    
    // Get model instance from registry (returns LangChain BaseChatModel)
    // Support userId at root or in data
    const userId = state.userId || state.data?.userId;
    let model = await neuronRegistry.getModel(
      neuronId, 
      userId,
      Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined
    );
    
    if (!model) {
      throw new Error(`Failed to get model for neuron: ${neuronId}`);
    }
    
    // Check if this is an Ollama model for special handling
    const isOllamaModel = model.constructor.name === 'ChatOllama';
    
    // For structured output, we need different handling based on provider
    let useNativeFormat = false;
    
    // Apply structured output if configured
    if (config.structuredOutput) {
      if (DEBUG) console.log('[NeuronExecutor] Using structured output with schema', {
        neuronId,
        outputField: config.outputField,
        schemaKeys: Object.keys(config.structuredOutput.schema),
        isOllamaModel
      });
      
      if (isOllamaModel) {
        // For Ollama, we'll pass the format at invocation time instead of using withStructuredOutput
        // This avoids the tool-binding issues with Ollama's JSON schema validation
        useNativeFormat = true;
        if (DEBUG) console.log('[NeuronExecutor] Will use Ollama native format at invocation');
      } else {
        // For other providers (OpenAI, Anthropic), use standard withStructuredOutput
        model = model.withStructuredOutput(config.structuredOutput.schema, {
          method: config.structuredOutput.method || 'jsonSchema',
          name: config.structuredOutput.name || 'extract'
        });
      }
    }
    
    // Check if userPrompt is a reference to an existing messages array
    // Pattern: {{state.messages}} or {{state.someMessagesField}} or {{state.data.messages}}
    const messagesFieldMatch = config.userPrompt.match(/^\{\{state\.([\w\.]+)\}\}$/);
    
    let messages: Array<{ role: string; content: string }>;
    
    if (messagesFieldMatch) {
      // User prompt is a direct reference to a messages field (e.g., {{state.messages}})
      const fieldName = messagesFieldMatch[1];
      const messagesArray = getNestedProperty(state, fieldName);
      
      // Debug: log what we got
      console.log('[NeuronExecutor] Looking for messages at field:', fieldName);
      console.log('[NeuronExecutor] state.data keys:', state.data ? Object.keys(state.data) : 'no data');
      console.log('[NeuronExecutor] messagesArray type:', typeof messagesArray, Array.isArray(messagesArray) ? 'is array' : 'not array');
      
      if (Array.isArray(messagesArray)) {
        messages = [...messagesArray]; // Clone array to avoid mutating state
        
        // If config.systemPrompt is provided or systemPrefix exists, prepend/replace system message
        if (config.systemPrompt || state.systemPrefix) {
          let systemPrompt = config.systemPrompt 
            ? renderTemplate(config.systemPrompt, state)
            : '';
            
          if (state.systemPrefix) {
            systemPrompt = systemPrompt 
              ? `${state.systemPrefix}\n\n${systemPrompt}`
              : state.systemPrefix;
          }
          
          // Check if first message is already a system message
          if (messages.length > 0 && messages[0].role === 'system') {
            // Replace existing system message
            messages[0] = { role: 'system', content: systemPrompt };
            if (DEBUG) console.log('[NeuronExecutor] Using pre-built messages with system override', {
              fieldName,
              messageCount: messages.length
            });
          } else {
            // Prepend system message
            messages.unshift({ role: 'system', content: systemPrompt });
            if (DEBUG) console.log('[NeuronExecutor] Using pre-built messages with prepended system', {
              fieldName,
              messageCount: messages.length
            });
          }
        } else {
          if (DEBUG) console.log('[NeuronExecutor] Using pre-built messages array', {
            fieldName,
            messageCount: messages.length
          });
        }
      } else {
        throw new Error(`Field ${fieldName} is not an array. Cannot use as messages.`);
      }
    } else {
      // Standard template rendering for prompts
      let systemPrompt = config.systemPrompt 
        ? renderTemplate(config.systemPrompt, state)
        : undefined;
      
      // Prepend system prefix if available
      if (state.systemPrefix) {
        systemPrompt = systemPrompt 
          ? `${state.systemPrefix}\n\n${systemPrompt}`
          : state.systemPrefix;
      }

      const userPrompt = renderTemplate(config.userPrompt, state);
      
      if (DEBUG) console.log('[NeuronExecutor] Building messages from templates', {
        neuronId: neuronId,
        outputField: config.outputField
      });
      
      // Build messages
      messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: userPrompt });
    }
    
    // Check if this step should stream to user
    const streamToUser = config.stream === true;
    
    // Set flag in state so LangGraph/respond.ts can access it
    // This allows respond.ts to filter which streaming events reach the client
    state._currentStepStreamToUser = streamToUser;
    
    // Structured output doesn't support streaming - use invoke instead
    let response: any;
    
    if (config.structuredOutput) {
      // Invoke for structured output
      let rawResponse: any;
      
      if (useNativeFormat) {
        // For Ollama, pass the format option at invocation time
        rawResponse = await model.invoke(messages, {
          format: config.structuredOutput.schema
        });
      } else {
        // For other providers using withStructuredOutput
        rawResponse = await model.invoke(messages);
      }
      
      // Handle different response formats based on provider
      if (useNativeFormat) {
        // Ollama with native format returns AIMessage with JSON string content
        const content = typeof rawResponse.content === 'string' 
          ? rawResponse.content 
          : String(rawResponse.content);
        
        try {
          response = JSON.parse(content);
          if (DEBUG) console.log('[NeuronExecutor] Parsed Ollama native format response', {
            outputField: config.outputField,
            responseKeys: Object.keys(response)
          });
        } catch (parseError) {
          console.error('[NeuronExecutor] Failed to parse JSON from Ollama response', {
            content: content.substring(0, 200),
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
          throw new Error(`Failed to parse structured output: ${content.substring(0, 100)}`);
        }
      } else {
        // withStructuredOutput returns parsed object directly
        response = rawResponse;
      }
      
      if (DEBUG) console.log('[NeuronExecutor] Structured output received', {
        outputField: config.outputField,
        responseKeys: typeof response === 'object' ? Object.keys(response) : 'N/A'
      });
    } else {
      // Stream from LangChain model for standard text responses
      // Always use streaming internally for 10-20% performance improvement
      // The streamToUser flag controls whether chunks reach the client
      console.log('[NeuronExecutor] Starting stream from model...');
      const streamStartTime = Date.now();
      const stream = await model.stream(messages);
      console.log(`[NeuronExecutor] Stream started after ${Date.now() - streamStartTime}ms`);
      
      response = '';
      let chunkCount = 0;
      
      // Accumulate chunks
      for await (const chunk of stream) {
        chunkCount++;
        if (chunkCount === 1) {
          console.log(`[NeuronExecutor] First chunk received after ${Date.now() - streamStartTime}ms`);
        }
        if (chunk.content) {
          response += chunk.content;
          // Note: Whether chunks reach the user is decided by respond.ts
          // based on state._currentStepStreamToUser flag
        }
      }
      console.log(`[NeuronExecutor] Stream complete: ${chunkCount} chunks, ${response.length} chars, ${Date.now() - streamStartTime}ms`);
    }
    
    // Clear the flag after streaming completes
    state._currentStepStreamToUser = undefined;
    
    // Log response details (handle both string and object responses)
    if (config.structuredOutput) {
      console.log('[NeuronExecutor] Structured output response', {
        outputField: config.outputField,
        responseKeys: typeof response === 'object' ? Object.keys(response) : 'N/A',
        // Show full execution plan for planner debugging
        response: config.outputField.includes('executionPlan') ? JSON.stringify(response, null, 2) : undefined
      });
    } else if (DEBUG) {
      console.log('[NeuronExecutor] Neuron response received', {
        outputField: config.outputField,
        responseLength: response.length
      });
    }
    
    // Return output field
    return {
      [config.outputField]: response
    };
    
  } catch (error) {
    console.error('[NeuronExecutor] Neuron step failed', {
      neuronId: config.neuronId,
      outputField: config.outputField,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error(`Neuron step failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
