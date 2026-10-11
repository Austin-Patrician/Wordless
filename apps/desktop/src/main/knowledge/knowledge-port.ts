import type { KnowledgePageKind, KnowledgePageView, KnowledgePort, KnowledgeWriteInput, KnowledgeWriteOutcome } from "@wordless/capability-knowledge";
import type { KnowledgeService } from "./knowledge-service.ts";

/**
 * 把知识库服务适配成能力包声明的端口。
 *
 * 适配层做的事很少,因为**判定本来就在服务里**:路径规则、类型与目录一致、封闭 schema 的
 * 校验,全部发生在写路径上。这里只把两种形状翻译过去(服务用内部形状,端口用只读视图),
 * 并把"解析失败"这类事实如实带出来。
 *
 * 与其它能力不同的是**这里没有工作区路径约束**:bundle 是应用拥有的位置,不在任何会话工作区
 * 之内 —— 约束改由路径规则承担(`raws/**` 与派生物不可写,见 `knowledge-layout.ts`)。
 */
export function createKnowledgePort(resolveService: () => Promise<KnowledgeService>): KnowledgePort {
  return {
    async listPages(): Promise<KnowledgePageView[]> {
      const { entries } = await (await resolveService()).scanPages();
      return entries.map((entry) => ({
        path: entry.path,
        kind: entry.page.type as KnowledgePageKind,
        title: entry.page.title,
        description: entry.page.description,
        tags: entry.page.tags,
        sources: (entry.page.sources ?? []).map((source) => source.resource),
        orphaned: entry.page.private?.orphaned_at != null,
      }));
    },

    async retirePage(path: string): Promise<void> {
      // 理由由服务记进 log(工具的 reason 参数经这里传下去)。校验与"拒绝退役复核页"在服务里。
      await (await resolveService()).retirePage(path, new Date().toISOString());
    },

    async writePage(input: KnowledgeWriteInput): Promise<KnowledgeWriteOutcome> {
      const written = await (await resolveService()).writePage({
        path: input.path,
        type: input.kind as KnowledgePageKind,
        title: input.title,
        description: input.description,
        tags: input.tags,
        ...(input.sources === undefined ? {} : { sources: input.sources }),
        body: input.body,
        // 写入者标识走 actor 约定(OKF §7):这版只有 agent 写,人通过界面改的走另一条。
        by: "wordless-agent/knowledge",
        now: new Date().toISOString(),
        ...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
      });
      return { path: written.path, action: written.action };
    },
  };
}
