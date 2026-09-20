/**
 * Scrollbar styling injected into pages shown by the browser panel.
 *
 * The panel's own CSS cannot reach these: the page is rendered by Chromium
 * inside a `WebContentsView`, outside the app's document, so the only lever is
 * `webContents.insertCSS`.
 *
 * Two deliberate constraints:
 *
 * 1. **Scoped to `html`/`body`.** A bare `::-webkit-scrollbar` rule would
 *    restyle every scroll area the page owns — code editors, side panes, chat
 *    lists — which is the page's design to decide, not ours. Only the viewport
 *    scrollbar is ours to touch.
 * 2. **No theme-specific colour.** The app knows whether *it* is light or dark,
 *    but not what the page looks like. A thumb tinted for a light UI would all
 *    but disappear on a dark site, so the colour is a neutral translucent grey
 *    that reads against either.
 *
 * `scrollbar-width` is intentionally absent: setting it makes Chromium ignore
 * the `::-webkit-scrollbar` rules below, which are the ones that give control
 * over radius and colour.
 */
export const PAGE_SCROLLBAR_CSS = `
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

html::-webkit-scrollbar-track,
body::-webkit-scrollbar-track {
  background: transparent;
}

html::-webkit-scrollbar-thumb,
body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(140, 140, 140, 0.35);
}

html::-webkit-scrollbar-thumb:hover,
body::-webkit-scrollbar-thumb:hover {
  background: rgba(140, 140, 140, 0.55);
}

html::-webkit-scrollbar-corner,
body::-webkit-scrollbar-corner {
  background: transparent;
}
`;
