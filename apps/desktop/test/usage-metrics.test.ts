import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTurnUsage,
  conversationUsageFromAiUsage,
  summarizeUsageMessages,
  conversationUsageFromUnknown,
  mergeConversationUsage,
  promptTokensOf,
  summarizeTokenUsage,
  type ConversationUsage,
} from "@wordless/domain";

/**
 * 精度地基。token 直接关系计费,所以这里每条断言都在锁一个"数会算错"的具体情形,
 * 而不是在锁实现细节。
 */

function usage(
  parts: Partial<ConversationUsage> & { inputTokens: number; outputTokens: number },
): ConversationUsage {
  const cacheReadTokens = parts.cacheReadTokens ?? 0;
  const cacheWriteTokens = parts.cacheWriteTokens ?? 0;
  return {
    inputTokens: parts.inputTokens,
    outputTokens: parts.outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      parts.totalTokens ??
      parts.inputTokens + parts.outputTokens + cacheReadTokens + cacheWriteTokens,
    totalCost: parts.totalCost ?? 0,
    ...(parts.cacheUsageReporting === undefined
      ? {}
      : { cacheUsageReporting: parts.cacheUsageReporting }),
    ...(parts.reportedPromptTokens === undefined
      ? {}
      : { reportedPromptTokens: parts.reportedPromptTokens }),
  };
}

test("I1:prompt 是三分量之和,output 永不进分母", () => {
  const record = usage({
    inputTokens: 20,
    outputTokens: 999,
    cacheReadTokens: 70,
    cacheWriteTokens: 10,
    cacheUsageReporting: "read-write",
  });
  assert.equal(promptTokensOf(record), 100);

  const summary = summarizeTokenUsage([record], { primaryCalls: 1, delegatedCalls: 0 });
  assert.ok(summary);
  // output 远大于 prompt,若混进分母命中率会崩到 7%。
  assert.equal(summary.promptTokens, 100);
  assert.equal(summary.tokenHitRate, 0.7);
  assert.equal(summary.writeRate, 0.1);
});

test("I2:上报的 0 是真实未命中;未上报是 null —— 两者绝不相同", () => {
  // provider 明确上报了缓存字段,但这次没命中。
  const observedMiss = summarizeTokenUsage(
    [usage({ inputTokens: 100, outputTokens: 1, cacheReadTokens: 0, cacheUsageReporting: "read-only" })],
    { primaryCalls: 1, delegatedCalls: 0 },
  );
  assert.equal(observedMiss?.tokenHitRate, 0);
  assert.equal(observedMiss?.requestHitRate, 0);
  assert.equal(observedMiss?.readCallCoverage, 1);

  // provider 没上报任何缓存字段(历史记录、不支持缓存的模型都长这样)。
  const unreported = summarizeTokenUsage(
    [usage({ inputTokens: 100, outputTokens: 1, cacheReadTokens: 0 })],
    { primaryCalls: 1, delegatedCalls: 0 },
  );
  assert.equal(unreported?.tokenHitRate, null);
  assert.equal(unreported?.requestHitRate, null);
  assert.equal(unreported?.writeRate, null);
  // 覆盖率下降是它对的表现:让界面能说清"这个率没覆盖到调用"。
  assert.equal(unreported?.readCallCoverage, 0);
});

test("I3:命中率只对被观测到的调用求和", () => {
  const summary = summarizeTokenUsage(
    [
      // 可观测:100 prompt,命中 70
      usage({ inputTokens: 20, outputTokens: 1, cacheReadTokens: 70, cacheWriteTokens: 10, cacheUsageReporting: "read-write" }),
      // 可观测:100 prompt,命中 50,没写缓存
      usage({ inputTokens: 50, outputTokens: 1, cacheReadTokens: 50, cacheUsageReporting: "read-only" }),
      // 未上报:这部分 prompt 与命中都**不得**进率的分母/分子
      usage({ inputTokens: 10_000, outputTokens: 1, cacheReadTokens: 5_000 }),
    ],
    { primaryCalls: 2, delegatedCalls: 1 },
  );
  assert.ok(summary);
  // 分子只算可观测的 70+50=120,分母只算可观测的 200 —— 若把未上报那次的
  // 10000/5000 混进来,命中率会变成 12.4%。
  assert.equal(summary.cacheReadObservedTokens, 120);
  assert.equal(summary.cacheReadObservedPromptTokens, 200);
  assert.equal(summary.tokenHitRate, 0.6);
  assert.equal(summary.cacheHitCalls, 2);
  assert.equal(summary.requestHitRate, 1);
  // 3 条记录里 2 条可观测。
  assert.equal(summary.readCallCoverage, 2 / 3);
  // 展示用的总量仍然是全量,不受率的口径影响。
  assert.equal(summary.cacheReadTokens, 5_120);
});

