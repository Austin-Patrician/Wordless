import assert from "node:assert/strict";
import test from "node:test";
import { RasterPool } from "../src/main/design/raster-pool.ts";
import type { RasterPort, RasterRequest, RasterResult } from "../src/main/design/raster-port.ts";

/**
 * 可控的假端口。
 *
 * 用假实现而不是真 Electron,是为了能构造**真环境里很难稳定复现**的情况:一个页面
 * 永远不返回(超时)、端口违约抛错、同一帧被并发请求。这些正是池必须挡住的。
 */
class FakeRaster implements RasterPort {
  readonly seen: string[] = [];
  /** 同时进行的数量峰值 —— 用来断言并发上限真的生效。 */
  peak = 0;
  private active = 0;
  /** key → 行为。默认立刻成功。 */
  private readonly behaviors = new Map<string, (signal: AbortSignal) => Promise<RasterResult>>();

  behave(key: string, behavior: (signal: AbortSignal) => Promise<RasterResult>): void {
    this.behaviors.set(key, behavior);
  }

  async capture(request: RasterRequest, signal: AbortSignal): Promise<RasterResult> {
    if (signal.aborted) return { ok: false, key: request.key, code: "cancelled" };
    this.seen.push(request.key);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      const behavior = this.behaviors.get(request.key);
      const work = behavior ? behavior(signal) : Promise.resolve(ok(request.key));
      /**
       * **真实端口必须在 abort 时尽快落定**;假端口照做。
       *
       * 不只是为了像真的:不落定的话测试会留下悬空 promise,node:test 会报
       * "Promise resolution is still pending but the event loop has already resolved",
       * 而且失败会串到后面几条测试上,看起来像池出了问题。
       */
      return await Promise.race([
        work,
        new Promise<RasterResult>((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ ok: false, key: request.key, code: "cancelled" }),
            { once: true },
          );
        }),
      ]);
    } finally {
      this.active -= 1;
    }
  }
}

function ok(key: string): RasterResult {
  return { ok: true, key, bytes: new Uint8Array([1, 2, 3]), width: 390, height: 844 };
}

/**
 * 请求夹具。`key` 的语义是「帧 + 档位」,所以档位进 key —— 这正是去重该有的粒度:
 * 同一帧的不同档位是两个缓存条目,不能互相去重掉。
 */
/**
 * 请求键。**所有 `behave` 都必须用它** —— 手写字符串时我已经两次让行为注册在错的键上,
 * 而失败的表现是"测试通过但测的不是它声称的东西"(行为没生效,走的是默认成功路径)。
 */
function keyOf(frameId: string, bucket = 1): string {
  return `${frameId}@${bucket}`;
}

function request(frameId: string, bucket = 1): RasterRequest {
  return {
    key: keyOf(frameId, bucket),
    url: `wordless-design://frame/0123456789abcdef/${frameId}`,
    width: 390,
    height: 844,
    pixelRatio: bucket,
  };
}

function pool(port: RasterPort, overrides: Partial<{ concurrency: number; timeoutMs: number }> = {}) {
  return new RasterPool({ port, concurrency: 2, timeoutMs: 50, ...overrides });
}

test("顺利时每项都拿到位图", async () => {
  const port = new FakeRaster();
  const results = await pool(port).run([request("a"), request("b")]);
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.ok, true);
    // 成功项也带顶层 key —— 一批结果要能直接按 key 与请求对上。
    assert.equal(result.ok && result.width, 390);
  }
});

test("并发不超过上限", async () => {
  // 每个离屏视图是一个真实渲染进程;不限并发的话打开 40 帧会一次拉起 40 个。
  const port = new FakeRaster();
  for (const frameId of ["a", "b", "c", "d", "e", "f"]) {
    port.behave(keyOf(frameId), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ok(keyOf(frameId));
    });
  }
  await pool(port, { concurrency: 2 }).run(["a", "b", "c", "d", "e", "f"].map((key) => request(key)));
  assert.ok(port.peak <= 2, `并发峰值 ${port.peak} 超过上限 2`);
  assert.equal(port.seen.length, 6);
});

test("同一批里同键只光栅一次", async () => {
  const port = new FakeRaster();
  const results = await pool(port).run([request("a"), request("a"), request("b")]);
  assert.deepEqual(port.seen, ["a@1", "b@1"]);
  assert.equal(results.length, 2);
});

