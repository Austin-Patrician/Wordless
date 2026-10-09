# Wordless Changes

- Forked from pi `packages/agent` at commit `0e6909f050eeb15e8f6c05185511f3788357ddb3`.
- Renamed the private package to `@wordless/agent` with version `0.80.6-wordless.0`.
- Rewrote AI and Agent package references to the Wordless namespace.
- Summarization requests (`generateSummary`, `generateTurnPrefixSummary`, branch summarization) now carry
  their own request identity: `withSummaryRequestIdentity()` adds a generated `sessionId` and
  `cacheRetention: "none"`. This mirrors upstream `9b23c6583` behaviour, which the fork predates, and is
  required for providers that route per conversation (OpenCode rejects a header-less request).
- Note: `src/harness/compaction/compaction.ts` already differs from the fork base `0e6909f` well beyond
  namespace rewrites (prompt-token accounting via `calculatePromptTokens`, `getLastAssistantUsageInfo`,
  bounded serialization). That divergence was not recorded here previously; review it against upstream
  before replacing the file during a sync.

- `src/agent-loop.ts` now records **call timing** on the final assistant message: `requestStartedAt` (just before
  the provider stream is created), `firstTokenAt` (the first content delta of any kind — `text_*`, `thinking_*` or
  `toolcall_*`), `firstTextAt` (first `text_*` delta) and `completedAt`, plus `streamed` (whether any delta was
  observed at all). Upstream has no timing fields and providers do not report TTFT, so the stream consumer is the
  only place these can be taken. It rides into the journal for free: `message_end` persists the whole message object
  (`AgentHarness` → `session.appendMessage`). `streamed: false` must be read as "first token / speed unavailable",
  never as 0 or as "TTFT == total duration" (non-streaming responses would lie otherwise). See
  `packages/ai/WORDLESS_CHANGES.md` for the type, and `packages/domain`'s `ModelCallTiming` / `summarizeTurnLatency`
  for the consumption contract.