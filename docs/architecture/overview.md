# Architecture Overview

Wordless is a modular monolith. Electron provides the desktop host, while `@wordless/runtime` owns application behavior. There is no HTTP backend and no separate Agent process in the first version.

```text
React Renderer
    | validated commands and runtime events
Preload Bridge
    |
Electron Main (composition root)
    |-- Wordless Runtime
    |     |-- @wordless/agent -> @wordless/ai -> user-selected provider
    |     |-- Profile Registry -> Profile -> Capabilities
    |     `-- repository and platform ports
    |-- JSONL / SQLite adapters
    |-- Node execution adapters
    `-- Electron credential, window, browser, and notification adapters
```

## Process Ownership

- Renderer owns presentation state, user input, profile workbench views, and transient UI preferences.
- Preload exposes a narrow protocol-specific API. It does not expose `ipcRenderer` or arbitrary channel names.
- Main owns trusted local capabilities, credentials, runtime lifecycle, persistence, and the composition root.
- Runtime owns sessions and runs but does not know it is hosted by Electron.

## Runtime Flow

1. Main creates repositories, platform adapters, capability factories, and built-in profiles.
2. Main registers profiles with Runtime and binds RuntimeTransport to Electron IPC.
3. Renderer requests a session snapshot, then subscribes to ordered runtime events.
4. Runtime creates an `AgentHarness` using the selected fixed profile and model collection.
5. Pi Agent events are normalized by a Wordless event adapter before crossing IPC.
6. Stable session entries are appended to JSONL; query metadata is updated in SQLite.

The initial in-process transport must remain replaceable. Long-running or unstable capabilities may later move to workers without changing Profile or Renderer contracts.
