import assert from "node:assert/strict";
import test from "node:test";
import { createRasterIdlePolicy, type RasterIdleTimer } from "../src/main/design/raster-idle.ts";

/**
 * 空闲即释放的策略本身。
 *
 * 它管的是真实资源:一个离屏光栅窗口就是一个渲染进程(实测各约 128MB),而它们原先只在
 * 应用退出时才销毁 —— "打开过一次设计画布"于是等于永久多付两个进程。这里用注入的计时器
 * 把"什么时候该销毁"钉住,而不是靠肉眼盯着任务管理器。
 */
function createFakeTimer(): RasterIdleTimer & { fire: () => void; scheduled: number[] } {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 0;
  const scheduled: number[] = [];
  return {
    scheduled,
    setTimeout(handler: () => void, ms: number) {
      const handle = nextHandle++;
      callbacks.set(handle, handler);
      scheduled.push(ms);
      return handle;
    },
    clearTimeout(handle: unknown) {
      callbacks.delete(typeof handle === "number" ? handle : -1);
    },
    fire() {
      const [handle, handler] = callbacks.entries().next().value ?? [];
      if (typeof handle !== "number" || handler === undefined) return;
      callbacks.delete(handle);
      handler();
    },
  };
}

test("空闲窗口归还后开始计时,到点触发一次释放", () => {
  const timer = createFakeTimer();
  let released = 0;
  const policy = createRasterIdlePolicy({ idleMs: 60_000, onIdle: () => (released += 1), timer });

  policy.released(1);
  assert.equal(policy.armed, true);
  assert.deepEqual(timer.scheduled, [60_000]);

  timer.fire();
  assert.equal(released, 1);
  // 触发之后必须自己停表,否则空闲窗口会被反复销毁。
  assert.equal(policy.armed, false);
});

test("没有空闲窗口可回收时不装计时器", () => {
  const timer = createFakeTimer();
  const policy = createRasterIdlePolicy({ idleMs: 60_000, onIdle: () => {}, timer });

  policy.released(0);
  assert.equal(policy.armed, false);
  assert.deepEqual(timer.scheduled, []);
});

test("窗口被重新取用时重新计时;取空之后停表", () => {
  const timer = createFakeTimer();
  let released = 0;
  const policy = createRasterIdlePolicy({ idleMs: 1_000, onIdle: () => (released += 1), timer });

  policy.released(2);
  policy.touched(1);
  policy.touched(0);

  // 前两次登记各装了一次计时;第三次因为已无空闲窗口而停表。
  assert.deepEqual(timer.scheduled, [1_000, 1_000]);
  assert.equal(policy.armed, false);

  timer.fire();
  assert.equal(released, 0);
});

test("dispose 之后不再触发,已销毁的窗口不会被再碰一次", () => {
  const timer = createFakeTimer();
  let released = 0;
  const policy = createRasterIdlePolicy({ idleMs: 1_000, onIdle: () => (released += 1), timer });

  policy.released(1);
  policy.stop();
  assert.equal(policy.armed, false);

  timer.fire();
  assert.equal(released, 0);
});

test("阈值为 0 表示保留窗口(给测试与旧行为留的开关)", () => {
  const timer = createFakeTimer();
  const policy = createRasterIdlePolicy({ idleMs: 0, onIdle: () => {}, timer });

  policy.released(2);
  assert.equal(policy.armed, false);
  assert.deepEqual(timer.scheduled, []);
});
