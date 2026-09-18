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
