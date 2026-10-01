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

## Bundled OCR (text recognition)

Wordless ships a local OCR engine (PP-OCRv5 ONNX models + onnxruntime-web) so that models
which cannot view images can still read text out of an image. The models are downloaded at
package time (never at runtime), verified against a locked SHA-256, and shipped inside the
application bundle. The wasm runtime and its JavaScript glue are copied from the installed
`onnxruntime-web` package, so both halves are always the same version.

- Models: PP-OCRv5 from `https://github.com/PaddlePaddle/PaddleOCR` (Apache-2.0), ONNX conversion by `https://github.com/bent2685/ocr-web` (MIT)
- Runtime: `onnxruntime-web` from `https://github.com/microsoft/onnxruntime` (MIT)
- Inference wrapper: `@ocr-web/core` from `https://github.com/bent2685/ocr-web` (MIT)
- Notice: `apps/desktop/resources/third-party-notices/OCR-NOTICE.txt`
- Lock file: `apps/desktop/scripts/ocr.lock.json`
- Preparer: `apps/desktop/scripts/prepare-ocr-assets.mjs`

## Design style catalog

Wordless's built-in design styles ship `theme.css` token files and `DESIGN.md` specifications adapted from the Vetta design templates catalog.

- Source: `https://github.com/openvetta/vetta-design-templates` (`.vetta/design-templates.json`)
- Adapted from: `https://github.com/VoltAgent/awesome-design-md`
- License: MIT
- Notice: `apps/desktop/resources/third-party-notices/VETTA-DESIGN-TEMPLATES-NOTICE.txt`
- Generated snapshot: `apps/desktop/src/main/design/style-catalog-upstream.ts`
- Generator: `apps/desktop/scripts/sync-design-styles.mjs`

Only the `theme.css` and `DESIGN.md` resources are vendored. The upstream `demo.html` worked examples are not shipped.
