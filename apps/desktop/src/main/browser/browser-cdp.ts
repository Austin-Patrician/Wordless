import type { WebContents } from "electron";

/**
 * Chrome DevTools Protocol access for a page in the browser panel.
 *
 * The panel reaches pages through CDP rather than a browser-automation library.
 * Electron already embeds Chromium and exposes a CDP client on every
 * `WebContents`, so a dependency that ships its own browser would add hundreds of
 * megabytes and a signing burden to buy cross-engine support this feature does
 * not need.
 */

export type CdpTransport = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/**
 * Methods the panel is allowed to issue.
 *
 * An allowlist rather than a convenience wrapper: `Runtime.evaluate` and
 * `Page.addScriptToEvaluateOnNewDocument` execute arbitrary script in a page we
 * do not control, and the difference between a read tool and a remote code
 * execution primitive is exactly this list. Two projects hit this same conclusion
 * independently, and the arc of 2026's agent compromises — a page reaching host
 * execution through a browsing agent — is what it guards against.
 */
const CDP_ALLOWLIST = new Set([
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "DOM.enable",
  "DOM.getDocument",
  // Geometry and focus for acting on a node. Neither runs script: they read a
  // box and move focus, which is what clicking and typing need.
  "DOM.getBoxModel",
  "DOM.focus",
  "Page.enable",
  "Page.navigate",
  "Page.reload",
  "Page.captureScreenshot",
  "Network.enable",
  "Runtime.enable",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
]);

export const DEFAULT_CDP_TIMEOUT_MS = 10_000;

export class CdpError extends Error {
  readonly method: string;
  constructor(method: string, message: string) {
    super(message);
    this.name = "CdpError";
    this.method = method;
  }
}

export function isAllowedCdpMethod(method: string): boolean {
  return CDP_ALLOWLIST.has(method);
}

/**
 * Runs `task` with a CDP transport for `webContents`.
 *
 * Every call is bounded. A page that stops responding would otherwise hold the
 * agent's tool call open indefinitely, which reads to the user as a frozen app
 * rather than a slow page.
 */
export async function withCdp<T>(
  webContents: WebContents,
  task: (send: CdpTransport) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS;
  // Attaching is idempotent from our side but throws if another debugger owns the
  // target; a user-opened DevTools panel does not conflict, so only a genuine
  // conflict lands here.
  if (!webContents.debugger.isAttached()) {
    try {
      webContents.debugger.attach("1.3");
    } catch (cause) {
      throw new CdpError("attach", cause instanceof Error ? cause.message : String(cause));
    }
  }
  const send: CdpTransport = async (method, params) => {
    if (!isAllowedCdpMethod(method)) throw new CdpError(method, `${method} is not allowed on a page view`);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        webContents.debugger.sendCommand(method, params ?? {}),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new CdpError(method, `${method} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (cause) {
      throw cause instanceof CdpError ? cause : new CdpError(method, cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return await task(send);
}

/** A PNG of the page, as base64 without a `data:` prefix. */
export async function capturePagePng(webContents: WebContents): Promise<{ data: string; mimeType: string } | null> {
  try {
    const image = await webContents.capturePage();
    return image.isEmpty() ? null : { data: image.toPNG().toString("base64"), mimeType: "image/png" };
  } catch {
    return null;
  }
}
