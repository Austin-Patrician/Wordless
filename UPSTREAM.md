# Upstream Source Record

`packages/ai` and `packages/agent` are internal Wordless forks of selected packages from pi.

| Field | Value |
|---|---|
| Repository | `https://github.com/earendil-works/pi.git` |
| Source commit | `0e6909f050eeb15e8f6c05185511f3788357ddb3` |
| Source package version | `0.80.6` |
| Wordless fork version | `0.80.6-wordless.0` |
| Imported packages | `packages/ai`, `packages/agent` |
| License | MIT |

## Import Policy

- Copy only files tracked by Git from the two source package directories.
- Never copy `node_modules`, `dist`, coverage, caches, or generated build artifacts.
- Preserve upstream tests, scripts, documentation, CHANGELOG files, authorship, and repository metadata.
- Apply the namespace mapping `@earendil-works/pi-ai` to `@wordless/ai` and `@earendil-works/pi-agent-core` to `@wordless/agent`.
- Mark both forks private and pin the Agent dependency on the exact matching AI fork version.

## Update Procedure

1. Record the new upstream commit and package version before copying.
2. Review upstream diffs for `packages/ai`, `packages/agent`, and shared root build requirements.
3. Replace the tracked snapshot, then reapply the namespace and private-package patch.
4. Preserve Wordless-only changes in each package's `WORDLESS_CHANGES.md`.
5. Review provider dependency, generated model metadata, export map, and session format changes explicitly.
6. Hydrate with lifecycle scripts disabled, then run package checks and tests before accepting the update.

No automated sync script exists in the framework phase. An update is a reviewed dependency change, not an unattended file copy.
