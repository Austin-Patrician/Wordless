import assert from "node:assert/strict";
import test from "node:test";
import { ThreadViewportStore, type AnimationFrameScheduler } from "../src/renderer/features/thread/thread-viewport-store.ts";

class TestFrames implements AnimationFrameScheduler {
  callbacks: FrameRequestCallback[] = [];
  cancel = () => {};
  request = (callback: FrameRequestCallback) => {
    this.callbacks.push(callback);
    return this.callbacks.length;
  };
  flush() {
    const callbacks = this.callbacks.splice(0);
    for (const callback of callbacks) callback(0);
  }
}

test("does not expose transient bottom measurements as a paused follow state", () => {
  const frames = new TestFrames();
  const store = new ThreadViewportStore(frames);
  store.setAtBottom(false);
  store.setAtBottom(true);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "following");
  assert.equal(store.getSnapshot().showJumpToLatest, false);
});

test("pauses only after user scroll intent and resumes at the bottom", () => {
  const frames = new TestFrames();
  const store = new ThreadViewportStore(frames);
  store.markUserScrollIntent();
  store.setAtBottom(false);
  frames.flush();
  assert.equal(store.getSnapshot().showJumpToLatest, true);
  store.setAtBottom(true);
  frames.flush();
  assert.equal(store.getSnapshot().showJumpToLatest, false);
});

test("discarded pointer intent cannot pause a later streaming resize", () => {
  const frames = new TestFrames();
  const store = new ThreadViewportStore(frames);
  store.setAtBottom(true);
  frames.flush();
  store.markUserScrollIntent();
  assert.equal(store.shouldFollowTailGrowth(), false);
  store.clearUserScrollIntent();
  assert.equal(store.shouldFollowTailGrowth(), true);
  store.setAtBottom(false);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "following");
  assert.equal(store.getSnapshot().showJumpToLatest, false);
});

test("at-bottom measurements cannot cancel an explicit navigation pause", () => {
  const frames = new TestFrames();
  const store = new ThreadViewportStore(frames);
  store.pauseFollowing();
  store.setAtBottom(true);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "paused");
  store.setAtBottom(false);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "paused");
  assert.equal(store.getSnapshot().showJumpToLatest, true);
  store.setAtBottom(true);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "paused");
  assert.equal(store.getSnapshot().showJumpToLatest, true);
  store.resumeFollowing();
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "following");
});

test("initializes from the first real Virtuoso bottom measurement", () => {
  const frames = new TestFrames();
  const store = new ThreadViewportStore(frames);
  store.setAtBottom(false);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "paused");
  assert.equal(store.getSnapshot().showJumpToLatest, true);

  store.setAtBottom(true);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "following");
  assert.equal(store.getSnapshot().showJumpToLatest, false);
});

test("a user scroll pauses follow after initialization", () => {
  const frames = new TestFrames();
  const store = new ThreadViewportStore(frames);
  store.setAtBottom(true);
  frames.flush();
  store.markUserScrollIntent();
  store.setAtBottom(false);
  frames.flush();
  assert.equal(store.getSnapshot().followMode, "paused");
  assert.equal(store.getSnapshot().showJumpToLatest, true);
});
