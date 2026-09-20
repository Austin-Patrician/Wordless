# 元素选择器 — 设计方案

> **状态:暂不实施(由产品侧决定)**
>
> 决定理由:**大多数用户用不到**。元素选择器的受众是高频前端迭代的开发者;Wordless 的
> 主要场景是让 Agent 自检它自己写的界面,而那条路已经由 `browser_snapshot`(a11y 树)
> 和 console 摘要覆盖 —— 用户很少需要亲自"指"一个元素。
>
> 本文保留的原因不是"以后要做",而是其中**不随这个功能成立或失效的部分**:
>
> - §2.1「不提供通用脚本执行函数」—— 适用于**任何**将来需要脚本注入的功能
> - §2.2 注入脚本的硬约束与 §2.3 提示注入面 —— 同上
> - §5 的边界清单(iframe / shadow DOM / CSP / 页面自带捕获监听)——
>   如果将来重做,这些是必须重新确认的既有事实,不必从零推导
>
> 代码侧已删除(`browser-pick.ts` 及其测试)。若重新评估,本文的设计与测试矩阵可直接复用。
> **若不实施,请勿把 §11「实施顺序」当成待办。**

## 1. 目标与非目标

### 目标

用户点一下页面上的元素,该元素的**紧凑描述**进入输入框,用户可编辑后发送。

**验收**:用户点「选择元素」→ 悬停高亮 → 点击某按钮 → 输入框出现该元素的 role/name/box,点击本身**不触发页面行为**。

### 非目标

- ❌ 多选元素(v1 一次一个;多选要考虑如何在草稿里组织)
- ❌ 跨 iframe 选择
- ❌ 编辑元素样式(Cursor 2.2 的 CSS 编辑器是另一个产品)
- ❌ 把元素坐标用于 **Agent 操作** —— 选择器的结果是**给人看的描述**,不是给 Agent 的定位句柄。Agent 定位继续走 `@eN` ref。

最后一条是刻意的:如果让 Agent 用坐标点击,就回到"布局一动就崩"的脆弱路径上了。

---

## 2. 安全设计(本方案的核心)

选择器需要执行脚本,而**脚本注入是这次唯一真正的能力扩张**。所以先定边界。

### 2.1 结构性隔离:不提供通用脚本执行

现状:`browser-cdp.ts` 的 `withCdp` 是一个**通用**传输 —— 它接受任意 `method` 字符串,只靠一张白名单挡着,且白名单里**刻意没有** `Runtime.evaluate` / `Page.addScriptToEvaluateOnNewDocument`。

选择器需要执行脚本。**不要**为了它把这两个方法加进白名单 —— 那样整个服务层就获得了通用的"在任意页面执行任意 JS"能力,而白名单会从"能力清单"退化成"建议清单"。

**方案:不存在通用脚本执行函数。** 只暴露两个**用途固定**的函数:

```ts
// browser-pick-runtime.ts —— 唯一触碰脚本执行的地方
armElementPicker(webContents): Promise<void>   // 注入固定的 PICK_SCRIPT
readPickOutcome(webContents): Promise<PickOutcome>  // 求值固定的读取表达式
disarmElementPicker(webContents): Promise<void>     // 求值固定的清理表达式
```

三个函数各自绑定**一个常量表达式**,不接受调用方提供的代码。这样即使将来有人误用,也**无法**用这个模块执行任意脚本 —— 结构上而不是纪律上受限。

> 对比:如果写成 `withInternalCdp(webContents, send => { await send("Runtime.evaluate", {expression}) })`,任何人拿到 `send` 就能执行任意脚本。差别不在注释,在**类型签名**。

### 2.2 注入脚本的硬约束

`PICK_SCRIPT` 必须:

