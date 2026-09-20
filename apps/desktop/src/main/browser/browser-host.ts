import { WebContentsView, type BrowserWindow, type WebContents } from "electron";
import type { BrowserViewBounds } from "@wordless/protocol";
import { isDegenerateBounds, normalizeBounds, sameBounds } from "./browser-bounds";

export interface GuestHandle {
  readonly id: string;
  readonly webContents: WebContents;
}

/**
 * Container seam for embedded browser guests.
 *
 * Mirrors the `ViewHost` shape used by TabTin: the interface speaks only
 * `WebContents` and protocol geometry, never `WebContentsView` or
 * `BrowserWindow`. Services built on top (page ops, CDP, agent tools) reach a
 * page through `getWebContents(id)` or `GuestHandle`, so the container can be
 * swapped — or mocked in a test — without touching them.
 *
 * `attach` / `detach` / `destroy` are three distinct states, and the middle one
 * carries the design: a detach removes the view from the window so overlapping
 * app UI (dropdowns, dialogs, toasts) is no longer occluded by a native surface,
 * while the page keeps its scroll position, form state and session.
 */
export interface BrowserHost {
  createGuest(id: string, options?: CreateGuestOptions): Promise<GuestHandle>;
  attach(id: string): void;
  detach(id: string): void;
  setBounds(id: string, rect: BrowserViewBounds): void;
  destroy(id: string): void;
  getWebContents(id: string): WebContents | null;
  isAttached(id: string): boolean;
}

export type CreateGuestOptions = {
  /** Electron session partition. Non-`persist:` partitions are in-memory. */
  partition?: string;
  /** Absolute path to a page preload. Deliberately unset for agent-facing pages. */
  preload?: string;
};

export const DEFAULT_BROWSER_PARTITION = "wordless-browser";

/**
 * `WebContentsView`-backed implementation.
 *
 * Only the main process can create native views, so this is the one place the
 * container type appears.
 */
export class WebContentsViewHost implements BrowserHost {
  private readonly views = new Map<string, WebContentsView>();
  private readonly attached = new Set<string>();
  private readonly bounds = new Map<string, BrowserViewBounds>();
  private readonly windowProvider: () => BrowserWindow | undefined;

  constructor(windowProvider: () => BrowserWindow | undefined) {
    this.windowProvider = windowProvider;
  }

  async createGuest(id: string, options: CreateGuestOptions = {}): Promise<GuestHandle> {
    const existing = this.views.get(id);
    if (existing && !existing.webContents.isDestroyed()) {
      return { id, webContents: existing.webContents };
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: options.partition ?? DEFAULT_BROWSER_PARTITION,
        // The panel is the most untrusted surface in the app: it renders pages
        // we do not control. Keep it strictly stronger than the main window,
        // which sets contextIsolation/nodeIntegration but not sandbox.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // Deliberately no preload. Page scripts must never reach the
        // `window.wordless` bridge.
        ...(options.preload ? { preload: options.preload } : {}),
      },
    });
    this.views.set(id, view);
    // Never let a page open a native window: route it back through the caller,
    // which decides whether it becomes another guest.
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    return { id, webContents: view.webContents };
  }

  attach(id: string): void {
    const view = this.views.get(id);
    const window = this.windowProvider();
    if (!view || !window || window.isDestroyed()) return;
    if (this.attached.has(id)) return;
    window.contentView.addChildView(view);
    this.attached.add(id);
    const rect = this.bounds.get(id);
    if (rect && !isDegenerateBounds(rect)) {
      view.setBounds(rect);
      return;
    }
    // Mounting without geometry renders nothing at all, and the panel looks
    // broken rather than empty, so make the state visible instead of silent.
    console.warn(`[browser] attached guest "${id}" without usable bounds; it will stay blank until the renderer reports a layout`);
  }

  detach(id: string): void {
    const view = this.views.get(id);
    const window = this.windowProvider();
    if (!view || !this.attached.has(id)) return;
    this.attached.delete(id);
    if (!window || window.isDestroyed()) return;
    // `removeChildView` keeps the page alive: cookies, scroll position and form
    // state survive, which is what makes detach usable as an occlusion response.
    window.contentView.removeChildView(view);
  }

  setBounds(id: string, rect: BrowserViewBounds): void {
    const next = normalizeBounds(rect);
    const previous = this.bounds.get(id);
    // Record geometry per guest id, not per view instance. The renderer reports
    // bounds from its first layout pass, which can land before the view exists,
    // and a view created afterwards must still receive that geometry — otherwise
    // it is attached with no size and renders nothing.
    this.bounds.set(id, next);
    if (previous && sameBounds(previous, next)) return;
    const view = this.views.get(id);
    if (!view) return;
    // Visibility is the caller's decision, so this only applies geometry.
    // Detaching here would let a single animation frame that passes through zero
    // width hide the view for good.
    if (!this.attached.has(id)) return;
    if (isDegenerateBounds(next)) return;
    view.setBounds(next);
  }

  destroy(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.detach(id);
    this.views.delete(id);
    this.bounds.delete(id);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  getWebContents(id: string): WebContents | null {
    const view = this.views.get(id);
    if (!view || view.webContents.isDestroyed()) return null;
    return view.webContents;
  }

  isAttached(id: string): boolean {
    return this.attached.has(id);
  }

  getBounds(id: string): BrowserViewBounds | null {
    return this.bounds.get(id) ?? null;
  }

  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.destroy(id);
  }
}
