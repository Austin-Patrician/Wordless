import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KnowledgePoller, roundSkipReason, type KnowledgePollerConfig } from "../src/main/knowledge/knowledge-poller.ts";

/**
 * 加工调度。
 *
 * 这一层不碰模型、不碰工具 —— 它只决定**什么时候起一轮**。所以这里验的是那几条判断:
 *   1. 关掉/没选模型/只手动/正在跑 → 不起会话,而且**理由分得清**(界面要说得出为什么);
 *   2. 定时加工**绝不回退默认模型**(无人值守时用哪个模型花钱,是用户必须自己决定的);
 *   3. 没活就不起会话(白起一个只会得到一句"没什么可做的");
 *   4. 收尾只认 `run.*` 三种结束事件,而且**中止的轮次也算收尾**(否则界面永远显示"正在整理")。
 */

interface Harness {
  poller: KnowledgePoller;
  started: Array<{ prompt: string; modelKey: string | null }>;
  finished: Array<{ kind: string; summary: string }>;
  processing: boolean[];
  setConfig: (next: Partial<KnowledgePollerConfig>) => void;
  setPlan: (next: KnowledgeRoundPlan) => void;
  setNeedsAgent: (next: boolean) => void;
}

function harness(config: Partial<KnowledgePollerConfig> = {}, hasWork = true): Harness {
  let current: KnowledgePollerConfig = { enabled: true, intervalMinutes: 5, modelKey: "openai/gpt-5", ...config };
  let prepared = hasWork;
  // 有些轮次只有工程侧的动作(移动/删除/回收):不起会话,但收尾照走。
  let needsAgent = true;
  const started: Harness["started"] = [];
  const finished: Harness["finished"] = [];
  const processing: boolean[] = [];
  const poller = new KnowledgePoller({
    readConfig: async () => current,
    prepare: async (kind) => (prepared ? { kind, prompt: "prompt:1", summary: "s", needsAgent } : null),
    startSession: async (prompt, modelKey) => {
      started.push({ prompt, modelKey });
      return "session-1";
    },
    finish: async (preparation) => {
      finished.push(preparation);
    },
    onProcessingChanged: (next) => processing.push(next),
    logger: { info: () => undefined, warn: () => undefined },
  });
  return {
    poller,
    started,
    finished,
    processing,
    setConfig: (next) => {
      current = { ...current, ...next };
    },
    setNeedsAgent: (next) => {
      needsAgent = next;
    },
    setPlan: (next) => {
      prepared = next;
    },
  };
}

describe("该不该跑这一轮", () => {
  it("四种「不跑」的理由分得清 —— 界面要说得出为什么", () => {
    const base: KnowledgePollerConfig = { enabled: true, intervalMinutes: 5, modelKey: "openai/gpt-5" };
    assert.equal(roundSkipReason(base, { processing: false }, "scheduled"), null);
    assert.equal(roundSkipReason({ ...base, enabled: false }, { processing: false }, "scheduled"), "disabled");
    assert.equal(roundSkipReason(base, { processing: true }, "scheduled"), "busy");
    assert.equal(roundSkipReason({ ...base, intervalMinutes: 0 }, { processing: false }, "scheduled"), "manual-only");
    assert.equal(roundSkipReason({ ...base, modelKey: null }, { processing: false }, "scheduled"), "no-model");
    // 模型键必须带 "/",半截的键不是有效配置。
    assert.equal(roundSkipReason({ ...base, modelKey: "gpt-5" }, { processing: false }, "scheduled"), "no-model");
  });

  it("手动忽略「只手动」与「没选模型」,但不忽略「关掉」与「正在跑」", () => {
    const base: KnowledgePollerConfig = { enabled: true, intervalMinutes: 0, modelKey: null };
    assert.equal(roundSkipReason(base, { processing: false }, "manual"), null, "用户就在旁边,点了他就想跑");
    assert.equal(roundSkipReason({ ...base, enabled: false }, { processing: false }, "manual"), "disabled");
    assert.equal(roundSkipReason(base, { processing: true }, "manual"), "busy");
  });
});

