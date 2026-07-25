# Persistence

Wordless is local-first and uses separate stores for append-only Agent history and queryable application metadata.

```text
userData/
|-- wordless.db
|-- sessions/<session-id>.jsonl
|-- artifacts/<project-id>/
|-- logs/
`-- cache/
```

## JSONL

JSONL is authoritative for session history and uses the Agent session tree model. It stores complete messages, tool results, model and thinking changes, active tools, compaction, branches, profile ID and version, project ID, and custom stable entries. Token deltas and transient progress are never journaled.

## SQLite

SQLite stores settings, projects, searchable session metadata, model selections, credential references, artifact indexes, and permission decisions. Schema changes use ordered versioned migrations; startup never infers schema solely by probing for missing columns.

## Consistency and Recovery

For session changes, append and flush JSONL before updating the SQLite index. Startup reconciliation detects missing or stale index rows and rebuilds them from session headers and stable entries. Artifact files are written atomically before their index rows become visible.

## Credentials

Credentials are represented outside the AI layer by opaque IDs. Electron `safeStorage` encrypts secrets through a Main adapter. Plaintext API keys must not enter JSONL, logs, protocol events, renderer persistence, or SQLite metadata fields.
