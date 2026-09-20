/**
 * Coalesces repeated calls into one callback per animation frame.
 *
 * Extracted because the sentinel handling is easy to get subtly wrong in exactly
 * the way that already bit this panel: a `dispose` that cancelled the pending
 * frame but left the handle recorded made every later `schedule` return early, so
 * a `ResizeObserver` went permanently silent. Under React StrictMode — which
 * mounts, cleans up and mounts again — that happened on first render, and the
 * embedded browser stopped tracking the panel's width while still looking fine at
 * rest.
 *
 * The rule this encodes: cancelling must forget the handle.
 */

export type FrameScheduler = {
  /** Runs `run` on the next frame, or does nothing if one is already queued. */
  schedule(): void;
  /** Cancels any queued frame and makes the scheduler usable again. */
  dispose(): void;
  /** True while a frame is queued. Diagnostic only. */
  readonly pending: boolean;
};

export function createFrameScheduler(
  run: () => void,
  request: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  cancel: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): FrameScheduler {
  let handle = 0;
  return {
    schedule(): void {
      if (handle !== 0) return;
      handle = request(() => {
        // Clear before running: `run` may schedule again, and it must be able to.
        handle = 0;
        run();
      });
    },
    dispose(): void {
      if (handle !== 0) cancel(handle);
      handle = 0;
    },
    get pending(): boolean {
      return handle !== 0;
    },
  };
}
