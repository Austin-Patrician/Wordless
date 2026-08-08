# Wordless website

Static Astro website for Wordless. The existing React/Three.js marketing homepage is mounted as a client-only island at `/`, while the Starlight user manual is served from `/docs` (Chinese) and `/en/docs` (English). It is independent of the Electron renderer and is deployed as one static directory through Nginx.

## Commands

```bash
npm run dev --workspace @wordless/website
npm run check --workspace @wordless/website
npm run build --workspace @wordless/website
```

`dev` is only for local use. The production deployment serves `dist/` with Nginx.

Use Node 22 LTS locally and in CI. Astro 7 supports current even-numbered Node releases; odd-numbered Node versions may produce dependency warnings.

## Documentation

Documentation source lives in `src/content/docs/`:

```text
src/content/docs/
  docs/       # Chinese root locale → /docs/
  en/docs/    # English locale → /en/docs/
```

Each workflow should include an intended outcome, prerequisites, exact steps, a copyable prompt, approval checkpoints, expected output, verification, failure recovery, and related guides. Prefer Starlight `Steps`, `Tabs`, and other built-in components; reusable Wordless components live in `src/components/docs/`.

Screenshot placeholders use `ScreenshotFrame`. Replace them with redacted 1440×900 or 1600×1000 WebP/AVIF files under:

```text
public/docs/screenshots/zh-cn/
public/docs/screenshots/en/
```

Pass the public path to the component, for example `src="/docs/screenshots/zh-cn/getting-started/first-launch.webp"`. Keep the `alt` and caption useful when replacing a placeholder.

## Product media

The generated `wordless-workspace.png` is the default visual. To show a recorded product walkthrough, place a compressed WebM in `public/media/` and set:

```bash
VITE_WORKSPACE_VIDEO=/media/workspace-tour.webm
```

at build time. No video is loaded until that variable is set.
