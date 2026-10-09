import assert from "node:assert/strict";
import test from "node:test";

import {
  modelCallTimingFromUnknown,
  summarizeTurnLatency,
  type ModelCallTiming,
  type ConversationUsage,
} from "@wordless/domain";

/**
 * 首 token 耗时与输出速度。
 *
 * 单独一个文件而不是并进 `usage-metrics.test.ts`:那份文件的仓库副本是 **CRLF**,任何改动都会
 * 让 git 把整个文件当成重写(它和 `core.autocrlf` 的归一化对不上),看不出真正改了什么。
 *
 * 这里锁的都是"会算出一个看起来合理但错的数"的情形 —— 速度被小调用带偏、缺失被当成 0、
 * 拿总时长冒充首 token。它们是面板上唯一两个"时间"数字,错了没有别的地方能发现。
 */

/** 一条助手消息:只带 `usage` 与 `timing`(形状与 runtime 映射出来的一致)。 */
function callMessage(
  id: string,
  parts: { outputTokens: number; timing?: Partial<ModelCallTiming> },
): never {
  return {
    id,
    role: "assistant",
    timestamp: 0,
    blocks: [],
    usage: {
      inputTokens: 10,
      outputTokens: parts.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 10 + parts.outputTokens,
      totalCost: 0,
    } satisfies ConversationUsage,
    ...(parts.timing === undefined
      ? {}
      : {
          timing: {
            requestStartedAt: 0,
            completedAt: 1_000,
            streamed: false,
            ...parts.timing,
          },
        }),
  } as never;
}


test("速度按生成窗口加权,不是对每次调用的速度取平均", () => {
  // 小调用快、大调用慢:算术平均会算出 (200 + 25)/2 = 112.5 tok/s,而真实吞吐是 225/10.1s。
  const messages = [
    callMessage("small", {
      outputTokens: 10,
      timing: { firstTokenAt: 100, completedAt: 150, streamed: true },
    }),
    callMessage("large", {
      outputTokens: 215,
      timing: { firstTokenAt: 200, completedAt: 10_200, streamed: true },
    }),
  ] as never;
  const latency = summarizeTurnLatency(messages);

  assert.equal(latency.observedCalls, 2);
  assert.equal(latency.totalCalls, 2);
  assert.equal(latency.generationMs, 50 + 10_000);
  // Σoutput / Σ窗口 = 225 / 10.05s ≈ 22.4,远低于"平均每次的速度"。
  assert.ok(latency.outputTokensPerSecond !== null);
  assert.ok(Math.abs(latency.outputTokensPerSecond - 225 / 10.05) < 0.01);
  assert.ok(latency.outputTokensPerSecond < 30, "加权后不该被小调用拉到 100 以上");
});

test("没有观测到流式增量 ⇒ 首 token 与速度都是 null,而不是 0 或总时长", () => {
  const messages = [
    callMessage("non-streaming", {
      outputTokens: 50,
      timing: { completedAt: 3_000, streamed: false },
    }),
  ] as never;
  const latency = summarizeTurnLatency(messages);

  assert.equal(latency.observedCalls, 0);
  assert.equal(latency.totalCalls, 1);
  // 非流式响应里"首 token 耗时"就是整个调用时长(3s),拿它冒充会骗人。
  assert.equal(latency.firstTokenMs, null);
  assert.equal(latency.outputTokensPerSecond, null);
  assert.equal(latency.generationMs, 0);
  // 逐次明细仍然在:它交代了"这一次没有采集到"。
  assert.equal(latency.calls.length, 1);
  assert.equal(latency.calls[0]?.firstTokenMs, null);
});

test("老记录(没有 timing)只降覆盖率,不影响别的数", () => {
  const messages = [
    {
      id: "old",
      role: "assistant",
      timestamp: 0,
      blocks: [],
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        totalCost: 0,
      },
    },
    callMessage("new", {
      outputTokens: 100,
      timing: { firstTokenAt: 500, completedAt: 2_500, streamed: true },
    }),
  ] as never;
  const latency = summarizeTurnLatency(messages);

  assert.equal(latency.totalCalls, 2);
  assert.equal(latency.observedCalls, 1);
  assert.equal(latency.firstTokenMs, 500);
  assert.equal(latency.callFirstTokenMedianMs, 500);
  // 分子只含窗口可观测的那次调用(100),老记录那 5 个 token 不许进分子。
  assert.ok(Math.abs((latency.outputTokensPerSecond ?? 0) - 50) < 0.01);
});

test("首 token 取本轮第一次可观测调用;中位数不被单次慢调用带偏", () => {
  const messages = [
    callMessage("first", { outputTokens: 1, timing: { firstTokenAt: 1_200, completedAt: 1_300, streamed: true } }),
    callMessage("second", { outputTokens: 1, timing: { firstTokenAt: 1_000, completedAt: 1_100, streamed: true } }),
    callMessage("slow", { outputTokens: 1, timing: { firstTokenAt: 30_000, completedAt: 30_100, streamed: true } }),
  ] as never;
  const latency = summarizeTurnLatency(messages);

  assert.equal(latency.firstTokenMs, 1_200);
  assert.equal(latency.callFirstTokenMedianMs, 1_200);
});

test("委派调用(子代理)不进速度口径:它们的时间事实没随工具块上报", () => {
  const delegated = {
    id: "with-delegated",
    role: "assistant",
    timestamp: 0,
    blocks: [
      {
        type: "tool",
        callId: "c1",
        name: "delegate_expert",
        state: "complete",
        usage: {
          inputTokens: 1,
          outputTokens: 900,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 901,
          totalCost: 0,
        },
      },
    ],
    usage: {
      inputTokens: 10,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 110,
      totalCost: 0,
    },
    timing: { requestStartedAt: 0, firstTokenAt: 100, completedAt: 1_100, streamed: true },
  } as never;
  const latency = summarizeTurnLatency([delegated]);

  // 分母只认主调用:那 900 个委派 token 若进了分子,速度会虚高 10 倍。
  assert.equal(latency.totalCalls, 1);
  assert.ok(Math.abs((latency.outputTokensPerSecond ?? 0) - 100) < 0.01);
});

test("timing 从磁盘读回来时逐字段判类型:坏字段只让这一个数不可得", () => {
  assert.equal(modelCallTimingFromUnknown(undefined), undefined);
  assert.equal(modelCallTimingFromUnknown("nope"), undefined);
  // 缺 requestStartedAt / completedAt ⇒ 整个时间事实不可用(算不出任何时长)。
  assert.equal(modelCallTimingFromUnknown({ completedAt: 5 }), undefined);
  assert.equal(modelCallTimingFromUnknown({ requestStartedAt: 1 }), undefined);

  const parsed = modelCallTimingFromUnknown({
    requestStartedAt: 100,
    firstTokenAt: "900",       // 类型不对 ⇒ 当没有,而不是强转成 900
    completedAt: 2_000,
    streamed: "yes",           // 不是 true ⇒ 当没有观测到
  });
  assert.deepEqual(parsed, { requestStartedAt: 100, completedAt: 2_000, streamed: false });
});
