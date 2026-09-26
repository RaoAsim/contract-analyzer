import { countTokens as gptCount } from "gpt-tokenizer";

/**
 * Token counting for budgets. gpt-tokenizer (o200k) is exact for OpenAI models and an approximation
 * for other providers, so callers keep a safety margin (§4).
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return gptCount(text);
}

/** Cheap estimate for hot loops (splitting, trimming): ~4 characters per token for English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
