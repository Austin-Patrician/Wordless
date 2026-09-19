/**
 * Occlusion handling for the embedded browser view.
 *
 * The panel hosts a native `WebContentsView`, which always composites above the
 * renderer's DOM and cannot be ordered with `z-index`. Whenever app UI overlaps
 * the placeholder that UI is unreachable unless the native view steps aside. The
 * response is to `detach` (the page keeps its scroll position, form state and
 * session) and re-`attach` when the overlap clears.
 *
 * Three signals feed that decision, because no single one is sufficient:
 *
 * 1. **Declared** — `browserOcclusion.acquire` for overlays that know they are
 *    open. Deterministic and free, but only as good as the wiring.
 * 2. **Portalled** — anything mounted as a direct child of `<body>` that is not
 *    an ancestor of the placeholder and overlaps it. This is what catches the
 *    app's Radix popovers, menus and dialogs without touching any call site.
 * 3. **Sampled** — a grid over the placeholder's own geometry, as a backstop for
 *    overlays that are neither declared nor portalled.
 *
 * Signal 3 exists because an earlier version relied on five points — centre plus
 * four insets — which could not see a small popover anchored to an edge: on a
 * tall panel every sample fell below a header-anchored dropdown and the page
 * stayed buried. Point sampling is inherently probabilistic, which is why it is
 * now the last line of defence rather than the only one.
 */

export type OcclusionReason = "dialog" | "menu" | "toast" | "dropdown" | "manual";

export type Rect = { left: number; top: number; width: number; height: number };

export class OcclusionCoordinator {
  private readonly holders = new Map<symbol, OcclusionReason>();
  private readonly listeners = new Set<(occluded: boolean) => void>();

  /**
   * Marks the panel as occluded until the returned function is called. A token
   * rather than a boolean means overlapping overlays cannot release each other
   * early.
   */
  acquire(reason: OcclusionReason): () => void {
    const token = Symbol(reason);
    const wasOccluded = this.occluded;
    this.holders.set(token, reason);
    if (!wasOccluded) this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const previouslyOccluded = this.occluded;
      this.holders.delete(token);
      if (previouslyOccluded !== this.occluded) this.notify();
    };
  }

  get occluded(): boolean {
    return this.holders.size > 0;
  }

  /** Diagnostics for the reason string shown in dev builds and tests. */
  get reasons(): OcclusionReason[] {
    return [...this.holders.values()];
  }

  subscribe(listener: (occluded: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const value = this.occluded;
    for (const listener of this.listeners) listener(value);
  }
}

/**
 * Shared instance for overlays that declare themselves. A module singleton
 * rather than React context because the panel and the overlays that occlude it
 * are siblings in different subtrees, and threading a provider through the whole
 * shell would cost more than it explains.
 */
export const browserOcclusion = new OcclusionCoordinator();

export function rectsIntersect(a: Rect, b: Rect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

export type OverlayCandidate = {
  rect: Rect;
  /** True when this element is an ancestor of the placeholder, e.g. the app root. */
  containsPlaceholder: boolean;
  /** True when the element cannot receive pointer input. */
  pointerEventsNone: boolean;
  /**
   * True when the element is not painted at all.
   *
   * `display: none` already collapses the box to zero, but `visibility: hidden`
   * and `opacity: 0` keep it — and Radix leaves closed popover wrappers mounted
   * that way. Without this a closed menu would detach the view forever.
   */
  invisible: boolean;
};

/**
 * Whether a floating element actually takes the placeholder's space.
 *
 * Excluding ancestors matters: the app root is a `<body>` child that always
 * intersects the placeholder, and treating it as an overlay would detach the
 * view permanently.
 */
export function blocksPlaceholder(placeholder: Rect, candidate: OverlayCandidate): boolean {
  if (candidate.containsPlaceholder) return false;
  if (candidate.pointerEventsNone) return false;
  if (candidate.invisible) return false;
  return rectsIntersect(placeholder, candidate.rect);
}

/** Whether a computed style means the element paints nothing. */
export function isInvisibleStyle(style: { visibility: string; opacity: string }): boolean {
  if (style.visibility === "hidden" || style.visibility === "collapse") return true;
  // `Number("")` is 0, so an absent value must be rejected before parsing or an
  // unreadable opacity would look like a fully transparent element.
  const raw = style.opacity.trim();
  if (raw === "") return false;
  const opacity = Number(raw);
  return Number.isFinite(opacity) && opacity === 0;
}

/**
 * How far inside the placeholder to sample, in CSS pixels.
 *
 * This must be a pixel inset, not a fraction. The panel keeps its own chrome
 * hard against the placeholder's edges — a 12px resize gutter overlaps the left
 * edge for its full height — and a fractional inset shrinks with the panel until
 * the samples land on that gutter. When that happened every probe reported the
 * page as occluded and the view was detached for good.
 */
const EDGE_INSET_PX = 16;

/**
 * Fractions of the *inset* box to probe, grouped by the failure each group
 * guards against.
 */
const SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  // Along the top: dropdowns and autocomplete lists anchored to the header grow
  // downwards into the page and are typically narrow, so this row is dense.
  [0.02, 0], [0.25, 0], [0.5, 0], [0.75, 0], [0.98, 0],
  // Left and right edges: side-anchored panels and popovers.
  [0, 0.3], [0, 0.7], [1, 0.3], [1, 0.7],
  // Along the bottom: popovers that open upwards from a footer.
  [0.25, 1], [0.5, 1], [0.75, 1],
  // Interior: full-bleed overlays such as dialogs and modal masks.
  [0.5, 0.5], [0.25, 0.35], [0.75, 0.35], [0.25, 0.65], [0.75, 0.65],
];

