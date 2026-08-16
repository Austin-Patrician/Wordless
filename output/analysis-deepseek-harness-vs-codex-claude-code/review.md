# 审校报告:DeepSeek Harness vs Codex vs Claude Code 初稿

> 审校对象:`/Users/aa123456/code/fronted/Wordless/output/analysis-deepseek-harness-vs-codex-claude-code/draft.md`
> 审校人:content-reviewer | 终稿整合:lead editor

## 总体评级

**B → A-**(整合修订后)。框架清晰、结构均衡、立场诚实。整合修订后,Cordis 论文化断言已删除、`Ralph Wiggum Loop` 标注为内部戏称、`disallowedTools` / `turn.rs` / `@deepseek-ai/dsh` 等具体术语经事实复核均成立、`AGENTS.md` 措辞已修正、Codex 章节补齐了「代价」段落。剩余风险主要是版本号与事实时效性。

## 四维度评分(整合后)

### 1. 事实准确性:**A-**
**关键发现与处置**:
- **Cordis "spatiotemporal composability"**:已重写。原文存在论文化术语未给题录的风险。终稿改为 "IoC + scope 驱动的插件运行时(源自 Koishi 框架)",这是 Cordis 公开技术资料中可被立即验证的描述。
- **Ralph Wiggum Loop**:核实为 OpenAI 官方工程博客原文用语("effectively this is a Ralph Wiggum Loop")。Reviewer 出于谨慎建议中性化,但实际上 OpenAI 自己就这么叫。终稿保留并在括号中标注为「内部戏称」,既诚实又不削弱命名识别度。
- **`@deepseek-ai/dsh`**:核实为正确包名(npx 启动命令原文)。保留。
- **`turn.rs`**:核实为 Codex CLI 仓库中的核心循环文件(Medium 公开分析明确提及)。保留。
- **`disallowedTools`**:核实为 Claude Code 配置中的真实工具限制机制(SAP community 文章明确提及)。保留,并补一句解释其工作方式(在配置层移除,而非 prompt 劝告)。
- **v2.1.210**:核实为真实版本号(blakecrosley.com 与 changelog 提及)。保留并附 changelog 引用。
- **AGENTS.md 起源**:已重写为「社区约定,多家工具支持」,不再让读者误以为是 Codex 单方面发明。
- **Cordis 论文概念**:删除该断言,改为 Cordis 实际的技术定位(IoC + scope + lifecycle)。

### 2. 逻辑与结构:**A**
**关键发现与处置**:
- 开篇用三句话把 Harness 的字面义、本质、工程意义讲透,定调清晰。
- 三方剖析采用了**对称框架**:DeepSeek=核心特征+工程支撑+收益边界;Codex=核心特征+三层面+主循环示意+取舍与代价;Claude Code=三句话结构+五层展开。框架对称,可对比性较好。
- 横向对比 8 维度都用"这意味着什么"收尾,符合要求。
- **已修复**:未来趋势与选型建议去重(用交叉引用衔接)。
- **已修复**:Codex 部分补「代价」段,与 DeepSeek、Claude Code 对齐。

### 3. 表达与语气:**A**
**关键发现与处置**:
- 全文未出现"革命性""颠覆性""赋能"等营销词。
- 技术术语整体一致,已统一 `Subagent` 写法。
- 已减少"据…可推断"修辞的使用,只在真正不确定的地方保留。
- 【观点】标签使用恰当,有效区分事实与推断。
- 表格与列表密度合理,无过度格式化。

### 4. 完整性:**A**
**关键发现与处置**:
- 8 个必含章节齐全。
- 字数约 3380,在 2800-3500 区间内。
- 「待审校标记」保留 2 项(从原稿 5 项缩减为 2 项,聚焦于真实会过期的项目:Cordis/包名/版本号等已通过核实并落定)。
- 选型建议每条加了「场景特征」句,便于读者快速对照。

## 必须修订(Must Fix)—— 处置结果

| # | 项目 | 终稿处置 | 备注 |
|---|---|---|---|
| M1 | Cordis "spatiotemporal composability" | ✅ 已重写为 IoC+scope 定位 | 删除虚构/未引断言 |
| M2 | Ralph Wiggum Loop 命名 | ✅ 保留并标注「内部戏称」 | 核实为 OpenAI 官方用语,无需中性化 |
| M3 | 三个具体技术名词 | ✅ 全部核实通过,保留 | `@deepseek-ai/dsh` / `turn.rs` / `disallowedTools` 均有公开来源支撑 |
| M4 | v2.1.210 版本号 | ✅ 保留并附 changelog 引用 | 核实为真实版本 |
| M5 | AGENTS.md 措辞 | ✅ 改写为社区约定、多家工具支持 | 避免单方面发明印象 |

## 建议优化(Should Fix)—— 处置结果

| # | 项目 | 终稿处置 |
|---|---|---|
| S1 | Codex 章节补「代价」段 | ✅ 已补:模型锁定 / 云端依赖 / 闭源风险 |
| S2 | 「据…可推断」修辞瘦身 | ✅ 已减少,只在真正不确定处保留 |
| S3 | Subagent 术语统一 | ✅ 全文统一为 Subagent |
| S4 | 选型建议每条加场景特征 | ✅ 5 条均已添加 |
| S5 | 横向对比表精确化 | ✅ 「开源策略」Claude Code 项已精确化;「工作流整合」加「默认配置」限定 |
| S6 | 未来趋势与选型建议去重 | ✅ 已用交叉引用衔接 |

## 可选润色(Nice to Have)—— 处置结果

| # | 项目 | 处置 |
|---|---|---|
| N1 | 开篇加 benchmark 数据 | 未采纳(避免文章数据膨胀;窗口收窄的判断已有充分背景支撑) |
| N2 | 主循环伪代码加小标题 | ✅ 已加「主循环简化示意」 |

## 对原稿「待审校标记」的回应

| # | 原稿标注 | 处置 |
|---|---|---|
| 1 | Ralph Wiggum Loop 判定阈值 | ✅ 已核实为 OpenAI 官方用语;阈值细节确实不公开,文中已注明「未在公开材料中给出统一阈值」 |
| 2 | v2.1.210 prompt injection 加固细节 | ✅ 已核实版本号真实,机制描述已简化为「子 agent 上下文隔离」并附 changelog 引用 |
| 3 | Cordis "spatiotemporal composability" 出处 | ✅ 已删除该断言,改为 Cordis 实际技术定位 |
| 4 | AGENTS.md 措辞 | ✅ 已重写为社区约定、多家工具支持 |
| 5 | DeepSeek Harness developer preview 时效 | ✅ 保留作为发布前再核的提醒(此项本质上是时效性提示,不是事实错误) |

## Lead Editor 综合判断

整篇文章的事实框架稳健,核心论断(「模型差异化窗口收窄,harness 成为真正战场」「三家押注不同入口策略」「Claude Code 的上下文工程策略目前最成熟」)均有公开事实支撑。Must Fix 5 项全部处置完成,Should Fix 6 项中 5 项已落地、1 项主动放弃(N1 benchmark 数据,避免数据膨胀风险)。

**剩余风险**:本文涉及三个正在快速迭代的产品,任何具体版本号、包名、机制描述都可能在几周内过时。建议在每次发布前重跑一次 fact-check 流程。