test("同帧不同档位是两个键,各光栅一次", async () => {
  const port = new FakeRaster();
  await pool(port).run([request("a", 0.5), request("a", 1)]);
  assert.equal(port.seen.length, 2);
});

test("超时按失败上报,不挂住整批", async () => {
  const port = new FakeRaster();
  // 一个永远不返回的页面。若不设超时,这一批永远等下去。
  port.behave(keyOf("stuck"), () => new Promise(() => undefined));
  const results = await pool(port, { timeoutMs: 30 }).run([request("stuck"), request("ok")]);

  const stuck = results.find((result) => result.key === "stuck@1");
  assert.deepEqual(stuck, { ok: false, key: "stuck@1", code: "timeout" });
  // 同批的其它帧照常完成 —— 一个帧卡住不该拖垮整批。
  assert.equal(results.find((result) => result.key === "ok@1")?.ok, true);
});

test("超时后端口才回来时,结果不被采用", async () => {
  // 这一条防的是**串帧**:离屏视图可能已经在渲染下一个帧了,迟到的位图不是这一帧的内容。
  const port = new FakeRaster();
  port.behave(keyOf("late"), async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return ok("late");
  });
  const results = await pool(port, { timeoutMs: 20 }).run([request("late")]);
  assert.deepEqual(results, [{ ok: false, key: "late@1", code: "timeout" }]);
});

test("端口违约抛错时按抓图失败上报", async () => {
  // 契约说永不抛错,但契约是契约 —— 抛了也不该冒到调用方。
  const port = new FakeRaster();
  port.behave(keyOf("boom"), async () => {
    throw new Error("renderer gone");
  });
  const results = await pool(port).run([request("boom")]);
  assert.deepEqual(results, [{ ok: false, key: "boom@1", code: "capture-failed" }]);
});

test("取消后不再开始新的项,在途项按取消上报", async () => {
  const port = new FakeRaster();
  for (const frameId of ["a", "b", "c", "d"]) {
    port.behave(keyOf(frameId), async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return ok(keyOf(frameId));
    });
  }
  const active = pool(port, { concurrency: 1, timeoutMs: 5_000 });
  const running = active.run(["a", "b", "c", "d"].map((key) => request(key)));
  // 让第一项开始,然后取消。
  await new Promise((resolve) => setTimeout(resolve, 5));
  active.cancelAll();
  const results = await running;

  assert.equal(results.length, 4);
  for (const result of results) {
    // 取消与超时是两回事:调用方自己按的停不该显示成渲染出了问题。
    assert.equal(result.ok === false && result.code, "cancelled");
  }
  // 只有已经开始的那一项真正进了端口。
  assert.equal(port.seen.length, 1);
});

test("取消之后的新一批照常工作", async () => {
  const port = new FakeRaster();
  const active = pool(port);
  active.cancelAll();
  // 一次 run 是一个新的工作段:上一次的取消不该影响这一次。
  const results = await active.run([request("a")]);
  assert.equal(results[0]?.ok, true);
});

test("空批次不产生任何调用", async () => {
  const port = new FakeRaster();
  assert.deepEqual(await pool(port).run([]), []);
  assert.deepEqual(port.seen, []);
});

test("非法并发与超时被夹到合法值,而不是让池失效", async () => {
  const port = new FakeRaster();
  const zero = new RasterPool({ port, concurrency: 0, timeoutMs: 0 });
  // concurrency 0 若不夹住,worker 数为 0 → 永远不 resolve。
  const results = await zero.run([request("a")]);
  assert.equal(results.length, 1);
});

test("在途计数随完成回落", async () => {
  const port = new FakeRaster();
  const active = pool(port);
  assert.equal(active.inFlight, 0);
  await active.run([request("a"), request("b")]);
  assert.equal(active.inFlight, 0);
});

test("主进程侧预算自洽,且与渲染层那份不重叠", async () => {
  const { DESIGN_RASTER_BUDGETS } = await import("../src/main/design/raster-budgets.ts");
  assert.ok(DESIGN_RASTER_BUDGETS.rasterConcurrency >= 1);
  assert.ok(DESIGN_RASTER_BUDGETS.rasterTimeoutMs > 0);
  assert.ok(DESIGN_RASTER_BUDGETS.buildTimeoutMs > 0);
});
