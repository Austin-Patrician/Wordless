import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  emptyTokenUsageSummary,
  summarizeTokenUsage,
  type ConversationUsage,
} from "@wordless/domain";
import { summarizeSessionUsage, UsageReportService } from "../src/usage-report.ts";
import { withService, writeJournal } from "./support/usage-fixtures.ts";

test("会话总计把主调用、子代理、专家成员都算进来 —— 只算一次", async () => {
  await withService(async ({ service, session, journalsRoot }) => {
    await writeJournal(session.journalPath, session.id, [
      {
        id: "m1",
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 50,
          cacheWriteTokens: 0,
          totalTokens: 160,
          totalCost: 0.01,
          cacheUsageReporting: "read-only",
        },
      },
      // 工具循环里的第二次调用,仍然算同一会话。
      { id: "m2", usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220, totalCost: 0.02 } },
    ]);
    // 平铺的子代理 journal。
    await writeJournal(join(journalsRoot, "subagents", session.id, "task-1.jsonl"), session.id, [
      { id: "s1", usage: { inputTokens: 300, outputTokens: 30, totalTokens: 330, totalCost: 0.03 } },
    ]);
    // **专家成员** journal 在嵌套目录里 —— 只读平铺那层就会把它整段漏掉。
    await writeJournal(join(journalsRoot, "subagents", session.id, "members", "member-1.jsonl"), session.id, [
      { id: "e1", usage: { inputTokens: 400, outputTokens: 40, totalTokens: 440, totalCost: 0.04 } },
    ]);

    const collection = await service.collectSessionUsage(session);
    assert.equal(collection.records.length, 4);
    assert.equal(collection.records.filter((record) => record.source === "primary").length, 2);
    assert.equal(collection.records.filter((record) => record.source === "delegated").length, 2);

    const primary = collection.records.filter((record) => record.source === "primary");
    const delegated = collection.records.filter((record) => record.source === "delegated");
    const summary = summarizeTokenUsage(
      [...primary, ...delegated].map((record) => record.usage),
      { primaryCalls: primary.length, delegatedCalls: delegated.length },
    );
    assert.ok(summary);
    assert.equal(summary.modelCalls, 4);
    assert.equal(summary.delegatedCalls, 2);
    assert.equal(summary.totalTokens, 160 + 220 + 330 + 440);
    assert.equal(Math.round(summary.totalCost * 1000), 100);
    // 只有第一条上报了缓存读,所以分母只算它 —— 不能把另外三条的 prompt 也算进去。
    assert.equal(summary.cacheReadObservedTokens, 50);
    assert.equal(summary.cacheReadObservedPromptTokens, 150);
    assert.equal(summary.tokenHitRate, 50 / 150);
  });
});

test("拿不到用量的调用被如实计数,而不是算成花了 0", async () => {
  await withService(async ({ service, session }) => {
    await writeJournal(session.journalPath, session.id, [
      { id: "m1", usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } },
      { id: "m2", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      { id: "u1", role: "user" },
      { id: "m3" },
    ]);

    const collection = await service.collectSessionUsage(session);
    assert.equal(collection.records.length, 1);
    // m2(全零)与 m3(没有 usage)都是"不知道";u1 是用户消息,不算调用。
    assert.equal(collection.unmeasuredCalls, 2);
  });
});

test("重复读取给同一个数(不因重复同步而翻倍)", async () => {
  await withService(async ({ service, session }) => {
    await writeJournal(session.journalPath, session.id, [
      { id: "m1", usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } },
      { id: "m2", usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 } },
    ]);
    const first = await service.collectSessionUsage(session);
    const second = await service.collectSessionUsage(session);
    assert.deepEqual(second.records, first.records);
    assert.equal(second.records.length, 2);
  });
});

test("对话与图片分开:图片不进对话的命中率分母,但金额照报", () => {
  const chat = (inputTokens: number, cacheReadTokens = 0, reporting?: ConversationUsage["cacheUsageReporting"]) => ({
    inputTokens,
    outputTokens: 1,
    cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + 1 + cacheReadTokens,
    totalCost: 0.001,
    ...(reporting === undefined ? {} : { cacheUsageReporting: reporting }),
  });
  const snapshot = summarizeSessionUsage({
    records: [
      { source: "primary", usage: chat(100, 50, "read-only") },
      { source: "delegated", usage: chat(200) },
      { source: "image", usage: { ...chat(9_000), totalCost: 0.5 } },
    ],
    unmeasuredCalls: 3,
    imageOperations: 2,
    unmeteredImageOperations: 1,
  });

  assert.equal(snapshot.chat.modelCalls, 2);
  assert.equal(snapshot.chat.delegatedCalls, 1);
  // 图片那 9000 个 token **不得**进对话的分母,否则命中率会被稀释成 50/9300。
  assert.equal(snapshot.chat.promptTokens, 150 + 200);
  assert.equal(snapshot.chat.tokenHitRate, 50 / 150);
  // chat(9000) 的 totalTokens = 9000 输入 + 1 输出 = 9001。
  assert.equal(snapshot.image.totalTokens, 9_001);
  assert.equal(snapshot.image.totalCost, 0.5);
  assert.equal(snapshot.image.operations, 2);
  assert.equal(snapshot.image.unmeteredOperations, 1);
  assert.equal(snapshot.unmeasuredCalls, 3);
});

test("只有图片的会话:对话侧是空汇总,率是 null", () => {
  const snapshot = summarizeSessionUsage({
    records: [
      {
        source: "image",
        usage: {
          inputTokens: 10,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 10,
          totalCost: 0.02,
        },
      },
    ],
    unmeasuredCalls: 0,
    imageOperations: 1,
    unmeteredImageOperations: 0,
  });
  assert.equal(snapshot.chat.modelCalls, 0);
  assert.equal(snapshot.chat.tokenHitRate, null);
  assert.equal(snapshot.image.totalCost, 0.02);
});

test("没有 journal 的会话给空汇总,而率是 null(不是 0%)", () => {
  const empty = emptyTokenUsageSummary();
  assert.equal(empty.modelCalls, 0);
  assert.equal(empty.tokenHitRate, null);
  assert.equal(empty.readCallCoverage, null);
  assert.equal(empty.cacheWriteObservation, "unavailable");
});
