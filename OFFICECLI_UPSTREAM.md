# OfficeCLI Upstream Record

Wordless ships OfficeCLI as a pinned external Office engine. It is not updated independently on user machines.

- Repository: `https://github.com/iOfficeAI/OfficeCLI`
- Locked release: `v1.0.142`
- Lock manifest: `apps/desktop/scripts/officecli.lock.json`
- Runtime auto-update: disabled with `OFFICECLI_SKIP_UPDATE=1`

## Update Procedure

1. Run `npm run update:officecli --workspace @wordless/desktop -- vX.Y.Z`.
2. Run `npm run prepare:officecli --workspace @wordless/desktop` on each release platform.
3. Review `officecli help pptx --json` and `officecli help xlsx --json` contract changes.
4. Run Office capability, desktop host, Presentation, and Spreadsheet driver tests.
5. Commit the reviewed lock and adapter changes with the Wordless release.

Do not point production builds at `latest` or replace the bundled binary without updating the lock.