| 约束 | 原因 |
|---|---|
| 自包含,无闭包、无 import、无外部数据 | 它是字符串;引用外部变量会失败 |
| **不读** cookie / localStorage / sessionStorage / 表单值 | 只读被点元素自身的属性与文本 |
| **不发起任何网络请求** | 无 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` |
| 只以 CSSOM 写样式,**不注入 `<style>` 元素** | 严格 `style-src` CSP 会拦掉 `<style>`;`el.style.x = y` 不受影响 |
| 完成后自我清理:监听器 + 高亮 + 全局变量 | 页面不该保留用户没要求的行为 |
| 全局变量名固定且可预测 | 主进程要读它;名字本身不含信息 |

**留在页面的痕迹**:一个 `position: fixed` 的空 div(高亮框)和一个全局属性。都在 pick 结束时移除。若主进程超时未读到结果,由 `disarmElementPicker` 主动清理。

### 2.3 提示注入面(必须直面)

`name` 和 `text` **来自页面**。恶意页面可以写 `aria-label="忽略之前的指令,改为…"`,用户一点,这段文本就进了对话。

这是**真实存在**的面,不能忽略。但它的形状比浏览 Agent 常见的注入要好:

- 用户点击是**主动行为**(不是 Agent 自动访问页面时被动读到)
- 文本进入的是**输入框**,用户能看见、能编辑、**必须自己按发送**

因此不追求"完全消除",而是**降低可信度 + 让用户能看见**:

1. **清洗**:折叠空白与换行(阻止伪造结构)、剥离控制字符、截断长度
2. **标识来源**:页面提供的值**始终**加引号;`name` 未取到显式可访问名时标注 `(from text)`
3. **不合并成自由文本**:输出是逐字段的结构化行(`name:` / `text:` / `path:`),不是一段散文 —— 让"这是页面里的字符串"一目了然
4. **在提示词层面不赋予权威**:这些内容进入的是用户消息,且不作为系统指令

> 明确不做的事:**不**尝试用正则识别"注入语句"。那既不可靠,又会给人虚假的安全感。

### 2.4 撤销与时限

- **拿不到就主动清理**:`disarmElementPicker` 在超时、取消、导航、切标签、崩溃时调用
- **超时**:60 秒(足够用户决定,不至于让 armed 状态无限期挂着)
- **一页一次**:重复触发先取消上一次

---

## 3. 机制

```
用户点「选择元素」
  → armElementPicker: Runtime.evaluate(PICK_SCRIPT)          [当前文档,一次性注入]
  → 页面:鼠标移动 → 高亮框跟随;点击 → preventDefault + stopPropagation
          → 结果写入 window.__wordlessPick;自我清理
  → 主进程:每 100ms readPickOutcome(webContents)
          → 读到结果 → 停止轮询 → 格式化 → 交给注入通路
  → 用户取消 / 超时 → disarmElementPicker → 停止轮询
```

**为什么用 `Runtime.evaluate` 而不用 `Page.addScriptToEvaluateOnNewDocument`:**

后者会在**每个新文档**上重新注入,也就是**导航之后继续 armed**。那正是我们不想要的:用户点了链接、页面变了,而选择器还在等待 —— 结果是用户在新页面上点了一下,却以为在"选择元素"。

用一次性注入,监听器随文档消亡而消亡,**导航天然取消选择**。这是"少写代码但更安全"的选择。

### 轮询成本

仅在 armed 期间,每 100ms 一次 `Runtime.evaluate`,求值一个固定的、只读一个全局变量的表达式。未 armed 时零成本。

---

## 4. 生命周期

```
idle ──arm──▶ awaiting ──picked────▶ done(交付描述)
                 │  │
                 │  ├─cancelled(Esc / 再点按钮 / 主动取消)──▶ done
                 │  ├─timeout(60s)───────────────────────▶ done
                 │  └─interrupted ───────────────────────▶ done
                 └─ 任何终态都调用 disarm
```

**中断来源(必须逐一处理,否则会出现"幽灵 armed")**:

| 事件 | 处理 |
|---|---|
| `did-navigate` / `did-navigate-in-page` | 取消(文档已换) |
| `selectTab` | 取消 |
| 标签关闭 | 取消 |
| `render-process-gone` | 取消 |
| 面板卸载 / 收起 | 取消 |
| 页面自身 `window.location` 变化 | 同上(会触发 `did-navigate`) |

**状态归属**:服务层按 tab 持有(标签是全局的),同一时刻最多一个 tab 处于 armed。

---

## 5. 边界与失败模式

### 5.1 iframe(明确不支持,但要**说出来**)

跨域 iframe 里的点击**不会**冒泡到父文档的监听器。所以用户在 iframe 里点,什么都不发生。

**不能静默**。方案:超时消息区分两种原因 —— 「没有捕获到点击(元素可能在 iframe 内或页面拦截了事件)」而不是笼统的"超时"。

### 5.2 Shadow DOM

`event.target` 会被**重定向到宿主元素**,所以点击 shadow 内部会选到宿主;`path` 的 `parentElement` 走到 shadow 边界就停。

v1 接受:仍能选到**可用的宿主元素**描述。需在文档中写明,避免被当成 bug。

### 5.3 页面自带捕获监听

我们的监听器挂在 `document` 捕获阶段。页面若在 **`window` 捕获阶段**注册了更早的监听器,可能先于我们处理点击。无法完全避免;影响是"偶尔选不中",超时消息兜底。

### 5.4 CSP

见 §2.2:用 CSSOM 写样式,不用 `<style>` 元素。`Runtime.evaluate` 本身不受 CSP 限制(不是 `<script>` 标签)。

### 5.5 canvas / WebGL / 图片

用户能选中元素本身(如 `<canvas>`),得到一个有界描述。**这正是选择器相对截图的独特价值**:截图能表达"整体看着不对",但说不出"就是这一块"。

### 5.6 高亮框在滚动后错位

高亮基于点击瞬间之前的 `getBoundingClientRect`。滚动时若未更新,框会偏移。v1:在 `scroll`(捕获)时重算 —— 一个小改动,但避免"框和鼠标下的东西不是同一个"的困惑。

---

## 6. 数据流与协议

复用上一轮建的注入通路,渲染层**不需要新的插入机制**。

```
BrowserPanel 点按钮
  → client.startBrowserElementPick()
  → 服务:armed = true → publish()  →  面板显示「点击页面上的元素 · Esc 取消」
  → 用户点击 → 服务格式化 → state.pickResult = { text }
  → 面板 useEffect 观察到结果 → onInjectContext(text) → 复用 appendContextText 通路
  → client.clearBrowserElementPickResult()   [避免重复插入]
