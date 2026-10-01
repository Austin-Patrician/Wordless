# Third-Party Notices

## pi AI and Agent

Wordless includes modified source snapshots of `packages/ai` and `packages/agent` from the pi project.

- Copyright: 2025 Mario Zechner and contributors
- Source: `https://github.com/earendil-works/pi`
- License: MIT
- License text: `third_party/pi/LICENSE`

The package READMEs, CHANGELOG files, repository metadata, and upstream history references are retained with the fork.

## Bundled Python runtime

Wordless ships a standalone CPython build so that ordinary users do not have to install
Python themselves. The archive is downloaded at package time (never at runtime), verified
against a locked SHA-256, extracted, and copied into the user's data directory on first
launch. The copy inside the application bundle is never modified in place.

- Distribution: `python-build-standalone` (Astral)
- Source: `https://github.com/astral-sh/python-build-standalone`
- License: Python Software Foundation License 2.0 (PSF-2.0)
- Notice: `apps/desktop/resources/third-party-notices/PYTHON-NOTICE.txt`
- Lock file: `apps/desktop/scripts/python.lock.json`
- Preparer: `apps/desktop/scripts/prepare-python-runtime.mjs`

## Design style catalog

Wordless's built-in design styles ship `theme.css` token files and `DESIGN.md` specifications adapted from the Vetta design templates catalog.

- Source: `https://github.com/openvetta/vetta-design-templates` (`.vetta/design-templates.json`)
- Adapted from: `https://github.com/VoltAgent/awesome-design-md`
- License: MIT
- Notice: `apps/desktop/resources/third-party-notices/VETTA-DESIGN-TEMPLATES-NOTICE.txt`
- Generated snapshot: `apps/desktop/src/main/design/style-catalog-upstream.ts`
- Generator: `apps/desktop/scripts/sync-design-styles.mjs`

Only the `theme.css` and `DESIGN.md` resources are vendored. The upstream `demo.html` worked examples are not shipped.