describe("一轮的实际行为", () => {
  it("有活 → 起会话,并把模型键交给会话", async () => {
    const h = harness();
    const outcome = await h.poller.organize("scheduled");
    assert.equal(outcome.sessionId, "session-1");
    assert.deepEqual(h.started, [{ prompt: "prompt:1", modelKey: "openai/gpt-5" }]);
    assert.deepEqual(h.processing, [true]);
  });

  it("没活 → 不起会话(准备那一步已经说明没活了)", async () => {
    const h = harness({}, false);
    const outcome = await h.poller.organize("scheduled");
    assert.equal(outcome.skipped, "nothing-to-do");
    assert.equal(h.started.length, 0, "白起一个会话只会得到一句「没什么可做的」");
    assert.deepEqual(h.processing, [], "没起会话就不该显示「正在整理」");
  });

  it("体检也是一种轮次:同样的调度、并发与状态,只是准备的东西不同", async () => {
    const h = harness();
    const outcome = await h.poller.organize("manual", "lint");
    assert.equal(outcome.sessionId, "session-1");
    assert.equal(outcome.preparation?.kind, "lint");
    h.poller.handleRuntimeEvent({ sessionId: outcome.sessionId, event: { type: "run.completed" } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.finished[0]?.kind, "lint");
  });

  it("定时加工没选模型 → 不起会话(绝不回退默认模型)", async () => {
    const h = harness({ modelKey: null });
    assert.equal((await h.poller.organize("scheduled")).skipped, "no-model");
    assert.equal(h.started.length, 0);
  });

  it("手动没选模型也能跑:模型跟随会话默认", async () => {
    const h = harness({ modelKey: null, intervalMinutes: 0 });
    assert.equal((await h.poller.organize("manual")).sessionId, "session-1");
    assert.deepEqual(h.started, [{ prompt: "prompt:1", modelKey: null }]);
  });

  it("正在跑时不重入 —— 两轮并发会互相覆盖页面", async () => {
    const h = harness();
    await h.poller.organize("scheduled");
    assert.equal(h.poller.isProcessing(), true);
    assert.equal((await h.poller.organize("manual")).skipped, "busy");
    assert.equal(h.started.length, 1);
  });

  it("会话跑完才收尾,并且状态归位", async () => {
    const h = harness();
    const outcome = await h.poller.organize("scheduled");
    // 中途来的别的会话事件不该被当成这一轮结束。
    h.poller.handleRuntimeEvent({ sessionId: "别的会话", event: { type: "run.completed" } });
    h.poller.handleRuntimeEvent({ sessionId: outcome.sessionId, event: { type: "run.started" } });
    assert.equal(h.poller.isProcessing(), true);

    h.poller.handleRuntimeEvent({ sessionId: outcome.sessionId, event: { type: "run.completed" } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.processing, [true, false]);
    assert.equal(h.finished.length, 1);
  });

  it("中止的轮次也算收尾 —— 否则界面永远显示「正在整理」", async () => {
    const h = harness();
    const outcome = await h.poller.organize("scheduled");
    h.poller.handleRuntimeEvent({ sessionId: outcome.sessionId, event: { type: "run.cancelled" } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.processing, [true, false]);
    assert.equal(h.poller.isProcessing(), false);
  });

  it("起会话失败时状态放回去,不卡在「正在整理」", async () => {
    const started: string[] = [];
    const poller = new KnowledgePoller({
      readConfig: async () => ({ enabled: true, intervalMinutes: 0, modelKey: "openai/gpt-5" }),
      prepare: async (kind) => ({ kind, prompt: "prompt", summary: "s", needsAgent: true }),
      startSession: async () => {
        started.push("x");
        throw new Error("模型不可用");
      },
      finish: async () => undefined,
      onProcessingChanged: (next) => started.push(String(next)),
      logger: { info: () => undefined, warn: () => undefined },
    });
    const outcome = await poller.organize("scheduled");
    assert.equal(outcome.sessionId, undefined);
    assert.equal(poller.isProcessing(), false, "失败了不能一直显示「正在整理」");
  });

  it("只有工程动作的轮次:不起会话,但**收尾照走** —— 那是失败对账唯一的机会", async () => {
    // 这是那个已经出过事的洞:以前"有活的那一轮"从不跑失败对账,于是
    // "计划 1 页、实际 0 页"被记成成功。收尾必须只有一条路,而且两条路都要走它。
    const h = harness();
    h.setNeedsAgent(false);
    const outcome = await h.poller.organize("scheduled");
    assert.equal(outcome.sessionId, undefined);
    assert.equal(h.started.length, 0, "没有 agent 的活就不该起会话");
    assert.equal(h.finished.length, 1, "但收尾必须走 —— 重建目录、追加时间线、对账失败记录");
    assert.equal(h.processing.includes(true), false, "没起会话就不该显示「正在整理」");
  });

  it("stop() 之后不再起轮次", async () => {
    const h = harness();
    h.poller.stop();
    assert.equal((await h.poller.organize("manual")).skipped, "disabled");
  });
});
