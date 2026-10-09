# Wordless Changes

- Forked from pi `packages/ai` at commit `0e6909f050eeb15e8f6c05185511f3788357ddb3`.
- Renamed the private package to `@wordless/ai` with version `0.80.6-wordless.0`.
- Rewrote package self-references to the Wordless namespace.
- Synchronized the model generator from Pi commit `c5de2cc67f04d2e700617f9452a22a4242aaa1a4`, including strict failure handling, staged generation, model-data validation, and catalog support.
- Kept Wordless runtime dependency versions and namespace-specific package exports unchanged.
- Ported upstream `561a2e066` (fix(ai): send OpenCode session header) ahead of the next full sync: added
  `src/providers/opencode-headers.ts` and wrapped the `opencode` / `opencode-go` provider streams so a
  request carrying `sessionId` is dispatched with `x-opencode-session`. Without this the OpenCode gateway
  answers `MissingSessionID`. See `test/opencode-provider-headers.test.ts`.
- Extended the ported OpenCode session header support beyond upstream `561a2e066`: the rule now also matches by
  `baseUrl` host (`isOpenCodeEndpoint`) and is exported as `openCodeSessionHeadersFor()`, so layers that dispatch
  without going through a wrapped provider (a user-configured provider entry) share one implementation instead of
  duplicating it. Upstream only matches provider ids `opencode` / `opencode-go`.
- Added an additive `Usage.cacheUsageReporting` (`"unavailable" | "read-only" | "read-write"`) and
  `Usage.reportedPromptTokens`, plus `src/utils/cache-reporting.ts`, so a "cache read of 0" can be told
  apart from "the provider never reported caching". The level is decided per **response** from field
  presence (never from the value, which `|| 0` would collapse), in `anthropic-messages` (message_start,
  monotone across message_delta), `bedrock-converse-stream`, `openai-completions`, `openai-responses-shared`,
  `google-generative-ai`, `google-vertex` (read-only at most; Google never reports writes) and
  `mistral-conversations`. `pi-messages` forwards the server payload verbatim, so it stays `unavailable`
  unless the gateway sends the field. `reportedPromptTokens` is only set where the provider reports a
  prompt total that is independent of our normalized components (OpenAI/Google/Mistral), and exists so
  normalization drift can be detected instead of silently clamped. Covered by
  `test/wordless-cache-usage-reporting.test.ts`.

- Added an additive `AssistantMessage.timing` (`{ requestStartedAt, firstTokenAt?, firstTextAt?, completedAt, streamed }`),
  so first-token latency and output speed (TPS) can be shown per turn. It is **type-only in this package** — the
  values are filled by `@wordless/agent`'s agent loop, which is the only layer that sees "the first token arrived",
  and ride into the journal with the message (see `packages/agent/WORDLESS_CHANGES.md`). Shape matches
  `ModelCallTiming` in `@wordless/domain`; this package does not depend on it, so the seam is checked at the
  two mapping sites (`agent-driver-generic`, `runtime`) instead.