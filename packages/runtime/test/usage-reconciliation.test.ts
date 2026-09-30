import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { summarizeTokenUsage } from "@wordless/domain";
import { createSessionHistoryPage, createSessionHistoryProjection } from "../src/session-history.ts";
import { summarizeSessionUsage } from "../src/usage-report.ts";
import { withService, writeJournal } from "./support/usage-fixtures.ts";

/**
 * 对账。
 *
 * token 关系到计费,所以"数字对不对"不能靠一个测试用例的期望值来保证,而要靠**两条独立的计算
 * 路径互相对账**:
 *
 * - ① journal 聚合(会话总计走的那条:逐条记录带着缓存观测级别)
 * - ② `usage_events` 聚合(应用级用量报表走的那条:派生表)
 * - ③ 渲染层窗口内的求和(分页只加载最近若干轮)
 *
 * ①与②必须逐字段严格相等;③必须 ≤ ①,且差额等于窗口外那些条目之和 —— 这条把"分页少算"从
 * "靠人记得"变成**可检测**。
 */

const HOUR = 60 * 60 * 1_000;

function usageOf(index: number, opts: { cacheReadTokens?: number; cacheWriteTokens?: number; reporting?: "read-only" | "read-write" } = {}) {
  const inputTokens = 100 + index * 10;
  const cacheReadTokens = opts.cacheReadTokens ?? 0;
  const cacheWriteTokens = opts.cacheWriteTokens ?? 0;
  return {
    inputTokens,
    outputTokens: 5 + index,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + 5 + index + cacheReadTokens + cacheWriteTokens,
    totalCost: 0.001 * (index + 1),
    ...(opts.reporting === undefined ? {} : { cacheUsageReporting: opts.reporting }),
  } as const;
}

test("对账:journal 聚合与应用级报表(usage_events 聚合)逐字段相等", async () => {
  await withService(async ({ service, session, journalsRoot }) => {
    // 一批覆盖各种形状的调用:有上报的、没上报的、有子代理的、有专家成员的。
    const entries = [
      { id: "m1", usage: usageOf(0, { cacheReadTokens: 50, cacheWriteTokens: 10, reporting: "read-write" }) },
      { id: "m2", usage: usageOf(1, { cacheReadTokens: 0, reporting: "read-only" }) },
      { id: "m3", usage: usageOf(2) },
      { id: "m4", usage: usageOf(3, { cacheReadTokens: 200, reporting: "read-only" }) },
    ];
    await writeJournal(session.journalPath, session.id, entries);
    await writeJournal(join(journalsRoot, "subagents", session.id, "task-1.jsonl"), session.id, [
      { id: "s1", usage: usageOf(4) },
    ]);
    await writeJournal(join(journalsRoot, "subagents", session.id, "members", "member-1.jsonl"), session.id, [
      { id: "e1", usage: usageOf(5, { cacheReadTokens: 30, reporting: "read-only" }) },
    ]);

    // ① journal
    const collection = await service.collectSessionUsage(session);
    const chat = summarizeSessionUsage(collection).chat;

    // ② 派生表(应用级报表走的那条路)
    const report = await service.getReport({ startAt: 0, endAt: 10 * HOUR, groupBy: "provider" });

    assert.equal(chat.inputTokens, report.totals.inputTokens);
    assert.equal(chat.outputTokens, report.totals.outputTokens);
    assert.equal(chat.cacheReadTokens, report.totals.cacheReadTokens);
    assert.equal(chat.cacheWriteTokens, report.totals.cacheWriteTokens);
    assert.equal(chat.totalTokens, report.totals.totalTokens);
    assert.equal(chat.totalCost.toFixed(6), report.totals.estimatedCost.toFixed(6));
    // 每个 journal 助手消息 = 一次调用 = 一条事件。
    assert.equal(chat.modelCalls, report.totals.requestCount);
    assert.equal(chat.primaryCalls, 4);
    assert.equal(chat.delegatedCalls, 2);

    // 命中率的分子必须是"可观测"的那部分:50 + 0 + 200 + 30,不含未上报那次的 0。
    const observed = summarizeTokenUsage(
      collection.records.filter((record) => record.source !== "image").map((record) => record.usage),
      { primaryCalls: 4, delegatedCalls: 2 },
    );
    assert.equal(observed?.cacheReadObservedTokens, 280);
    // 分母也只含可观测的三次(m1 / m2 / m4 / e1 里,m1、m2、m4、e1 都上报了)。
    assert.equal(observed?.cacheReadObservedCalls, 4);
  });
});

test("对账:渲染层窗口内的求和 ≤ 总计,差额正好是窗口外的条目", async () => {
  await withService(async ({ service, session }) => {
    // 30 轮,每轮一条用户消息 + 一条助手回复。默认分页只加载最近 24 轮 —— 和渲染层拿到的形状一致。
    const entries: Array<{ id: string; role?: "assistant" | "user"; usage?: ReturnType<typeof usageOf> }> = [];
    for (let turn = 0; turn < 30; turn += 1) {
      entries.push({ id: `u${turn}`, role: "user" });
      entries.push({ id: `a${turn}`, usage: usageOf(turn, { cacheReadTokens: 10, reporting: "read-only" }) });
    }
    await writeJournal(session.journalPath, session.id, entries);

    const collection = await service.collectSessionUsage(session);
    const total = summarizeSessionUsage(collection).chat;
    assert.equal(total.modelCalls, 30);

    // 渲染层拿到的是消息列表(用户 + 助手),所以这里也照这个形状喂给真实的分页函数。
    const messages = collection.records.flatMap((record, index) => [
      { id: `u${index}`, role: "user" as const, timestamp: index * 2, blocks: [] },
      { id: `a${index}`, role: "assistant" as const, timestamp: index * 2 + 1, blocks: [], usage: record.usage },
    ]);
    const projection = createSessionHistoryProjection(messages, []);
    const page = createSessionHistoryPage(projection, "r1");
    assert.equal(page.hasMoreBefore, true, "这个夹具本来就应该有被分页掉的部分");

    const windowed = page.items.flatMap((item) =>
      item.type === "turn" ? item.turn.messages.flatMap((message) => (message.usage ? [message.usage] : [])) : [],
    );
    // 窗口里应当是最近 24 轮那 24 次调用。
    assert.equal(windowed.length, 24);
    const windowTotal = summarizeTokenUsage(windowed, { primaryCalls: windowed.length, delegatedCalls: 0 });
    assert.ok(windowTotal);

    // ① 窗口内确实是**少算**的(这正是"不能拿窗口求和当会话总计"的原因)……
    assert.ok(windowTotal.totalTokens < total.totalTokens, "窗口内求和应当小于总计");
    // ……② 而差额**正好**等于窗口外那 6 轮,不是"凭空少一点"。
    const outside = summarizeTokenUsage(
      collection.records.slice(0, 6).map((record) => record.usage),
      { primaryCalls: 6, delegatedCalls: 0 },
    );
    assert.ok(outside);
    assert.equal(windowTotal.totalTokens + outside.totalTokens, total.totalTokens);
    assert.equal(windowTotal.promptTokens + outside.promptTokens, total.promptTokens);
    assert.equal(windowTotal.totalCost.toFixed(6), (total.totalCost - outside.totalCost).toFixed(6));
    // 每次都上报了缓存 ⇒ 观测调用数也各自对得上。
    assert.equal(windowTotal.cacheReadObservedCalls, 24);
    assert.equal(outside.cacheReadObservedCalls, 6);
  });
});
