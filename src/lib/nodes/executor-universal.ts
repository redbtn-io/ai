/**
 * Universal Executor/Tool Picker Node - Phase 2.5
 * 
 * Orchestrates execution plan steps by routing to appropriate tools/nodes.
 * Reads current step from execution plan and determines next action.
 * 
 * Input: executionPlan (with steps array), currentStepIndex
 * Output: nextGraph (routing decision), toolParam (for the next node)
 */

import type { UniversalNodeConfig } from './universal/types';

/**
 * Executor node configuration
 * Routes execution plan steps to appropriate handlers
 */
export const universalExecutorConfig: UniversalNodeConfig = {
  steps: [
    // Step 1: Check if plan exists
    {
      type: 'conditional',
      config: {
        condition: '{{state.executionPlan.steps.length}} > 0',
        setField: 'hasPlan',
        trueValue: true,
        falseValue: false
      }
    },
    
    // Step 2: Get current step from plan
    {
      type: 'transform',
      config: {
        operation: 'select',
        inputField: 'executionPlan.steps',
        transform: '[{{state.currentStepIndex || 0}}]',
        outputField: 'currentStep'
      }
    },
    
    // Step 3: Route based on step type - Search
    {
      type: 'conditional',
      config: {
        condition: '{{state.currentStep.type}} == "search"',
        setField: 'nextGraph',
        trueValue: 'search',
        falseValue: 'undecided'
      }
    },
    
    // Step 4: Set search query as toolParam
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "search"',
        setField: 'toolParam',
        trueValue: '{{state.currentStep.searchQuery}}',
        falseValue: ''
      }
    },
    
    // Step 5: Route based on step type - Command
    {
      type: 'conditional',
      config: {
        condition: '{{state.currentStep.type}} == "command" && {{state.nextGraph}} == "undecided"',
        setField: 'nextGraph',
        trueValue: 'command',
        falseValue: '{{state.nextGraph}}'
      }
    },
    
    // Step 6: Set command details
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "command"',
        setField: 'commandDomain',
        trueValue: '{{state.currentStep.domain}}',
        falseValue: ''
      }
    },
    
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "command"',
        setField: 'commandDetails',
        trueValue: '{{state.currentStep.commandDetails}}',
        falseValue: ''
      }
    },
    
    // Step 7: Route based on step type - Respond (final step)
    {
      type: 'conditional',
      config: {
        condition: '{{state.currentStep.type}} == "respond" && {{state.nextGraph}} == "undecided"',
        setField: 'nextGraph',
        trueValue: 'responder',
        falseValue: '{{state.nextGraph}}'
      }
    },
    
    // Step 8: Default to responder if no valid route
    {
      type: 'conditional',
      config: {
        condition: '{{state.nextGraph}} == "undecided"',
        setField: 'nextGraph',
        trueValue: 'responder',
        falseValue: '{{state.nextGraph}}'
      }
    },
    
    // Step 9: Increment step index for next iteration
    {
      type: 'conditional',
      config: {
        condition: 'true',
        setField: 'currentStepIndex',
        trueValue: '{{(state.currentStepIndex || 0) + 1}}',
        falseValue: '0'
      }
    }
  ]
};

/**
 * Export for NODE_REGISTRY
 */
export const executorNodeUniversal = universalExecutorConfig;
