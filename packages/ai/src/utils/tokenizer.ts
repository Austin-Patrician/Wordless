import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

/** Cross-provider safety factor for the generic BPE fallback. */
export const GENERIC_BPE_SAFETY_FACTOR = 1.25;

const tokenCache = new Map<string, number>();
const TOKEN_CACHE_LIMIT = 2048;

/** Count text with a modern multilingual BPE vocabulary. */
export function countBpeTokens(text: string): number {
	if (!text) return 0;
	const cached = tokenCache.get(text);
	if (cached !== undefined) return cached;
	const count = countTokens(text);
	if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.delete(tokenCache.keys().next().value!);
	tokenCache.set(text, count);
	return count;
}

/**
 * Estimate provider tokens with a safety factor because non-OpenAI providers
 * use different tokenizers and message framing.
 */
export function estimateBpeTokens(text: string): number {
	return Math.ceil(countBpeTokens(text) * GENERIC_BPE_SAFETY_FACTOR);
}
