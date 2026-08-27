import type { AssistantMessage, Context, ImageContent, Message, TextContent, Tool, Usage } from "../types.ts";
import { estimateBpeTokens } from "./tokenizer.ts";

export interface ContextUsageEstimate {
	/** Estimated total context tokens. */
	tokens: number;
	/** Tokens reported by the most recent applicable assistant usage block. */
	usageTokens: number;
	/** Estimated tokens after the most recent applicable assistant usage block. */
	trailingTokens: number;
	/** Index of the applicable message that provided usage, or null when none exists. */
	lastUsageIndex: number | null;
}

const ESTIMATED_IMAGE_TOKENS = 1200;

/** Prompt tokens reported by a provider. Output never belongs to the prompt baseline. */
export function calculatePromptTokens(usage: Usage): number {
	const componentTotal = usage.input + usage.cacheRead + usage.cacheWrite;
	if (Number.isFinite(componentTotal) && componentTotal > 0) return Math.max(0, Math.floor(componentTotal));
	return Math.max(0, Math.floor((usage.totalTokens || 0) - (usage.output || 0)));
}

/** @deprecated Use calculatePromptTokens. */
export const calculateContextTokens = calculatePromptTokens;

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "undefined";
	} catch {
		return "[unserializable]";
	}
}

export function estimateTextTokens(text: string): number {
	return estimateBpeTokens(text);
}

export function estimateTextAndImageContentTokens(content: string | Array<TextContent | ImageContent>): number {
	if (typeof content === "string") return estimateTextTokens(content);
	let tokens = 0;
	for (const block of content) tokens += block.type === "text" ? estimateTextTokens(block.text) : ESTIMATED_IMAGE_TOKENS;
	return tokens;
}

export function estimateMessageTokens(message: Message): number {
	const framingTokens = 4;
	if (message.role === "user") return framingTokens + estimateTextAndImageContentTokens(message.content);
	if (message.role === "toolResult") {
		return framingTokens + estimateTextTokens(message.toolName) + estimateTextAndImageContentTokens(message.content);
	}

	let tokens = framingTokens;
	for (const block of message.content) {
		if (block.type === "text") {
			tokens += estimateTextTokens(block.text);
		} else if (block.type === "thinking") {
			tokens += estimateTextTokens(block.thinking);
		} else {
			tokens += estimateTextTokens(block.name) + estimateTextTokens(safeJsonStringify(block.arguments));
		}
	}
	return tokens;
}

function getLastAssistantUsageInfo(messages: readonly Message[]): { usage: Usage; index: number } | undefined {
	let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
	let usageInfo: { usage: Usage; index: number } | undefined;

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === "assistant") {
			const assistant = message as AssistantMessage;
			// A newer prefix message was inserted after this response (for example, a
			// compaction summary), so its usage cannot describe the current prefix.
			const usageAppliesToPrefix = assistant.timestamp >= latestPrefixTimestamp;
			if (
				usageAppliesToPrefix &&
				assistant.stopReason !== "aborted" &&
				assistant.stopReason !== "error" &&
				calculatePromptTokens(assistant.usage) > 0
			) {
				usageInfo = { usage: assistant.usage, index: i };
			}
		}
		latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
	}

	return usageInfo;
}

function estimateMessages(messages: readonly Message[]): ContextUsageEstimate {
	const usageInfo = getLastAssistantUsageInfo(messages);
	if (usageInfo) {
		const usageTokens = calculatePromptTokens(usageInfo.usage);
		let trailingTokens = 0;
		// Provider usage describes the prompt before this assistant response. The
		// response itself is part of the next request and must be counted as delta.
		for (let i = usageInfo.index; i < messages.length; i++) {
			trailingTokens += estimateMessageTokens(messages[i]);
		}
		return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: usageInfo.index };
	}

	let tokens = 0;
	for (const message of messages) tokens += estimateMessageTokens(message);
	return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}

function estimateToolsTokens(tools: readonly Tool[] | undefined): number {
	if (!tools || tools.length === 0) return 0;
	return estimateTextTokens(safeJsonStringify(tools));
}

function isMessageArray(value: Context | readonly Message[]): value is readonly Message[] {
	return Array.isArray(value);
}

export function estimateContextTokens(context: Context | readonly Message[]): ContextUsageEstimate {
	if (isMessageArray(context)) return estimateMessages(context);

	const estimate = estimateMessages(context.messages);
	if (estimate.lastUsageIndex !== null) {
		const addedNames = new Set(
			context.messages
				.slice(estimate.lastUsageIndex)
				.filter((message) => message.role === "toolResult")
				.flatMap((message) => message.addedToolNames ?? []),
		);
		const addedToolTokens = estimateToolsTokens(context.tools?.filter((tool) => addedNames.has(tool.name)));
		return {
			tokens: estimate.tokens + addedToolTokens,
			usageTokens: estimate.usageTokens,
			trailingTokens: estimate.trailingTokens + addedToolTokens,
			lastUsageIndex: estimate.lastUsageIndex,
		};
	}

	const prefixTokens =
		(context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0) + estimateToolsTokens(context.tools);

	return {
		tokens: estimate.tokens + prefixTokens,
		usageTokens: estimate.usageTokens,
		trailingTokens: estimate.trailingTokens + prefixTokens,
		lastUsageIndex: estimate.lastUsageIndex,
	};
}
