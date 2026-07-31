# @wordless/desktop

Electron application host. The current JavaScript files are a dependency-free shell only.

Future process ownership:

- Main: composition root, runtime lifecycle, IPC handlers, Electron adapters, windows, and security policy
- Preload: narrow validated bridge defined by `@wordless/protocol`
- Renderer: React workbench consuming snapshots and runtime events only

The renderer must never import Node, persistence, AI, Agent, capabilities, or concrete profiles.

## Desktop releases

Stable releases are created by pushing a SemVer tag such as `v1.2.3`. The
`Release Desktop` workflow validates and tests the tagged source, builds macOS
and Windows artifacts, uploads them to a draft GitHub Release, and publishes the
release only after every platform succeeds.

Windows release signing requires these repository Actions secrets:

- `WINDOWS_CSC_LINK`: an electron-builder compatible certificate URL or a
  Base64-encoded PFX certificate
- `WINDOWS_CSC_KEY_PASSWORD`: the PFX password

macOS artifacts are intentionally unsigned and not notarized. The application
downloads and verifies the matching DMG, then asks the user to open it and
replace Wordless manually. Windows uses the signed NSIS updater and installs
only after the user chooses `Restart & install`.

GitHub Release bodies are the source of truth for in-app release history.
Label pull requests with `feature`, `fix`, `performance`, `documentation`, or
`dependencies` so GitHub can categorize generated notes.
