# @wordless/desktop

Electron application host. The current JavaScript files are a dependency-free shell only.

Future process ownership:

- Main: composition root, runtime lifecycle, IPC handlers, Electron adapters, windows, and security policy
- Preload: narrow validated bridge defined by `@wordless/protocol`
- Renderer: React workbench consuming snapshots and runtime events only

The renderer must never import Node, persistence, AI, Agent, capabilities, or concrete profiles.