/**
 * True when anything other than the placeholder covers its own area.
 *
 * `isForeign` is injected rather than read from `document` so the sampling rule
 * can be tested without a DOM.
 */
export function sampleOcclusion(rect: Rect, isForeign: (x: number, y: number) => boolean): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  // Never collapse the inset past a quarter of the box, so a very small panel
  // still produces points rather than an inverted range.
  const insetX = Math.min(EDGE_INSET_PX, rect.width / 4);
  const insetY = Math.min(EDGE_INSET_PX, rect.height / 4);
  const left = rect.left + insetX;
  const top = rect.top + insetY;
  const width = rect.width - insetX * 2;
  const height = rect.height - insetY * 2;
  for (const [fractionX, fractionY] of SAMPLE_POINTS) {
    if (isForeign(left + width * fractionX, top + height * fractionY)) return true;
  }
  return false;
}

function toRect(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Scans `<body>`'s direct children for a portal covering the placeholder.
 *
 * Radix mounts every popover, menu and dialog into a portal at body level, so
 * this one check covers the whole family without editing their call sites.
 */
function findBlockingPortal(placeholder: HTMLElement, placeholderRect: Rect): Element | null {
  const view = placeholder.ownerDocument.defaultView;
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) && !(child instanceof SVGElement)) continue;
    // Every rule lives in `blocksPlaceholder` so the DOM scan and the tests
    // cannot drift apart.
    const style = view?.getComputedStyle(child);
    if (blocksPlaceholder(placeholderRect, {
      rect: toRect(child),
      containsPlaceholder: child.contains(placeholder),
      pointerEventsNone: style?.pointerEvents === "none",
      invisible: style ? isInvisibleStyle(style) : false,
    })) return child;
  }
  return null;
}

/**
 * What a probe found, and why.
 *
 * The culprit element is reported because a false positive here is invisible in
 * the UI: the page simply never appears, with nothing to point at the reason.
 */
export type OcclusionFinding = {
  blocked: boolean;
  source: "portal" | "sample" | null;
  element: Element | null;
};

export const NOT_OCCLUDED: OcclusionFinding = { blocked: false, source: null, element: null };

/** Browser-side probe combining the portalled scan and the sampling backstop. */
export function domOcclusionProbe(placeholder: HTMLElement): () => OcclusionFinding {
  return () => {
    const rect = placeholder.getBoundingClientRect();
    const placeholderRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    if (placeholderRect.width <= 0 || placeholderRect.height <= 0) return NOT_OCCLUDED;

    const portal = findBlockingPortal(placeholder, placeholderRect);
    if (portal) return { blocked: true, source: "portal", element: portal };

    let sampled: Element | null = null;
    // `elementFromPoint` ignores `pointer-events: none` elements, which is the
    // behaviour we want: a purely decorative overlay does not make the app
    // unusable, so the page can stay visible underneath it.
    const blocked = sampleOcclusion(placeholderRect, (x, y) => {
      const top = document.elementFromPoint(x, y);
      if (!top) return false;
      if (top === placeholder || placeholder.contains(top)) return false;
      sampled ??= top;
      return true;
    });
    return blocked && sampled ? { blocked: true, source: "sample", element: sampled } : NOT_OCCLUDED;
  };
}
