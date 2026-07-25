# Profiles

A Profile is a first-party scenario assembly, not a separate Agent implementation. Runtime creates the same Agent Harness for every profile and injects profile-specific behavior.

## Planned Contract

A profile definition declares:

- stable `id`, `version`, display metadata, and protocol schema version
- system-prompt factory and context contributors
- required and optional model capabilities
- capability IDs and active tool policy
- permission declarations
- supported artifact kinds
- lifecycle hooks and resource providers

Creation receives immutable project/session identity, selected model, capability instances, artifact service, approval service, and cancellation scope. Disposal releases only resources owned by that profile instance.

## Invariants

- A session fixes its profile ID and version when created.
- Profiles do not instantiate models, databases, Electron APIs, or global registries.
- Profiles do not call one another. Future orchestration delegates work through Runtime using explicit child sessions.
- Adding a profile requires registration in the desktop composition root and a renderer view registration, not changes to Runtime conditionals.

Built-in profiles are General, Coding, PPT, Excel, Data, and UI.
