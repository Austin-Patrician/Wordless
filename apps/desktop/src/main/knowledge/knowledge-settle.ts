import { formatRoundLogLine, roundLogKind } from "./knowledge-derived.ts";
import type { KnowledgeRoundResult, KnowledgeRoundPlan, KnowledgeService } from "./knowledge-service.ts";
import type { KnowledgeRoundKind } from "./knowledge-poller.ts";

/**
 * 一轮的收尾。**只有这一个入口。**
 *
 * 抽出来的理由是一次真实的错:以前收尾散在两条路上 —— "只有工程动作"的那条顺手收尾,
 * "有 agent 活"的那条另收一次,而**失败对账只在第一条里**。于是会失败的那一轮从不记账:
 * 日志写着 `加工:+1`,库里 0 页,用户以为成功了。
 *
 * 三条动作的顺序是有意的:
 *   1. **对账产出**(与失败账本同源)—— 必须发生在写日志之前,否则日志只能记计划;
 *   2. **重建派生**(`index.md`)—— 页面的真相刚变过;
 *   3. **追加时间线**(`log.md`)—— 记的是**实际产出**,不是计划。
 */
export async function settleKnowledgeRound(input: {
  service: KnowledgeService;
  kind: KnowledgeRoundKind;
  /** 这一轮真跑过 agent 吗。没跑就没有"产出"可言,只有工程动作。 */
  needsAgent: boolean;
  /** 这一轮的待办计划;没跑加工就是 null。 */
  plan: KnowledgeRoundPlan | null;
  /** 一句话摘要(体检用;加工的措辞由产出决定)。 */
  summary: string;
  now: string;
}): Promise<KnowledgeRoundResult | null> {
  const { service, kind, needsAgent, plan, summary, now } = input;

  const result = kind === "process" && needsAgent && plan !== null ? await service.finishRound(plan, now) : null;
  await service.rebuildIndex();

  if (kind === "lint") {
    await service.appendLog({ at: now, kind: "Update", text: `体检:${summary}` });
    return result;
  }

  const facts = {
    added: plan?.diff.added.length ?? 0,
    changed: plan?.diff.changed.length ?? 0,
    moved: plan?.diff.moved.length ?? 0,
    deleted: plan?.diff.deleted.length ?? 0,
    reaped: plan?.reaped.length ?? 0,
    result: result === null ? null : { written: result.written.length, failed: result.failed.length, gone: result.gone.length },
  };
  await service.appendLog({ at: now, kind: roundLogKind(facts), text: `加工:${formatRoundLogLine(facts)}` });
  return result;
}
