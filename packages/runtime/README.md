# @wordless/runtime

Application orchestration for models, agents, sessions, runs, profiles, approvals, artifacts, and event delivery.

The runtime consumes abstract repositories and platform ports. It must not import Electron, React, concrete persistence implementations, or concrete profiles. Electron Main supplies those implementations at the composition root.

## Model request headers

`WordlessRuntime` wraps its model registry once (`model-request-headers.ts`) so every dispatch can carry a header
policy. The registry is the single object handed to the agent harness - chat, context compaction, and branch
summaries all issue their requests through it - and to `RuntimeModelConfiguration` for side requests such as
selection translation.

Two consequences are deliberate:

- Header policies installed here also cover request paths that never see this runtime's own options. Context
  compaction is the important case: it calls `models.completeSimple(...)` from inside the agent package with no
  place to attach headers.
- Anything that builds its own registry, or dispatches through the legacy global `streamSimple`, bypasses the
  policy. Drivers must use the injected registry instead of constructing one.
