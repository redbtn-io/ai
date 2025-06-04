

import { encoding_for_model, TiktokenModel } from "tiktoken";
import { openai } from "../openai/client";

const MODEL_NAME = "gpt-4o";
const MAX_TOKENS = 8000;
const SUMMARY_BUFFER = 500; // Reserve this many tokens for summary

type Message = { role: "user" | "assistant"; content: string };
type Options = { model?: TiktokenModel; max_tokens?: number; buffer?: number };
type SummaryResponse = {
  context: string[];
  tokens: number;
  summary?: string;
};

export async function formatContextWithSummary(
  conversation: Message[],
  options?: Options
): Promise<SummaryResponse> {
  let totalTokens = 0;
  const retained: string[] = [];
  const truncated: Message[] = [];
  const enc = encoding_for_model(options?.model || MODEL_NAME);
  const tokensMinusBuffer = options?.max_tokens || MAX_TOKENS - (options?.buffer || SUMMARY_BUFFER);

  // Go from newest to oldest
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    const formatted = `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`;
    const tokens = enc.encode(formatted).length;

    if (totalTokens + tokens > tokensMinusBuffer) {
      truncated.unshift(msg); // keep chronological order
    } else {
      totalTokens += tokens;
      retained.unshift(formatted);
    }
  }

  // Generate summary if truncation occurred
  if (truncated.length > 0) {
    const summaryPrompt = truncated
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const summaryRes = await openai.chat.completions.create({
      model: options?.model || MODEL_NAME,
      messages: [
        {
          role: "system",
          content: "Summarize the following conversation in a short paragraph:",
        },
        {
          role: "user",
          content: summaryPrompt,
        },
      ],
      max_tokens: options?.buffer || SUMMARY_BUFFER,
    });

    const summaryText = summaryRes.choices[0].message.content ?? "[Summary unavailable]";
    return {
        context: retained,
        tokens: totalTokens,
        summary: summaryText,
    }
  }

  // No truncation — return entire context
  return {
    context: retained,
    tokens: totalTokens,
  }
}
