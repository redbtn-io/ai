/**
 * Neuron Step Executor
 * 
 * Executes LLM calls with template rendering for prompts.
 * Supports custom neurons or default LLM with configurable parameters.
 */

import type { NeuronStepConfig } from '../types';
import { renderTemplate } from '../templateRenderer';
import { executeWithErrorHandling } from './errorHandler';

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
    const neuronId = config.neuronId || state.defaultNeuronId;
    
    if (!neuronId) {
      throw new Error('No neuron available: config.neuronId not set and no default neuron in state');
    }
    
    // Get model instance from registry (returns LangChain BaseChatModel)
    let model = await neuronRegistry.getModel(neuronId, state.userId);
    
    if (!model) {
      throw new Error(`Failed to get model for neuron: ${neuronId}`);
    }
    
    // Apply structured output if configured
    if (config.structuredOutput) {
      console.log('[NeuronExecutor] Using structured output with schema', {
        neuronId,
        outputField: config.outputField,
        schemaKeys: Object.keys(config.structuredOutput.schema)
      });
      
      model = model.withStructuredOutput({
        schema: config.structuredOutput.schema,
        method: config.structuredOutput.method || 'auto'
      });
    }
    
    // Check if userPrompt is a reference to an existing messages array
    // Pattern: {{state.messages}} or {{state.someMessagesField}}
    const messagesFieldMatch = config.userPrompt.match(/^\{\{state\.(\w+)\}\}$/);
    
    let messages: Array<{ role: string; content: string }>;
    
    if (messagesFieldMatch) {
      // User prompt is a direct reference to a messages field (e.g., {{state.messages}})
      const fieldName = messagesFieldMatch[1];
      const messagesArray = state[fieldName];
      
      if (Array.isArray(messagesArray)) {
        messages = [...messagesArray]; // Clone array to avoid mutating state
        
        // If config.systemPrompt is provided, prepend/replace system message
        if (config.systemPrompt) {
          const systemPrompt = renderTemplate(config.systemPrompt, state);
          
          // Check if first message is already a system message
          if (messages.length > 0 && messages[0].role === 'system') {
            // Replace existing system message
            messages[0] = { role: 'system', content: systemPrompt };
            console.log('[NeuronExecutor] Using pre-built messages with system message override', {
              fieldName,
              messageCount: messages.length,
              systemPromptPreview: systemPrompt.substring(0, 100),
              outputField: config.outputField
            });
          } else {
            // Prepend system message
            messages.unshift({ role: 'system', content: systemPrompt });
            console.log('[NeuronExecutor] Using pre-built messages with prepended system message', {
              fieldName,
              messageCount: messages.length,
              systemPromptPreview: systemPrompt.substring(0, 100),
              outputField: config.outputField
            });
          }
        } else {
          console.log('[NeuronExecutor] Using pre-built messages array from state', {
            fieldName,
            messageCount: messages.length,
            outputField: config.outputField
          });
        }
      } else {
        throw new Error(`Field ${fieldName} is not an array. Cannot use as messages.`);
      }
    } else {
      // Standard template rendering for prompts
      const systemPrompt = config.systemPrompt 
        ? renderTemplate(config.systemPrompt, state)
        : undefined;
      const userPrompt = renderTemplate(config.userPrompt, state);
      
      console.log('[NeuronExecutor] Building messages from templates', {
        neuronId: neuronId,
        systemPrompt: systemPrompt?.substring(0, 100),
        userPrompt: userPrompt.substring(0, 100),
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
      // Invoke for structured output (returns parsed object directly)
      response = await model.invoke(messages);
      
      console.log('[NeuronExecutor] Structured output received', {
        outputField: config.outputField,
        responseType: typeof response,
        responseKeys: typeof response === 'object' ? Object.keys(response) : 'N/A',
        hasContent: !!response,
        fullResponse: JSON.stringify(response, null, 2)
      });
    } else {
      // Stream from LangChain model for standard text responses
      // Always use streaming internally for 10-20% performance improvement
      // The streamToUser flag controls whether chunks reach the client
      const stream = await model.stream(messages);
      
      response = '';
      
      // Accumulate chunks
      for await (const chunk of stream) {
        if (chunk.content) {
          response += chunk.content;
          // Note: Whether chunks reach the user is decided by respond.ts
          // based on state._currentStepStreamToUser flag
        }
      }
    }
    
    // Clear the flag after streaming completes
    state._currentStepStreamToUser = undefined;
    
    // Log response details (handle both string and object responses)
    if (config.structuredOutput) {
      console.log('[NeuronExecutor] Structured output response', {
        outputField: config.outputField,
        responseType: typeof response,
        responseSample: JSON.stringify(response).substring(0, 200)
      });
    } else {
      console.log('[NeuronExecutor] Neuron response received', {
        outputField: config.outputField,
        responseLength: response.length,
        responseSample: response.substring(0, 100)
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
