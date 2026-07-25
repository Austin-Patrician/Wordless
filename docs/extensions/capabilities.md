# Capabilities

A Capability packages reusable tools and context for one bounded local ability. It is independent of the scenario that consumes it.

## Planned Contract

A capability definition declares a stable ID, version, required platform ports, permissions, tool factories, optional context contributors, and cleanup behavior. Creation receives workspace scope, approval and artifact services, platform ports, and an abort signal.

Tool schemas validate all model input. Filesystem paths are canonicalized before scope checks. Tool failures throw structured errors; they are not encoded as successful text output.

## Built-In Composition

| Profile | Capabilities |
|---|---|
| General | filesystem, browser |
| Coding | filesystem, shell, browser |
| PPT | filesystem, office, design |
| Excel | filesystem, office, data |
| Data | filesystem, shell, browser, data |
| UI | filesystem, browser, design |

The manifest expresses this mapping. Runtime must not contain `if profile === ...` tool-selection branches.