test("I10:按 token 加权,不取百分比平均", () => {
  // 两次调用:一次大(90% 命中)、一次小(0% 命中)。
  // 百分比平均会得到 45%,那是错的。
  const summary = summarizeTokenUsage(
    [
      usage({ inputTokens: 10_000, outputTokens: 1, cacheReadTokens: 90_000, cacheUsageReporting: "read-only" }),
      usage({ inputTokens: 1_000, outputTokens: 1, cacheReadTokens: 0, cacheUsageReporting: "read-only" }),
    ],
    { primaryCalls: 2, delegatedCalls: 0 },
  );
  assert.ok(summary);
  assert.equal(summary.tokenHitRate, 90_000 / 101_000);
  // 调用级命中率是另一个数(1/2),两者不可混用。
  assert.equal(summary.requestHitRate, 0.5);
});

test("I7:合并带观测计数,先合并再汇总 == 逐条汇总", () => {
  const records = [
    usage({ inputTokens: 20, outputTokens: 1, cacheReadTokens: 70, cacheWriteTokens: 10, cacheUsageReporting: "read-write" }),
    usage({ inputTokens: 50, outputTokens: 1, cacheReadTokens: 50, cacheUsageReporting: "read-only" }),
    usage({ inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 }),
  ];
  const direct = summarizeTokenUsage(records, { primaryCalls: 3, delegatedCalls: 0 });

  let merged;
  for (const record of records) merged = mergeConversationUsage(merged, record);
  assert.ok(merged);
  const folded = summarizeTokenUsage([merged], { primaryCalls: 3, delegatedCalls: 0 });

  assert.equal(folded?.tokenHitRate, direct?.tokenHitRate);
  assert.equal(folded?.readCallCoverage, direct?.readCallCoverage);
  assert.equal(folded?.requestHitRate, direct?.requestHitRate);
  // 逐条事实在合并后不再有唯一答案,必须被清掉(缺省 = 未上报)。
  assert.equal(merged.cacheUsageReporting, undefined);
});

test("对账:provider 自报的 prompt 与分量和不符时能说清,而不是静默吞掉", () => {
  const agreeing = summarizeTokenUsage(
    [usage({ inputTokens: 20, outputTokens: 1, cacheReadTokens: 70, cacheWriteTokens: 10, reportedPromptTokens: 100 })],
    { primaryCalls: 1, delegatedCalls: 0 },
  );
  assert.equal(agreeing?.reportedPromptCount, 1);
  assert.equal(agreeing?.reportedPromptDriftCount, 0);

  // provider 报 prompt=100,但分量和只有 90 —— 我们归一化时 clamp 掉过 10 个 token。
  const drifting = summarizeTokenUsage(
    [usage({ inputTokens: 90, outputTokens: 1, reportedPromptTokens: 100 })],
    { primaryCalls: 1, delegatedCalls: 0 },
  );
  assert.equal(drifting?.reportedPromptDriftCount, 1);
  assert.equal(drifting?.reportedPromptMaxDrift, 10);
});

test("逐条事实过工具块边界:合法值保留,非法值当缺失而不是当 0", () => {
  const base = { inputTokens: 10, outputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, totalTokens: 16, totalCost: 0 };

  // 子代理/专家团的用量是以 `details.usage` 形式过界的,这两项必须一起带过来,
  // 否则委派调用的缓存观测在边界上就丢了。
  const parsed = conversationUsageFromUnknown({
    ...base,
    cacheUsageReporting: "read-write",
    reportedPromptTokens: 15,
  });
  assert.equal(parsed?.cacheUsageReporting, "read-write");
  assert.equal(parsed?.reportedPromptTokens, 15);

  // 垃圾值一律当"没有" —— 0 是有含义的值(真未命中),不能被强转进来。
  const garbage = conversationUsageFromUnknown({
    ...base,
    cacheUsageReporting: "maybe",
    reportedPromptTokens: -5,
  });
  assert.equal(garbage?.cacheUsageReporting, undefined);
  assert.equal(garbage?.reportedPromptTokens, undefined);

  // 六项基础字段仍然必须齐全。
  assert.equal(conversationUsageFromUnknown({ ...base, totalCost: undefined }), undefined);
});

test("写入的可观测状态:上报了 / 只读 / 什么都没上报", () => {
  const observed = summarizeTokenUsage(
    [usage({ inputTokens: 10, outputTokens: 1, cacheWriteTokens: 5, cacheUsageReporting: "read-write" })],
    { primaryCalls: 1, delegatedCalls: 0 },
  );
  assert.equal(observed?.cacheWriteObservation, "reported");
  assert.equal(observed?.writeRate, 5 / 15);

  // 只读上报:写入覆盖率是 0,但**不能说**"写入占比 0%" —— 真实含义是它根本不报写入。
  const readOnly = summarizeTokenUsage(
    [usage({ inputTokens: 10, outputTokens: 1, cacheReadTokens: 5, cacheUsageReporting: "read-only" })],
    { primaryCalls: 1, delegatedCalls: 0 },
  );
  assert.equal(readOnly?.cacheWriteObservation, "read-only");
  assert.equal(readOnly?.writeRate, null);

  // 一次都没上报。
  const nothing = summarizeTokenUsage([usage({ inputTokens: 10, outputTokens: 1 })], {
    primaryCalls: 1,
    delegatedCalls: 0,
  });
  assert.equal(nothing?.cacheWriteObservation, "unavailable");
});

