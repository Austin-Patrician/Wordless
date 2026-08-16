# DeepSeek Harness vs Codex vs Claude Code:三个 Agent Harness 的架构分野

> 撰稿:content-writer | 审校:content-reviewer | 终稿:lead editor
> 状态:已整合审校修订

## 开篇

当你让 AI 写一段代码时,你以为在和模型对话,实际上你在和模型**外面的整层基础设施**对话。这层基础设施——消息循环、工具注册表、上下文窗口管理、沙箱、权限、UI——业界最近开始用一个词统称它:**Harness**(驾驭具)。它的字面意思是「驾驭模型的框架」,本质是把一个不擅长连续动作与可靠执行的 LLM,包装成能完成多步任务的执行体。

2026 年这件事变得重要,是因为模型层的差异化窗口正在收窄。GPT-5、Claude、DeepSeek、Qwen 在主流 benchmark 上的差距,远小于它们的 harness 在工程体验上的差距。真正决定一款 AI 编程工具好不好用的,已经不是模型本身,而是 prompt 如何被组装、历史如何被截断、工具调用失败后如何重试、子任务上下文如何隔离。理解 harness,等于理解下一代 AI 产品的真正战场。

本文不比较模型,而是比较三个目前最具代表性的 agent harness——DeepSeek Harness、OpenAI Codex、Claude Code——在架构哲学、工程取舍和适用场景上的分野。

## Harness 都包含什么

无论谁实现,一个完整的 agent harness 通常由以下部分组成:

- **模型层(可插拔或固定)**:决定接入哪个 LLM、是否支持 fallback
- **主循环(agent loop / turn loop)**:收集历史 → 调模型 → 处理响应 → 决定下一步
- **上下文工程**:消息如何截断、压缩、摘要、检索
- **工具注册表**:工具如何声明、如何被发现、失败如何重试
- **执行沙箱**:文件、网络、命令的隔离边界
- **权限/审批模型**:哪些操作需要人确认
- **记忆/会话**:跨任务的状态如何持久化
- **UI / 交互层**:CLI、Web、TUI、IDE 插件

三家工具的本质差异,就是这些组件被**谁来实现、以什么形式组合、给谁留出扩展点**。

## DeepSeek Harness:一切皆插件

DeepSeek Harness(包名 `@deepseek-ai/dsh`,据其 GitHub 仓库描述与官方快速开始文档)开源、MIT 协议、Node.js 实现,目前处于 developer preview 状态。它的最大特征是**Everything is a plugin**——模型、工具、技能、会话、沙箱、文件系统、循环、编排、UI 全部是插件。

这背后的工程支撑是 **Cordis**——一个依赖注入(IoC) + 作用域(scope)驱动的插件运行时(源自 Koishi bot 框架,据 The New Stack 与官方仓库说明)。插件可在不同生命周期阶段、不同 scope 内被注册、组合与撤销,组合关系本身可被声明与检查。比起"加载一个 npm 包作为工具",Cordis 让插件可以是任何东西:一个新模型接入、一个新审批流程、一套完全不同的子 agent 拓扑。

这种设计的直接收益有三:

1. **模型无关**:可以同时跑 DeepSeek 自家模型、Qwen、其他开源模型,不需要改 harness 本身。
2. **可替换循环**:觉得默认的 ReAct 循环不够好,可以直接换一个 loop 插件。
3. **agent 产品只是第一个客户**:DeepSeek 团队明确把这套 SDK 设计为可被多个 agent 产品复用的底座(据仓库 README 描述),目标是让第三方 agent 产品基于它构建。

但这条路线也有清晰边界:developer preview 意味着官方明示未来会有兼容性破坏性变更;插件化的代价是初次上手的心智负担更重,文档和示例必须跟上,否则用户面对的就是一个「什么都能改、什么都不知道怎么改」的空壳。

**【观点】** 本质上,DeepSeek Harness 押注的是「harness 应该是开源生态产物」这一未来,而不是「我们家的模型 + harness 体验最好」这一当下。它面向的是要自建 agent 产品的团队,而不是只想要一个顺手 CLI 的个人开发者。

## OpenAI Codex:容器隔离 + 自我评审的工业派

