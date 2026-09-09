# 工具调用分组折叠展示 — 设计方案（v2 简化版）

> 状态：Phase 1 已实施（2025-09-08）。渲染层分组折叠 + live 计时 + 历史消息 timestamp 推导。expert member / subagent 视图复用与搜索联动留待后续。
>
> v2 基于 session `a1a32055` 的数据 spike 简化：真实形态是「单工具 × N 轮连续」（76% 轮次仅 1 个工具调用，24% 为 2 个并行），轮间 9~30 秒间隔几乎全是模型推理（bash 自身 elapsed 仅 0.0~0.1s）。**不需要改任何持久化格式**。

## 1. 现状事实（spike 确认）

- 1 次用户 prompt = 1 个 run = N 条 assistant 消息（每轮 LLM 一条），时间线行 `assistant:turn:{userMessageId}` 持有全部消息（`thread-session-store.ts:37`）。
- 工具块挂在所属轮次消息上；每轮通常 1 个工具，少数 2 个并行。
- assistant / user 消息的 `timestamp` 已随 journal 持久化，`toConversationMessage`（runtime:6560）恢复时可用 → **历史 turn 可直接算挂钟耗时**。
- run 级渲染入口 `AssistantMessageBody`（`ThreadView.tsx:2086`）已持有 run 全部消息；逐消息渲染在 `AssistantMessageBlocks`（1633）；自动展开/收起范式在 `ThinkingBlock`（1453）。
- text 块出现在工具轮中间的比例低（10/74 轮），作为断段信号可接受。

## 2. 设计

### 2.1 分组：连续工具轮 = 一个组

- run 内**连续的工具轮次**（可跨消息边界，可夹杂 reasoning）合并为一个组；遇到非空 `text` 块断组。一个 run 可有多个组。
- 组是折叠 header 的载体；展开后轮次间用细分割线 + 各轮耗时。
- 20 轮工具循环 = 1 行，而不是 20 行。

### 2.2 「x 秒」= 挂钟时间，来源消息 timestamp

| 场景 | 算法 |
| --- | --- |
| 运行中 | 首个工具轮起点（store 已有 `startedAt`）起每秒 tick |
| 历史完成 | `末工具轮 assistant.timestamp − 组起点`；组起点取首个工具轮消息的 `timestamp`（更准可退到 user 消息 ts，补上首轮推理时间） |
| 降级 | timestamp 缺失时只显示「y 个步骤」 |

**不做**：fork `@wordless/ai` 打点、runtime 持久化扩展（原 v1 方案，已确认无必要——工具自身耗时无代表性，挂钟靠消息 ts 即可）。

- 等待审批/追问时：header 切换「等待确认」，秒数冻结。
- y = 组内工具块数（并行轮按渲染单元计数）。

### 2.3 折叠状态机（复用 `ThinkingBlock` 范式）

- 组内有 `running`/`pending` 工具 → 自动展开；
- 全部终态 → 延迟 ~800ms 自动收起；
- 用户手动操作后 latch，自动行为失效；
- 历史加载默认收起；
- 组内出现 `awaiting-approval` / `awaiting-user-input` → 强制展开、禁止收起；
- 组内 error → 收起态 header 显示琥珀 `⚠ n` 徽标。

状态放组件本地，无全局 store。

### 2.4 组件与集成

```
AssistantMessageBody（已有，持有 run 全部消息）
  └─ 渲染循环：先用小函数把消息切分为 [组 | 独立块] 序列
       ├─ ToolActivityGroup（新组件）：header + 展开体（逐块仍走 workbenchRendererRegistry.resolveTool）
       └─ 其余块（text/reasoning/无工具消息）：原路径渲染，零回归
```

- 组构建函数与 `ToolActivityGroup` 放同一个新文件（如 `tool-activity-group.tsx`），不做独立数据模型层。
- 与 `AssistantRunStatus` 分工：组 header 管工具 shimmer；run 底部状态行只管「等模型/重连/压缩」。

### 2.5 视觉

- 沿用现有 tokens：次要文本 `#777770`、绿 `#6c8542`、边框 `#e7e7e2`；数字 `tabular-nums` mono 防跳动。
- header ~32px；收起态 = 一行卡片高度。
- 不做 height 动画（virtuoso 虚拟高度敏感）：条件渲染 + 120ms opacity/translateY，respect `prefers-reduced-motion`；实现时验证 follow 吸底（`thread-viewport-store`）。
- `<button aria-expanded aria-controls>`。

### 2.6 i18n

`toolGroupProcessed`（已处理 {seconds} 秒 · {count} 个步骤）、`toolGroupSteps`（{count} 个步骤）、`toolGroupAwaiting`（等待确认）、`toolGroupErrors`（{count} 个失败）。

## 3. 边界情况

| 情况 | 行为 |
| --- | --- |
| 并行 2 工具轮 | 展开态并列展示，计数按渲染单元 |
| text 夹在工具轮中间 | 断组（text 照常渲染在组外） |
| 审批在组中段 | 强制展开、禁收起；批准后恢复 |
| compaction 行 | 不受影响 |
| 跳转锚点命中收起组内 | 自动展开该组 |
| 搜索 | 工具输出本就 `data-thread-search-exclude`，不变 |

## 4. 实施清单（Phase 1 一次到位）

1. `tool-activity-group.tsx`（新）：组切分函数 + `ToolActivityGroup` 组件（header 状态机 + 折叠体）+ 单测
2. `AssistantMessageBody` 集成组渲染
3. renderer store 在 `tool.completed` 补记 `completedAt`（live 计时收尾，一行改动）
4. i18n 文案

涉及：`ThreadView.tsx`、`thread-session-store.ts`、新文件 1 个、`i18n.ts`。**不改 packages/**。

## 5. 待确认

1. 单工具单轮也折叠？（默认是，保持规则简单）
2. expert member / subagent 视图后续复用同一组组件（Phase 2，本版不动）。
