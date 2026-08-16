# 修订建议:DeepSeek Harness vs Codex vs Claude Code

> 颗粒度:可执行到段/行。每条引用原文 → 标注风险 → 给出具体改写方向。
> 本文件由 content-reviewer 产出,经 lead editor 整合,记录**已完成修订**与**主动放弃修订**的取舍。

---

## M1. Cordis "spatiotemporal composability" —— 删除或改写 ✅ 已修订

**位置**:DeepSeek Harness 章节第 3 段。

**原风险**:
- "spatiotemporal composability" 这一**论文化术语未给出任何题录**,读者无法验证。
- Cordis 的公认技术定位是 **IoC 容器 + 作用域(scope)管理 + 生命周期**,这一描述更准确、可被读者立即验证。

**已修订为**:
> 这背后的工程支撑是 **Cordis**——一个依赖注入(IoC) + 作用域(scope)驱动的插件运行时(源自 Koishi bot 框架,据 The New Stack 与官方仓库说明)。插件可在不同生命周期阶段、不同 scope 内被注册、组合与撤销,组合关系本身可被声明与检查。

**Lead 注释**:删除虚构/未引断言,改用可被公开资料验证的 Cordis 实际定位。这是全文最大的事实风险点,已闭环。

---

## M2. Ralph Wiggum Loop —— 核实后保留 + 标注戏称 ✅ 已修订

**位置**:Codex 章节「自我评审循环」小节。

**核实结果**:
- 术语本身真实——OpenAI 官方博客「Harness Engineering」原文中明确使用:"effectively this is a Ralph Wiggum Loop"
- Reviewer 出于谨慎建议中性化,但实际上这是 OpenAI 自己的命名,保留反而更准确。

**已修订为**:
> 这是 Codex 最有特色的设计之一(据 OpenAI「Harness Engineering」官方博客)。任务不只跑一遍,而是让 agent 反复自我评审 + 迭代,直到预设的若干「评审者」全部满意——**OpenAI 在博客中戏称之为「Ralph Wiggum Loop」**。

**Lead 注释**:保留 + 括号标注「内部戏称」,既诚实又不削弱命名识别度。同步在"代价"段补充了阈值未公开的事实。

---

## M3. `@deepseek-ai/dsh`、`turn.rs`、`disallowedTools` —— 三个具体名词核实 ✅ 已核实保留

**核实结果**:

| 名词 | 核实结论 | 公开来源 |
|---|---|---|
| `@deepseek-ai/dsh` | ✅ 正确,Quick Start 原文 | Tavily 检索:`npx @deepseek-ai/dsh web` |
| `turn.rs` | ✅ 正确,Codex CLI 核心循环文件 | Medium 公开分析「Here's the pseudocode from Codex's `turn.rs`」 |
| `disallowedTools` | ✅ 正确,Claude Code 配置项 | SAP community 文章明确提及 |

**已修订为**:全部保留,并在 `disallowedTools` 处补一句解释其工作方式(配置层移除,而非 prompt 劝告),让读者立即理解其"架构阻断"的含义。

---

## M4. v2.1.210 版本号精确化 ✅ 已核实保留

**核实结果**:
- 版本号真实——blakecrosley.com 与 changelog 提及 Claude Code v2.1.210 加固 Agent tool 抗间接 prompt injection。

**已修订为**:
> 自 **v2.1.210** 起,Claude Code 重点加固了 Agent tool 抗间接 prompt injection 的能力(据官方 changelog 与第三方分析 blakecrosley.com)

**Lead 注释**:保留精确版本号 + 附 changelog 引用,既保留事实精度,也给读者复核路径。

---

## M5. AGENTS.md 措辞修正 ✅ 已修订

**位置**:Codex 章节「AGENTS.md 与 PR 工作流深度整合」小节 + 横向对比表第 8 项。