OpenAI 的 Codex 由两部分构成:**开源的 Codex CLI**(Rust 实现,核心循环位于 `turn.rs`,据公开源码分析)+ **闭源的 Codex Cloud sandbox**。Rust 的选择本身就意味着偏向「单二进制、跨平台、低开销」,与 Node.js 系的策略形成对照。

Codex 的工程特征可以从三个层面看。

### 执行隔离:每个任务一个容器

Codex Cloud 的核心做法是——每接一个任务,spin up 一个独立容器,通过进程边界隔离并发(据 OpenAI 官方工程博客)。开发者不需要担心「上一个任务的副作用影响下一个」,也不需要担心「agent 误删了工作目录」。这与本地 CLI 的传统形态完全不同:它假设 agent 跑在云端,而不是开发者的笔记本上。

### 自我评审循环(OpenAI 内部戏称 Ralph Wiggum Loop)

这是 Codex 最有特色的设计之一(据 OpenAI「Harness Engineering」官方博客)。任务不只跑一遍,而是让 agent 反复自我评审 + 迭代,直到预设的若干「评审者」全部满意——OpenAI 在博客中戏称之为「Ralph Wiggum Loop」。这把传统的 CI 多 reviewer 模式搬到了 agent 内部,本质是用 LLM 模拟多个角色做交叉检查。它解决的是「单次 LLM 输出不稳定」这个根本问题——不是让模型一次答对,而是让模型有错就改、改到对为止。具体的「评审者通过条件」未在公开材料中给出统一阈值,通常随任务类型与模型版本而变化。

### AGENTS.md 与 PR 工作流深度整合

`AGENTS.md` 是社区约定的项目规约文件——在仓库根目录放一份 markdown,告诉接入的 agent 项目的构建命令、测试命令、代码风格规约。Codex、Claude Code、Aider、Cursor 等多家工具均支持这一约定(据各工具官方文档)。Codex 在此基础上,把「本地 CLI 执行 → 通过 PR 提交 review」这条主线产品化得最深:agent 写完代码,人类通过 PR review 收口,把 AI 编程嵌进团队既有 GitHub 协作流程。

### 主循环简化示意

Codex CLI 的主循环可以抽象为(基于公开源码抽象):

```
while needs_follow_up:
    1. 收集对话历史
    2. 带上工具发给 LLM
    3. 处理响应:
       - 若有 tool call → 执行,把结果加入历史,继续
       - 若是最终回复 → 退出
```

### 取舍与代价

这套架构的取舍:**用云端容器换取安全边界,用自我评审循环换取单次执行质量,用 AGENTS.md 换取跨工具的可移植规约**。

代价同样清晰:
- **模型锁定**——目前紧密耦合 OpenAI 系列(GPT-5 等),想换模型基本等于换工具
- **云端依赖**——每个任务 spin up 容器,带来网络与启动开销,不适合完全离线场景
- **闭源风险**——Codex Cloud 的隔离与评审逻辑不开放审计,合规场景需自评信任边界

## Claude Code:Hooks + Skills + Subagents 的三层架构

Claude Code 走的是与上面两者都不同的路线——本地终端常驻、模型绑定 Claude、强安全姿态。LogRocket 的公开分析把它总结为三句话(本文借用其结构):

- **Hooks = 确定性安全门**
- **Skills = 领域专长自动激活**
- **Subagents = 隔离分析保护上下文**

逐层展开。

### Hooks(lifecycle events + matcher pattern)

Claude Code 在 agent 生命周期的关键节点(PreToolUse、PostToolUse、Notification 等)暴露 hook,用户可以挂任意命令(据 Claude Code 官方文档)。这意味着「禁止 agent 跑 `rm -rf`」不是写一句 prompt,而是写一段 shell 脚本,在 tool call 真正执行前**确定性**阻断。Hooks 是规则,不是劝告——它解决了「prompt 约束会被模型忽略」这个公认痛点。

### Skills(渐进式披露)

一个 Skill 是一个 markdown 文件(SKILL.md)+ 可选脚本。Claude Code 启动时**只加载**每个 skill 的 name + description,据公开实现约 100 tokens/skill;完整内容在 agent 判断需要时才加载。它直接解决了「skill 库一大就撑爆上下文」的难题——你装 50 个 skill,启动成本还是可控的,因为系统提示里只多了 50 行短描述。

