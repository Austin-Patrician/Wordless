# Wordless

Wordless is a local-first, cross-platform desktop Agent workspace built around the Wordless forks of pi AI and Agent.

## Current State

- Dependency-free Electron shell under `apps/desktop`
- Full source snapshots of pi `packages/ai` and `packages/agent`
- Private workspace boundaries for runtime, protocol, persistence, capabilities, and profiles
- Architecture documentation only for new Wordless packages; no scenario runtime is implemented yet
- No Wordless lockfile or installed dependencies

## Workspace

```text
apps/desktop                 Electron main, preload, and React renderer host
packages/ai                  @wordless/ai fork
packages/agent               @wordless/agent fork
packages/domain              Pure domain model and ports
packages/protocol            Cross-process wire contracts
packages/runtime             Application orchestration
packages/profile-sdk         Profile and capability contracts
packages/persistence         JSONL and SQLite adapters
packages/platform-node       Node execution environment adapters
packages/ui-kit              Shared renderer state and presentation primitives
packages/capabilities/*      Reusable tool capabilities
packages/profiles/*          Built-in scenario assemblies
```

Start with [Architecture Overview](docs/architecture/overview.md) and [Dependency Rules](docs/architecture/dependencies.md). Fork provenance and update policy are recorded in [UPSTREAM.md](UPSTREAM.md).
