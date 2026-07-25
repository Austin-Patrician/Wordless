# Desktop Development

`npm run dev:electron --workspace @wordless/desktop` starts Vite and Electron together. The script discovers the Vite port at runtime, so it remains correct when another process is using the default port.

The desktop package configures the Electron binary mirror as `https://npmmirror.com/mirrors/electron/`. npm exposes this to `@electron/get` as `npm_package_config_electron_mirror`, so a missing Electron binary is downloaded from that mirror and cached by Electron.

Set `ELECTRON_MIRROR` before the command to use an organization-specific mirror or the official GitHub release source.

When the binary cache is incomplete, retry only the binary download with `npm run electron:install --workspace @wordless/desktop`.
