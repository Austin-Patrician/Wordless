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