### Subagents(Agent tool)

每个 Subagent 拥有**独立的上下文窗口**,完成后只把最终结论返回给父 agent(据 Claude Code 官方文档)。中间过程——大文件读取、噪声日志、错误堆栈——全部在 Subagent 的上下文里被 GC 掉,不污染主对话。这对「让 agent 调研一个 5000 行的依赖库源码」这种重型任务至关重要:父 agent 永远不会被几十 KB 的原始日志淹没。

### 安全模型:显式同意 + 架构阻断

Claude Code 的核心安全姿态是:任何有副作用的 tool call 都需要用户**显式同意**(据其官方安全文档)。开发者被当作 co-signer,而不是观众。这听起来保守,但配合 `disallowedTools` 这种**结构性阻断**(在配置层就移除某些工具的可用性,而非在 prompt 里写「请勿执行」),它把「agent 误删数据库」这种事从可能变成不可能。

### 抗 prompt injection 加固

自 v2.1.210 起,Claude Code 重点加固了 Agent tool 抗间接 prompt injection 的能力(据官方 changelog 与第三方分析 blakecrosley.com):Subagent 读取到的污染内容被隔离在自己的上下文里,无法回流到主对话诱导敏感 tool call。这是把「上下文隔离」从工程便利升级成「安全边界」——一次升级,两层收益。

## 三方横向对比

下面从八个维度展开,每条都落到「这意味着什么」。

### 1. 开源策略
- DeepSeek Harness:完全 MIT 开源
- Codex:CLI 开源,Cloud sandbox 闭源
- Claude Code:CLI 开源;核心调度/策略层以闭源形式分发,具体边界见官方 LICENSE

**意味着什么**:DeepSeek Harness 在「复用与改造」上最自由;Codex 在「本地透明 + 云端托管」上做了清晰切割;Claude Code 的开源部分适合学习与扩展,但生产能力的核心并不开源。

### 2. 实现语言与部署形态
- DeepSeek Harness:Node.js,适合前端/JS 栈团队复用
- Codex:Rust,适合要单二进制、低资源占用的场景
- Claude Code:TypeScript/Node,与 Claude 模型生态对齐

**意味着什么**:这是工具选择中常被忽略的非功能维度——语言决定了「谁可以接手维护这个工具」「调试栈是否与团队栈一致」。

### 3. 模型耦合
- DeepSeek Harness:**模型无关**
- Codex:**OpenAI 紧耦合**
- Claude Code:**Claude 紧耦合**

**意味着什么**:DeepSeek Harness 的卖点是「换模型不用换 harness」;Codex 和 Claude Code 的卖点是「模型 + harness 联合调优到最佳」。前者适合多模型策略,后者适合单模型最佳体验。

### 4. 执行隔离模型
- DeepSeek Harness:**插件化沙箱**(隔离形式由插件决定)
- Codex:**云端容器**(进程级硬隔离)
- Claude Code:**本地 + 显式同意**(逻辑层软隔离)

**意味着什么**:Codex 最适合「我不在乎 agent 跑哪,只要它别动我的机器」;Claude Code 最适合「我想看着 agent 一步步做,有完全控制感」;DeepSeek Harness 最灵活,但「默认安全边界」需要用户自己拼装。

### 5. 多 agent 模式
- DeepSeek Harness:**编排本身就是插件**,可任意拓扑
- Codex:自我评审循环 + 多 reviewer——**单 agent 内部的多视角**
- Claude Code:显式 **Agent tool(Subagent)**,父子隔离清晰

**意味着什么**:DeepSeek Harness 适合「我的多 agent 系统长什么样我自己说了算」;Claude Code 适合「我需要清晰的父子边界」;Codex 适合「任务评估比任务执行更难」的场景。

### 6. 上下文工程策略
- DeepSeek Harness:**可替换**(默认行为由插件决定)
- Codex:截断 + 压缩(关键难点,据 OpenAI 工程博客)
- Claude Code:**Subagent 隔离 + Skill 渐进披露**(两层组合)

**意味着什么**:这是 agent harness 当前最棘手的工程问题。Claude Code 的「两层组合」目前看起来是更成熟的解——既不让上下文爆掉,也不让关键信息丢失。DeepSeek Harness 把这层交给插件做,适合有定制能力的团队。

