# Runtime Protocol

Pi `AgentEvent` is the internal event source, not the Electron wire contract. Runtime maps provider and Agent objects into versioned, serializable Wordless DTOs.

## Envelope

Every event envelope carries:

- `protocolVersion`
- `runtimeInstanceId`, regenerated when Runtime starts
- globally unique `eventId`
- `sessionId`
- optional `runId`
- monotonically increasing per-session `sequence`
- `timestamp`
- a discriminated `event` payload

Renderer requests a fresh session snapshot when the runtime instance changes or an event sequence gap is detected.

## Commands

Command families are `runtime`, `profile`, `project`, `session`, `agent`, `model`, `credential`, `approval`, and `artifact`. Commands receive a correlated success or structured failure response. Errors expose a stable code, safe message, retryability, and optional details; raw exceptions and secrets never cross IPC.

## Events

Runtime events cover run lifecycle, message lifecycle, tool execution, queue state, compaction, retry, approval, artifact changes, model state, and recoverable errors. A run receives a Runtime-generated `runId` before invoking Agent.

`run.completed` means Agent output has ended. `session.idle` means awaited persistence, retry, compaction, and subscriber work has settled. The UI must not treat these as equivalent.

## Delivery

- Adjacent text or thinking deltas may be coalesced and flushed at most once per animation frame.
- Message completion, tool completion, approvals, errors, and run completion flush immediately.
- Events remain ordered within a session; batching must not reorder lifecycle boundaries.
- Renderer reduces events into view state instead of mutating multiple feature stores directly.

## Journal Boundary

Streaming deltas, progress, and loading state are transient. Complete messages, tool results, model and thinking changes, compaction, branches, profile identity, artifact references, and approval decisions are stable journal entries.