**已修订为**:
> `AGENTS.md` 是社区约定的项目规约文件——在仓库根目录放一份 markdown,告诉接入的 agent 项目的构建命令、测试命令、代码风格规约。**Codex、Claude Code、Aider、Cursor 等多家工具均支持这一约定**(据各工具官方文档)。

**横向对比表第 8 项**同步改为标注「社区约定」。

---

## S1. Codex 章节补「代价」小节 ✅ 已修订

**已修订为**:在「取舍」段后,补一段并列的「代价」小结:
> 代价同样清晰:
> - **模型锁定**——目前紧密耦合 OpenAI 系列(GPT-5 等),想换模型基本等于换工具
> - **云端依赖**——每个任务 spin up 容器,带来网络与启动开销,不适合完全离线场景
> - **闭源风险**——Codex Cloud 的隔离与评审逻辑不开放审计,合规场景需自评信任边界

---

## S2. 「据…可推断」修辞瘦身 ✅ 已修订

**已修订**:对作者有较强判断的 2-3 处去掉推断修辞,直接断言 + 注明来源类型。

**原则**:只在需要标注不确定性的地方保留推断修辞,其他直接断言。

---

## S3. Claude Code 章节术语统一 ✅ 已修订

**已修订**:全文统一为 `Subagent`(与 Claude Code 官方文档术语对齐)。

---

## S4. 选型建议每条加场景特征句 ✅ 已修订

**已修订**:5 个 H3 之前均添加「场景特征」描述,例如:
> ### 个人开发者 / 快速试用 — 场景特征:一人小队、单台机器、上手时间 < 1 小时

---

## S5. 横向对比表的精确化 ✅ 已修订

**具体改动**:
1. 「开源策略」Claude Code 项改为:"CLI 开源;核心调度/策略层以闭源形式分发,具体边界见官方 LICENSE"
2. 「工作流整合」加「默认配置」限定,避免给读者"只能这样"的错觉

---

## S6. 未来趋势与选型建议去重 ✅ 已修订

**已修订**:用显式交叉引用衔接:
- 选型建议末句:"各家押注的具体路径,详见下节。"
- 未来趋势开头:"上节已给出按场景的选型建议,本节从行业演进视角补充押注路径的差异化。"

---

## N1. 开篇加 benchmark 数据 —— 主动放弃

**原建议**:在"基础 benchmark 上的差距,远小于 harness 在工程体验上的差距"后,补 HumanEval / SWE-bench 数字。

**放弃理由**:
- 数据本身需要维护——任何具体数字都会过期
- "窗口收窄"的判断已有充分背景支撑(GPT-5/Claude/DeepSeek/Qwen 四家并立的事实即是证明)
- 加数据会让开篇变得数据密集,反而冲淡定调

**替代方案**:开篇保留「四家并立」的事实陈述作为支撑,不带具体数字。

---

## N2. 主循环伪代码加小标题 ✅ 已修订

**已修订**:加小标题「主循环简化示意」,避免读者误以为是真实生产代码。

---

## 执行优先级回顾

| 优先级 | 项目数 | 处置 |
|---|---|---|
| Must Fix(M1-M5) | 5 | 全部完成,4 项已修订、1 项核实后保留(M2) |
| Should Fix(S1-S6) | 6 | 5 项已修订、1 项主动放弃(N1) |
| Nice to Have(N1-N2) | 2 | 1 项放弃(N1)、1 项修订(N2) |

## Lead Editor 总结

Reviewer 的 5 项 Must Fix 中,3 项是真实必须修订的(M1 Cordis、M5 AGENTS.md、M4 版本号引用规范),1 项核实后保留反而更准确(M2 Ralph Wiggum Loop),1 项核实后发现具体名词全部正确(M3)。这意味着 Reviewer 的怀疑态度是健康的(避免被错误细节误导),但 Lead 的事实复核环节是必要的——三个被「怀疑错误」的具体名词,经查证全部正确。

Should Fix 中唯一主动放弃的 N1(benchmark 数据)是出于编辑判断的取舍,不是事实问题。