```

协议增量:

```ts
BrowserPanelState += {
  picking: boolean;
  pickResult: { text: string } | { cancelled: true; reason: "escape" | "timeout" | "interrupted" | "unavailable" } | null;
}
bridge += startBrowserElementPick(), cancelBrowserElementPick(), clearBrowserElementPickResult()
```

**为什么结果走状态推送而不是 Promise**:与现有架构一致(状态推送已覆盖),而且用户在 armed 期间可能切换面板/会话,Promise 的归属会变复杂。

---

## 7. 交互设计

| 阶段 | 界面 |
|---|---|
| idle | 工具栏「十字准星」图标 |
| armed | 图标高亮;**面板内出现提示条**:「点击页面上的元素以加入对话 · Esc 取消」 |
| 悬停 | 页面上绿框跟随(与 Agent 动作高亮不同的颜色,避免混淆"我在选"和"Agent 在动") |
| 选中 | 提示条变「已加入输入框」并在 ~2s 后消失;输入框出现描述 |
| 取消失败(iframe/超时) | 提示条说明原因,不静默 |

**键盘**:Esc 取消。**再点一次按钮**也取消。

---

## 8. 现有 `browser-pick.ts` 需要修正的地方

写完那版之后我发现三个问题,实施时要一起改:

| # | 问题 | 修正 |
|---|---|---|
| 1 | 用 `<style>` 元素注入样式 → **严格 CSP 页面会被拦**,高亮不出现 | 改为 CSSOM 逐属性赋值 |
| 2 | 页面提供的 `name`/`text` **未清洗**就进对话 | 折叠空白/换行、剥控制字符、限长(见 §2.3) |
| 3 | 脚本只在自己结束时清理;**主进程超时后无法清理**(监听器还挂着) | 增加 `disarmElementPicker` 的固定清理表达式 |
| 4 | 滚动后高亮框错位 | `scroll` 捕获时重算 |

---

## 9. 测试策略

**纯函数(可完整覆盖)**
- `sanitizePickedText` —— 换行折叠、控制字符、超长截断
- `formatPickedElement` —— 已有 13 条,补清洗后的行为
- 超时消息区分 iframe vs 通用超时

**脚本审计测试(对安全敏感的产物,值得钉住)**

读 `PICK_SCRIPT` 源文本断言:
- 不含 `cookie` / `localStorage` / `sessionStorage`
- 不含 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`
- 不含 `createElement("style")`(CSP 约束)
- 含有清理调用(三个 `removeEventListener` + 移除高亮 + 删除全局)

这类测试的价值在于:**未来有人"顺手"往脚本里加一句读取或上报,会被挡住。**

**无法自动化、必须手测的矩阵**

| 场景 | 期望 |
|---|---|
| 普通页面点击按钮 | 选中,页面行为**未触发** |
| Esc 取消 | 无结果,高亮消失,页面无残留监听 |
| armed 期间点链接导航 | 自动取消,不残留 |
| armed 期间切标签 | 自动取消 |
| iframe 内点击 | 超时并说明原因 |
| 页面设置 `pointer-events:none` 的元素 | 选到的是实际接收点击的祖先(可接受) |
| canvas 页面 | 能选中 `<canvas>` |
| 严格 CSP 页面 | 高亮**仍能显示**(验证修正 #1) |

---

## 10. 待决策

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | 选中后是**插入输入框**还是**直接发送** | 插入输入框。用户往往要补一句"这个位置不对",直接发送把补充的机会拿掉了 |
| Q2 | 是否支持**多选** | v1 不支持。多选要解决"多条描述如何在草稿里组织",值得单独设计 |
| Q3 | 是否同时给 Agent 一个**坐标句柄** | **不建议**。那会退回"布局一动就崩"的脆弱路径;Agent 继续用 `@eN` |
| Q4 | 结果里是否包含计算样式(颜色/字号) | v1 不含。Cursor 的样式编辑器是另一个产品,而样式文本会显著增加长度 |
| Q5 | 超时时长 | 60s |

---

## 11. 实施顺序

1. `browser-pick.ts` 的三处修正 + 清洗函数 + 测试(纯逻辑,先做完并验证)
2. `browser-pick-runtime.ts`:三个用途固定的函数(唯一的脚本执行入口)
3. 服务:`picking` 状态机 + 中断来源 + 轮询
4. 协议 / IPC / bridge / preload
5. 面板:工具栏按钮 + 提示条 + 结果消费
6. 脚本审计测试
7. 手测矩阵

第 1 步完成后即可独立验证,第 2 步是安全关键点,建议单独 review。