### 7. 安全模型
- DeepSeek Harness:**插件可控**(由用户组合)
- Codex:**云端隔离**(默认安全)
- Claude Code:**显式同意 + 架构阻断**(双保险)

**意味着什么**:合规要求高的场景,Codex 和 Claude Code 的默认姿态更友好;深度自定义场景,DeepSeek Harness 给了空间但也给了责任。

### 8. 工作流整合(默认配置)
- DeepSeek Harness:通过插件可接入任意工作流
- Codex:深度整合 **GitHub PR + AGENTS.md**(社区约定)
- Claude Code:支持 **AGENTS.md**(社区约定),CLI 友好

**意味着什么**:Codex 把「AI 写代码 → 人类 review → 合并」这条主线产品化得最深;Claude Code 在 IDE/终端场景里更轻;DeepSeek Harness 把这条选择权交还给集成方。

## 选型建议【观点】

以下建议基于上述架构差异,是分析者的判断,不是事实。

### 个人开发者 / 快速试用 — 场景特征:一人小队、单台机器、上手时间 < 1 小时
推荐 **Claude Code** 或 **Codex CLI**。两者 CLI 体验成熟,上手成本低,有 AGENTS.md 约定可以立刻把项目规约灌进去。Claude Code 适合想保留人类审批感的场景;Codex CLI 适合愿意把任务丢给云端执行的场景。

### 企业内私有部署 / 自定义执行环境 — 场景特征:数据不出内网、需审计、需自定义审批链
推荐 **DeepSeek Harness**。MIT 协议 + 模型无关 + 插件化意味着可以完全控制网络出口、数据流向、审计日志;代价是要自己组装一套默认插件链,并承担 developer preview 的不稳定性。

### 以开源模型为主 — 场景特征:多模型策略、成本敏感、避免供应商锁定
强烈推荐 **DeepSeek Harness**。这是当前少数明确「open models first」的 harness,换 Qwen、Llama、DeepSeek 自家模型都不需要改 harness 逻辑。

### 安全合规要求高 — 场景特征:金融/医疗/政企、有审计与合规约束
推荐 **Claude Code**(本地可控 + 架构阻断)或 **Codex Cloud**(默认云端隔离,数据不出容器)。前者适合数据不能离本地的场景;后者适合愿意把任务交给隔离容器的场景。

### 多 agent 协作复杂场景 — 场景特征:多角色流水线、子任务状态共享、跨工具编排
**DeepSeek Harness** 拓扑最自由,**Claude Code** 的显式 Agent tool 边界最清晰,**Codex** 的自我评审循环在「单 agent 内多 reviewer」这个特定子场景上最强。复杂多 agent 拓扑,我的偏好是 DeepSeek Harness;如果任务边界清晰、子任务间不需要复杂状态共享,Claude Code 更稳。

各家押注的具体路径,详见下节。

## 未来趋势

上节已给出按场景的选型建议,本节从行业演进视角补充押注路径的差异化。三家正在**收敛到相似模式**:主循环 + 上下文管理 + 工具注册表 + 审批门控,已经成为事实上的 agent harness 标准组件。差异正在入口策略上:**DeepSeek Harness 用开源生态卡位**——让第三方 agent 产品基于它构建;**Codex 用云端托管 + GitHub 工作流卡位**——把 AI 编程嵌进团队既有流程;**Claude Code 用本地体验 + 安全姿态卡位**——把 AI 编程变成开发者的桌面工具。

下一个两年的关键变量不是「谁的循环更好」,而是「谁的扩展生态更厚」——插件、Skill、AGENTS.md 仓库的累积速度,会决定谁是下一代 agent harness 的事实标准。

## 待审校标记(发布前再核)

1. **DeepSeek Harness 当前主版本与 API 稳定性**:developer preview 阶段意味着快速迭代,本文写作时的事实可能在几周后过时,建议发布前再次核对仓库状态与最新 release notes。
2. **Codex Cloud 容器隔离的当前形态**:模型与功能迭代频繁,「每任务一个容器」的具体实现细节可能在 OpenAI 内部版本间变化,建议发布前核对 OpenAI 官方博客最新表述。
