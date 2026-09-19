/**
 * Display form for the address bar.
 *
 * Lives in the renderer because it is purely presentational: the main process
 * owns which addresses are allowed, this only decides how a committed URL is
 * shown back to the user.
 */
export function formatAddressBarValue(url: string): string {
  if (!url || url === "about:blank") return "";
  try {
    const parsed = new URL(url);
    const tail = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // Drop a bare trailing slash so `http://localhost:3000/` reads as the
    // `localhost:3000` the user typed.
    return `${parsed.host}${tail === "/" ? "" : tail}`;
  } catch {
    return url;
  }
}
