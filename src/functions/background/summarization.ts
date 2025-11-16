/**
 * Background summarization utilities
 */

import type { MemoryManager } from '../../lib/memory/memory';
import type { ChatOllama } from '@langchain/ollama';
import { extractThinking } from '../../lib/utils/thinking';
import { invokeWithRetry } from '../../lib/utils/retry';

/**
 * Trigger summarization in background (non-blocking)
 * Phase 0: Takes model factory function for per-user loading
 */
export function summarizeInBackground(
  conversationId: string,
  memory: MemoryManager,
  getModel: () => Promise<any> // Factory function to get user's model
): void {
  memory.summarizeIfNeeded(conversationId, async (prompt) => {
    const model = await getModel();
    const response = await invokeWithRetry(model, [{ role: 'user', content: prompt }], {
      context: 'background summarization',
    }) as any;
    const rawContent = response.content as string;
    
    // Extract thinking (if present) and return cleaned content
    const { cleanedContent } = extractThinking(rawContent);
    return cleanedContent;
  }).catch(err => console.error('[Red] Summarization failed:', err));
}

/**
 * Generate executive summary in background (non-blocking)
 * Called after 3rd+ AI response
 * Phase 0: Takes model factory function for per-user loading
 */
export function generateExecutiveSummaryInBackground(
  conversationId: string,
  memory: MemoryManager,
  getModel: () => Promise<any> // Factory function to get user's model
): void {
  memory.generateExecutiveSummary(conversationId, async (prompt) => {
    const model = await getModel();
    const response = await invokeWithRetry(model, [{ role: 'user', content: prompt }], {
      context: 'executive summary generation',
    }) as any;
    const rawContent = response.content as string;
    
    // Extract thinking (if present) and return cleaned content
    const { cleanedContent } = extractThinking(rawContent);
    return cleanedContent;
  }).catch(err => console.error('[Red] Executive summary generation failed:', err));
}
