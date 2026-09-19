import assert from "node:assert/strict";
import test from "node:test";
import { createFrameScheduler } from "../src/renderer/features/browser/frame-scheduler.ts";

/** Stands in for requestAnimationFrame, with manual frame stepping. */
function createFrameHost() {
  const queued = new Map<number, () => void>();
  const cancelled: number[] = [];
  let next = 1;
  return {
    queued,
    cancelled,
    request: (callback: () => void) => {
      const handle = next++;
      queued.set(handle, callback);
      return handle;
    },
    cancel: (handle: number) => {
      cancelled.push(handle);
      queued.delete(handle);
    },
    /** Runs every queued callback, as a real frame would. */
    runFrame: () => {
      const callbacks = [...queued.values()];
      queued.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test("coalesces many calls into a single frame", () => {
  const host = createFrameHost();
  let runs = 0;
  const scheduler = createFrameScheduler(() => runs++, host.request, host.cancel);

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(host.queued.size, 1, "only one frame is queued");

  host.runFrame();
  assert.equal(runs, 1);
});

test("can schedule again after a frame has run", () => {
  const host = createFrameHost();
  let runs = 0;
  const scheduler = createFrameScheduler(() => runs++, host.request, host.cancel);

  scheduler.schedule();
  host.runFrame();
  scheduler.schedule();
  host.runFrame();
  assert.equal(runs, 2);
});

test("scheduling from inside the callback is not swallowed", () => {
  // The handle must be cleared before `run` executes, otherwise a callback that
  // observes a fresh change would lose it.
  const host = createFrameHost();
  let runs = 0;
  const scheduler = createFrameScheduler(() => {
    runs++;
    if (runs === 1) scheduler.schedule();
  }, host.request, host.cancel);

  scheduler.schedule();
  host.runFrame();
  assert.equal(host.queued.size, 1, "the re-schedule queued another frame");
  host.runFrame();
  assert.equal(runs, 2);
});

test("regression: dispose then schedule still runs", () => {
  // Regression: cancelling without forgetting the handle left the sentinel set,
  // so every later schedule returned early and a ResizeObserver went silent for
  // the lifetime of the component. StrictMode's mount/cleanup/mount triggered it
  // on first render, which is how the embedded browser stopped following the
  // panel's width.
  const host = createFrameHost();
  let runs = 0;
  const scheduler = createFrameScheduler(() => runs++, host.request, host.cancel);

  scheduler.schedule();
  assert.equal(scheduler.pending, true);
  scheduler.dispose();

  assert.equal(scheduler.pending, false, "dispose forgets the handle");
  scheduler.schedule();
  assert.equal(scheduler.pending, true, "a new frame is queued after dispose");
  host.runFrame();
  assert.equal(runs, 1, "and it actually runs");
});

test("dispose cancels a pending frame and prevents it running", () => {
  const host = createFrameHost();
  let runs = 0;
  const scheduler = createFrameScheduler(() => runs++, host.request, host.cancel);

  scheduler.schedule();
  const handle = [...host.queued.keys()][0];
  scheduler.dispose();
  assert.deepEqual(host.cancelled, [handle]);
  host.runFrame();
  assert.equal(runs, 0, "the cancelled callback never ran");
});

test("dispose without a pending frame is harmless", () => {
  const host = createFrameHost();
  const scheduler = createFrameScheduler(() => {}, host.request, host.cancel);
  scheduler.dispose();
  assert.deepEqual(host.cancelled, []);
  assert.equal(scheduler.pending, false);
});