test("适配器形状的 usage 只由一处折算,且全零不冒充一次成功调用", () => {
  // 这是 runtime / agent-driver-generic / usage-report 三处曾经各自实现过的东西 ——
  // 现在只有一个实现,所以这里锁的是它们共同的口径。
  const mapped = conversationUsageFromAiUsage({
    input: 20,
    output: 5,
    cacheRead: 70,
    cacheWrite: 10,
    totalTokens: 105,
    cost: { total: 0.5 },
    cacheUsageReporting: "read-write",
    reportedPromptTokens: 100,
  });
  assert.equal(mapped?.inputTokens, 20);
  assert.equal(mapped?.totalTokens, 105);
  assert.equal(mapped?.cacheUsageReporting, "read-write");
  assert.equal(mapped?.reportedPromptTokens, 100);

  // 没有 totalTokens 时按分量求和(provider 只给分量)。
  const summed = conversationUsageFromAiUsage({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  assert.equal(summed?.totalTokens, 10);

  // 全零 ⇒ undefined。三份旧副本里有一份把全零当成"成功但没用量",会在汇总里多出一次假调用。
  assert.equal(conversationUsageFromAiUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), undefined);
  assert.equal(conversationUsageFromAiUsage(undefined), undefined);
  assert.equal(conversationUsageFromAiUsage("nope"), undefined);
});

test("两条路径算的是同一个数:轮次边界 + summarizeUsageMessages == calculateTurnUsage", () => {
  // 「当前轮」(元数据那条)与「逐轮」(助手行那条)必须同源,否则同一屏会出现两个数。
  const turn = [
    { kind: "a1", usage: usage({ inputTokens: 10, outputTokens: 1, cacheReadTokens: 5, cacheUsageReporting: "read-only" }) },
    { kind: "a2", usage: usage({ inputTokens: 20, outputTokens: 2 }) },
    { kind: "a3", usage: usage({ inputTokens: 30, outputTokens: 3, cacheReadTokens: 10, cacheWriteTokens: 1, cacheUsageReporting: "read-write" }) },
  ];
  const asMessage = (item: (typeof turn)[number], index: number) =>
    ({
      id: item.kind,
      role: "assistant",
      timestamp: index,
      blocks: [],
      ...(item.usage === undefined ? {} : { usage: item.usage }),
    }) as never;
  const messages = [
    { id: "u1", role: "user", timestamp: 0, blocks: [] },
    ...turn.map(asMessage),
  ] as never;

  const fromBoundary = calculateTurnUsage(messages);
  const fromRow = summarizeUsageMessages(turn.map(asMessage));
  assert.ok(fromBoundary && fromRow);
  assert.deepEqual(fromRow.summary, fromBoundary.summary);
  assert.deepEqual(fromRow.usage, fromBoundary.usage);

  // 边界确实不一样:把 user 消息换成"中途插话"后,只算插话之后那一段。
  const steered = [...messages, { id: "u2", role: "user", timestamp: 9, blocks: [] }, asMessage(turn[2], 10)] as never;
  assert.equal(calculateTurnUsage(steered)?.summary.primaryCalls, 1);
});

test("I11:轮次边界是最后一条 user 消息;steer 开新一轮", () => {
  const message = (role: "user" | "assistant", id: string, port: number) => ({
    id,
    role,
    timestamp: port,
    blocks: [],
    ...(role === "assistant"
      ? { usage: usage({ inputTokens: 100, outputTokens: 1, cacheReadTokens: 0, cacheUsageReporting: "read-only" }) }
      : {}),
  });

  const messages = [
    message("user", "u1", 1),
    message("assistant", "a1", 2),
    // steer:用户在助手跑的过程中又插了一句话 —— 按既有口径,它开新一轮。
    { ...message("user", "u2", 3) },
    message("assistant", "a2", 4),
  ] as never;

  const details = calculateTurnUsage(messages);
  assert.ok(details);
  assert.equal(details.summary.primaryCalls, 1);
  assert.equal(details.usage.primaryCallCount, 1);
  // 只统计 u2 之后的 a2,不把 a1 并进来。
  assert.equal(details.summary.promptTokens, 100);

  // 没有 user 消息(只有助手输出)→ 没有"本轮"可言。
  assert.equal(calculateTurnUsage([message("assistant", "a9", 9)] as never), undefined);
});
