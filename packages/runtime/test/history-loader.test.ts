import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlightLoads, type LoadOutcome, type LoadState } from "../src/history-loader.ts";

/**
 * 装载器的契约。
 *
 * 这层存在的唯一理由是"重读"这件事曾经写成 `await` 自己(那条记录只在创建者的 finally 里删,
 * 于是它永久留在表里,该会话之后每个请求都跟着挂死)。所以下面**每条重读用例都带时限**:
 * 自等待在这里的表现是"永不返回",不带时限的断言会变成整个测试进程卡住,而不是一条失败。
 */

const LIMIT_MS = 300;

async function withinLimit<T>(promise: Promise<T>): Promise<T | "timeout"> {
  return await Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), LIMIT_MS);
      // 被 race 淘汰之后别把这个计时器留成"让进程多活 300ms"的句柄。
      void promise.finally(() => clearTimeout(timer));
    }),
  ]);
}

function outcome<T>(value: T, stable: boolean): LoadOutcome<T> {
  return { stable, value };
}

test("shares one load between concurrent callers", async () => {
  const loads = createSingleFlightLoads<string>();
  let calls = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const produce = async (): Promise<LoadOutcome<string>> => {
    calls += 1;
    await gate;
    return outcome("v", true);
  };

  const first = loads.load("a", produce);
  const second = loads.load("a", produce);
  assert.equal(loads.pending.includes("a"), true);
  release?.();

  assert.deepEqual(await withinLimit(Promise.all([first, second])), ["v", "v"]);
  assert.equal(calls, 1);
  assert.deepEqual(loads.pending, []);
});

test("returns a stable value without re-reading", async () => {
  const loads = createSingleFlightLoads<string>();
  let calls = 0;
  const value = await loads.load("a", async () => {
    calls += 1;
    return outcome("stable", true);
  });

  assert.equal(value, "stable");
  assert.equal(calls, 1);
});

test("re-reads until the read is stable", async () => {
  const loads = createSingleFlightLoads<string>();
  let calls = 0;
  const values = ["first", "second"];
  const value = await withinLimit(loads.load("a", async () => {
    const next = values[calls] ?? "second";
    calls += 1;
    // 第一遍"读的时候 journal 被追加了",第二遍才稳定 —— 这是重读存在的理由。
    return outcome(next, calls > 1);
  }));

  assert.equal(value, "second");
  assert.equal(calls, 2);
});

test("a re-read never awaits its own load", async () => {
  // 回归用例:重读必须是"同一个装载对象的下一轮",不能重新进表。
  // 旧写法(经由表重读)在这里会命中自己,于是永不返回、而且表里永久留下一条。
  const loads = createSingleFlightLoads<string>();
  let calls = 0;
  const value = await withinLimit(loads.load("a", async () => {
    calls += 1;
    return outcome(`attempt-${calls}`, false);
  }));

  assert.equal(value, "attempt-3");
  assert.equal(calls, 3);
  assert.deepEqual(loads.pending, [], "装载结束后不该留下在途记录");
});

test("an invalidation during the read makes that round unstable", async () => {
  const loads = createSingleFlightLoads<string>();
  let calls = 0;
  const value = await withinLimit(loads.load("a", async (state: LoadState) => {
    calls += 1;
    // 第一轮:读到一半被失效(有人在写 journal)。
    if (calls === 1) loads.invalidate("a");
    return outcome(`attempt-${calls}`, state.valid);
  }));

  assert.equal(value, "attempt-2");
  assert.equal(calls, 2);
});

test("gives up at the attempt limit and hands out the last read", async () => {
  const loads = createSingleFlightLoads<string>({ attempts: 2 });
  let calls = 0;
  const value = await withinLimit(loads.load("a", async () => {
    calls += 1;
    return outcome("never-stable", false);
  }));

  // 交出去而不是抛错:调用方要的是一份结果,而这一份是当下最新的。
  assert.equal(value, "never-stable");
  assert.equal(calls, 2);
});

test("keeps the entry free after an invalidation so later callers start clean", async () => {
  const loads = createSingleFlightLoads<string>();
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const first = loads.load("a", async () => {
    calls += 1;
    await gate;
    return outcome("first", true);
  });

  loads.invalidate("a");
  assert.deepEqual(loads.pending, [], "失效之后这条装载不再被共享");
  const second = await withinLimit(loads.load("a", async () => {
    calls += 1;
    return outcome("second", true);
  }));
  release?.();

  assert.equal(second, "second");
  assert.equal(await withinLimit(first), "first");
  assert.equal(calls, 2);
});

test("clear marks a running round as no longer trustworthy", async () => {
  const loads = createSingleFlightLoads<string>();
  let calls = 0;
  const value = await withinLimit(loads.load("a", async (state: LoadState) => {
    calls += 1;
    if (calls === 1) loads.clear();
    return outcome(`attempt-${calls}`, state.valid);
  }));

  assert.equal(value, "attempt-2");
  assert.equal(calls, 2);
});

test("an invalidation that lands before the read is not an invalidation of that read", async () => {
  // `valid` 回答的是"**这一轮**读的时候有没有人来改"。失效落在读**之前**时,这一轮读到的
  // 就是写完之后的那个状态 —— 把这种也当失效只会白读一遍(流式期间就是无限白读)。
  const loads = createSingleFlightLoads<string>();
  const pending = loads.load("a", async (state: LoadState) => outcome("v", state.valid));
  loads.invalidate("a");

  assert.equal(await withinLimit(pending), "v");
});
