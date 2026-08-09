<div align="center">
  <p><a href="README.md">English</a> · <strong>简体中文</strong></p>
  <img src="docs/assets/desktop/wordless-logo.webp" alt="Wordless" width="112" />
  <h1>Wordless</h1>
  <p><strong>少说废话，把工作做完。</strong></p>
  <p>一个面向真实需求的本地优先 Agent 平台：精确使用上下文，减少无效往返和 Token 消耗，交付可编辑、可验证的结果。</p>

  <p>
    <a href="https://github.com/Austin-Patrician/Wordless/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/Austin-Patrician/Wordless?display_name=tag&style=flat-square" /></a>
    <a href="https://github.com/Austin-Patrician/Wordless/actions/workflows/release-desktop.yml"><img alt="Desktop Release" src="https://img.shields.io/github/actions/workflow/status/Austin-Patrician/Wordless/release-desktop.yml?label=desktop%20release&style=flat-square" /></a>
    <img alt="macOS 13+" src="https://img.shields.io/badge/macOS-13%2B-111111?style=flat-square&logo=apple" />
    <img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-0078D4?style=flat-square&logo=windows11" />
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-source--available-5b6758?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://github.com/Austin-Patrician/Wordless/releases/latest"><strong>下载最新版</strong></a>
    ·
    <a href="apps/website/src/content/docs/docs/index.mdx">用户手册</a>
    ·
    <a href="docs/architecture/overview.md">架构说明</a>
    ·
    <a href="https://github.com/Austin-Patrician/Wordless/issues">问题反馈</a>
  </p>
</div>

![Wordless desktop workspace](docs/assets/desktop/wordless-workspace.webp)

## Wordless 是什么

Wordless 不是一个只返回文本的聊天窗口。它是运行在 macOS 和 Windows 上的 Agent 工作台：你选择工作区、模型和任务模式，Agent 在明确的权限边界内读取上下文、调用工具，并将演示文稿、电子表格、研究结果或代码变更呈现在同一个界面中。

项目采用本地优先设计。工作区、会话和产物保存在设备上；Google 登录与云同步均为可选能力，未登录或网络不可用不会阻止本地工作。

## 为什么做 Wordless

多数 AI 产品首先优化的是“给出回答”，但真实工作需要更严格的闭环：只理解相关上下文，执行正确操作，留下可以继续使用的产物，并验证实际发生了什么。Wordless 围绕结果设计，而不是围绕更长的对话设计。

- **结果优先于过程播报**：执行状态交给界面呈现，模型把输出留给决策、结果和异常，而不是反复描述“正在做什么”。
- **精确上下文优先于全量灌入**：通过 `@` 引用、表格选区、幻灯片对象和工作 Profile，把输入限制在当前任务真正需要的范围。
- **让 Token 用在有效工作上**：按场景加载工具、进行上下文压缩并展示 Provider 缓存统计，减少重复和无关上下文。
- **端到端交付**：计划、工具执行、产物生成、检查与修正保持在同一任务中，不停留在文字建议。
- **先验证，再宣称完成**：测试、质量扫描、来源、Diff、工具结果和交互预览让结果可以被检查。

> [!NOTE]
> “减少 Token”是设计目标，不是固定节省比例。实际消耗取决于模型、Provider、任务、所选上下文和修正轮次。“把工作做完”指减少本可避免的交接与往返，而不是假设每个复杂任务都能在一次模型调用中正确完成。

## 为什么选择 Pi Agent Harness

Wordless 使用 MIT License 发布的 [Pi Agent Harness](https://github.com/earendil-works/pi) 作为 Agent 底座，而不是重新编写通用模型与工具循环。Pi 提供可移植的基础能力，Wordless 负责将其变成针对具体场景的桌面工作流。

| 产品需求 | Pi 提供的基础 | Wordless 的适配层 |
| --- | --- | --- |
| 多模型 Provider | 统一流式接口和模型能力数据 | 可视化 Provider 配置、思考深度、凭据存储和用量展示 |
| 多步骤执行 | Agent loop、结构化工具调用、事件和状态 | 审批检查点、风险处理、工具状态、持久化和恢复 |
| 不同工作场景 | 可组合工具和与 UI 解耦的 Core | Profile、Driver、Extension、专用 Capability 和产物工作台 |
| 长任务上下文 | 可继续的消息与 Agent 状态 | 会话 journal、搜索、上下文压缩、steering 和 follow-up |

```text
任务意图
    -> Profile
    -> Driver + Extensions
    -> Pi 派生 Agent loop
    -> Capabilities 与工作区策略
    -> 可交互产物工作台
```

共享同一个 loop，不等于所有任务使用一个泛化 Agent。每个 Profile 都会明确改变上下文、工具、权限声明、执行指导、产物类型和验证界面：

| Profile | 场景适配 |
| --- | --- |
| General | 日常工作、Skills、MCP 和可选工作区工具 |
| Coding | 索引搜索、文件编辑、Shell、测试、Diff 和代码工作区策略 |
| Presentation | OfficeCLI 幻灯片工具、质量扫描和可交互 PPTX 预览 |
| Spreadsheet | 工作簿选区、公式、图表、质量检查和发布流程 |
| Data Analysis | 数据检查、研究确认、维度委派、来源和报告 |

这种分层也让 Pi 保持可替换：Provider 协议位于 `@wordless/ai`，loop 与事件位于 `@wordless/agent`，具体 Runtime 集成通过 Driver SDK 完成。升级 Pi 或引入另一套 Driver 时，应当修改适配器和事件映射，而不是重写所有 Composer、审批、存储和产物界面。

## Wordless 与腾讯 WorkBuddy

Wordless 与腾讯 WorkBuddy 都希望超越聊天并交付真实工作，但选择了不同的产品路线。以下对比依据 2026 年 8 月可见的腾讯 [WorkBuddy 产品页](https://cloud.tencent.com/product/workbuddy) 与[官方概览](https://www.workbuddy.cn/docs/workbuddy/Overview)；能力和商业方案后续可能变化。

| 维度 | Wordless | 腾讯 WorkBuddy |
| --- | --- | --- |
| 产品路线 | 本地优先、源码可见，面向希望控制模型、工具、权限和扩展方式的用户 | 面向广泛职场角色、强调开箱即用与托管体验的商业办公 Agent |
| 场景组织 | 仓库内可见的 Profile、Driver、Extension、Skills 和 MCP 集成 | 领域专家、Skills、项目空间和多 Agent 协同 |
| 模型与成本 | 用户自带 Provider 与 API Key，消耗由所选模型提供商计费 | 腾讯运营的产品与 Token 配额方案，并在产品体验中提供模型配置 |
| 数据与执行 | 会话和产物默认留在本地，工具执行受工作区策略与显式审批控制 | 可以操作用户授权的本地目录，账号、服务和团队边界由腾讯产品体系管理 |
| 产物体验 | PPT 和 Spreadsheet 提供专用应用内预览，可选择具体对象或区域并从精确上下文继续修改 | 覆盖文档、表格、PPT、研究、代码和创意等广泛任务与可验收结果交付 |
| 协作与生态 | 当前以个人、本地工作流为主，提供可选设置同步与开发者可控扩展 | 提供项目空间、共享专家、Skills、连接器、团队复用和腾讯生态 |
| 透明度与定制 | 源码可见、BYOK、事件与权限边界明确，适配器可以替换 | 托管式产品，并提供规模更大的预置专家和服务生态 |

如果你需要成熟、开箱即用的办公和团队生态，以及大量托管专家，WorkBuddy 更合适；如果你更看重本地优先、BYOK、显式审批、源码可见和深度工作流定制，Wordless 的路线更合适。这是产品优先级的区别，不是声称某一个工具对所有用户都更好。

## 核心能力

- **工作区上下文**：通过 `@` 快速引用工作区内的文件和文件夹，通过 `$` 选择 Skills；文件索引遵循 `.gitignore`。
- **可控工具执行**：默认手动审批工具调用，也可在当前会话启用自动审批；高风险操作仍会回到人工确认，并支持单次工作区外访问授权。
- **交互式 Presentation**：Agent 创建和修改幻灯片后，可在右侧工作区查看页面、选择对象并继续迭代，而不只是下载一次性文件。
- **交互式 Spreadsheet**：直接查看单元格、图表和变更，在当前选区继续发出指令并即时验证结果。
- **Data Analysis 与深度研究**：拆分研究维度、并行委派、追踪进度，并将分析结果与图表放回工作区。
- **Coding 工作流**：结合计划、文件检索、Shell、差异视图和测试结果完成可审阅的代码修改。
- **模型与思考深度**：支持内置及 OpenAI-compatible Provider，自定义 Base URL、模型能力、上下文限制与推理级别。
- **Skills & MCP**：导入 Skills，并连接兼容 Model Context Protocol 的外部工具服务。
- **会话体验**：消息搜索与定位、上下文压缩、Markdown/GFM、代码高亮、Mermaid 与 KaTeX 数学公式渲染。

## 为真实产物设计

### Presentation

生成过程、工具状态和幻灯片预览保持在同一个任务上下文中。选择具体页面或对象后可以继续要求 Agent 调整布局、内容和视觉表达。

![Interactive presentation workspace](docs/assets/desktop/presentation-preview.png)

### Spreadsheet

在表格预览中选择数据区域，把当前选择作为下一步操作的精确上下文；Agent 的修改会立即反映到工作簿，而不是停留在文字建议中。

![Interactive spreadsheet selection](docs/assets/desktop/spreadsheet-selection.png)

### Data Analysis

复杂研究任务可以按维度委派，并在时间线中区分 queued、running、completed 和 failed 状态，方便判断每个研究员正在处理什么。

![Parallel data analysis research](docs/assets/desktop/data-analysis-research.png)

### Coding

从计划到文件修改、Diff 和测试结果都可追踪。工具执行受工作区策略约束，关键操作在实际发生前进入审批流程。

![Coding plan, diff, and tests](docs/assets/desktop/code-plan-diff-tests.png)

## 扩展与控制

Skills 用于沉淀可复用工作方法，MCP 用于连接外部能力。模型能力和工具权限彼此独立：模型能生成请求，不代表工具已获得执行权限。

![Skills and MCP settings](docs/assets/desktop/skills-and-mcp.png)

API Key、OAuth token 等敏感凭据优先进入操作系统安全存储。Google 云同步默认关闭；开启后仅同步设置页面声明的数据类型，不同步 API Key、工作区文件、生成产物和会话正文。

![Security and privacy settings](docs/assets/desktop/security-privacy.png)

## 架构

Wordless 是一个模块化单体桌面应用，不依赖单独的本地 HTTP 后端。React Renderer 通过受限 Preload Bridge 与 Electron Main 通信；主进程组合 Runtime、Agent Profiles、Capabilities、持久化和平台适配器。

![Wordless desktop architecture](docs/assets/desktop/desktop-architecture.png)

```text
React Renderer
    | validated commands and ordered events
Preload Bridge
    |
Electron Main
    |-- Wordless Runtime
    |     |-- Agent Harness -> AI Provider
    |     |-- Profile Registry -> Profile -> Capabilities
    |     `-- Workspace policy and persistence ports
    |-- JSONL / SQLite adapters
    |-- Node and Office execution adapters
    `-- Credential, window, browser, and notification adapters
```

不同场景不是复制出来的多套 Agent。Profile 负责组装提示、工具、驱动和扩展，公共 Runtime 负责会话、事件、审批和持久化，因此场景能力可以独立演进，也可以迁移或替换底层依赖。

### 内核边界与可迁移性

前文的 Profile 场景映射通过明确的依赖边界实现：`@wordless/ai` 隔离 Provider 协议和模型能力，`@wordless/agent` 隔离 loop 与事件类型，`agent-driver-sdk` 定义 Runtime 与具体内核之间的合同。Profile 不直接依赖 Electron，会话 journal 与领域消息继续由 Wordless 自己管理。

| Profile 组装与驱动注册 | 不同场景的工具边界 |
| --- | --- |
| ![Profile, driver, and registry architecture](docs/assets/desktop/profile-driver-registry.png) | ![Profile tool comparison](docs/assets/desktop/profile-tool-comparison.png) |

Pi 上游能力继续按照原始 MIT License 保留归属。更详细的边界说明见 [Architecture Overview](docs/architecture/overview.md)、[Dependency Rules](docs/architecture/dependencies.md) 和 [Upstream Source Record](UPSTREAM.md)。

## 安装

从 [GitHub Releases](https://github.com/Austin-Patrician/Wordless/releases/latest) 下载与你设备匹配的安装包：

| 设备 | 安装文件 | 说明 |
| --- | --- | --- |
| Apple Silicon Mac（M1/M2/M3/M4 及后续） | `Wordless-<version>-mac-arm64.dmg` | macOS 13 或更高版本 |
| Intel Mac | `Wordless-<version>-mac-x64.dmg` | macOS 13 或更高版本 |
| Windows 10/11 x64 | `Wordless-<version>-win-x64.exe` | NSIS 安装程序 |

`.zip`、`.blockmap`、`latest.yml` 和 `latest-mac.yml` 主要供更新流程使用，正常安装请选择 `.dmg` 或 `.exe`。

> [!IMPORTANT]
> 当前 macOS Release 是未使用 Apple Developer ID 公证的测试构建。请只从本仓库的官方 Release 下载；首次打开时可能需要在 Finder 中按住 Control 点击 Wordless 并选择“打开”，或前往“系统设置 → 隐私与安全性 → 仍要打开”。不要全局关闭 Gatekeeper。

应用会提示可用的新版本，但不会强制安装。受 macOS 未签名构建的代码签名限制，部分版本需要按照应用内链接下载 DMG 并手动覆盖安装。

## 模型配置

Wordless 不捆绑模型额度。首次任务前，在 **Settings → Models** 中配置一个可用的 Provider：

1. 选择内置 Provider，或创建自定义 Provider。
2. 输入 API Key；密钥与普通模型 JSON 分开保存。
3. 对于 OpenAI-compatible 服务，填写通常以 `/v1` 结尾的 Base URL、实际 Model ID 和对应协议。
4. 在 **Enabled models** 中启用模型，然后回到 Composer 选择它。
5. 如果模型声明了推理能力，可在当前模型的二级选项中选择思考深度；未手动设置时默认使用 `medium`。

![Model and thinking-depth selector](docs/assets/desktop/model-thinking-depth.png)

完整字段、JSON 示例与故障排查见[自定义模型配置手册](apps/website/src/content/docs/docs/models.mdx)。请始终依据提供商文档填写上下文窗口、最大输出和推理参数。

## 本地开发

### 环境要求

- Node.js `22.19.0` 或更高版本
- npm（随兼容 Node.js 版本提供）
- macOS 13+ 或 Windows 10/11 x64，用于运行对应桌面构建

### 启动桌面端

```bash
git clone https://github.com/Austin-Patrician/Wordless.git
cd Wordless
npm ci
npm run dev:electron --workspace=@wordless/desktop
```

桌面开发命令会准备匹配当前平台的 OfficeCLI 资源、构建 Electron 主进程，并启动 Renderer 与 Electron。

### 常用命令

```bash
# 全仓库类型检查与静态检查
npm run check

# Desktop 主进程测试
npm run test:host --workspace=@wordless/desktop

# 构建 Desktop（不生成安装包）
npm run build:desktop --workspace=@wordless/desktop

# 检查并构建 Website 与用户手册
npm run build --workspace=@wordless/website
```

打包命令：

```bash
npm run dist:mac --workspace=@wordless/desktop
npm run dist:win --workspace=@wordless/desktop
```

## Monorepo

```text
apps/
  desktop/                         Electron 主进程、Preload 与 React Renderer
  website/                         Astro 官网与 Starlight 双语用户手册
packages/
  ai, agent/                       基于 Pi 的内部 fork
  runtime, protocol, persistence/  会话编排、IPC 契约与本地持久化
  agent-driver-*/                  General、Coding、Presentation、Spreadsheet 驱动
  agent-extension-*/               压缩、计划、运行时与 Subagent 扩展
  capabilities/                    文件、Shell、Office、数据、浏览器等能力
  profiles/                        内置场景 Profile
  model-config, skill-registry/    模型配置与 Skills 注册
  workspace-search/                工作区文件搜索与忽略规则
  ui-kit/                          Renderer 共享状态与 UI 原语
docs/                              架构文档与 README 资产
third_party/                       随发行版保留的第三方许可材料
```

`apps/website` 是独立构建和部署的静态站点，不会被打包进 Desktop 安装包。

## 数据与隐私

- 工作区文件、会话和产物默认保存在本地。
- 模型请求会发送到用户选择的模型提供商；发送范围取决于任务和显式引用的上下文。
- 工具在 Electron 主进程或用户配置的 MCP 服务中执行，Renderer 不直接获得 Node.js 权限。
- Google 登录是可选项；Google Cloud Sync 需要用户单独开启，网络失败不会阻断本地功能。
- 云同步当前面向模型元数据和用户偏好，不包含 API Key、会话正文、工作区文件和生成产物。

安全边界和数据流向详见 [Security & Privacy](apps/website/src/content/docs/docs/security-privacy.mdx)。安全问题请避免在公开 Issue 中附带 API Key、OAuth token、私有文件或完整日志中的敏感数据。

## 第三方项目

Wordless 建立在多个优秀项目之上，并保留其原始许可证与归属：

- [Pi Agent Harness](https://github.com/earendil-works/pi)：`packages/ai` 与 `packages/agent` 的上游来源，详见 [UPSTREAM.md](UPSTREAM.md)。
- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)：Presentation 与 Office 文档操作引擎。
- [Electron](https://github.com/electron/electron)、[React](https://github.com/facebook/react) 与 [Vite](https://github.com/vitejs/vite)：桌面与前端基础设施。
- [React Virtuoso](https://github.com/petyosi/react-virtuoso)：长会话虚拟列表。
- [Astro](https://github.com/withastro/astro) 与 [Starlight](https://github.com/withastro/starlight)：官网和用户手册。
- [Three.js](https://github.com/mrdoob/three.js)：Website 的 3D 视觉体验。

第三方组件不受 Wordless 自定义许可证重新授权；它们继续遵循各自仓库或随附文件中的许可证。

## 参与贡献

欢迎通过 [Issues](https://github.com/Austin-Patrician/Wordless/issues) 提交可复现的问题、功能建议和文档反馈，也欢迎发起 Pull Request。提交代码前请运行与你改动范围对应的检查和测试，并避免提交密钥、个人数据、构建产物或工作区内容。

## 许可证与商业授权

Wordless 原创代码和资产使用 [Wordless Source-Available License 1.0](LICENSE)。个人、教育、研究、评估及非商业内部使用可以免费进行；任何商业使用、收费服务、SaaS、转售、商业托管或与营收相关的分发，都必须事先获得书面授权。

这是一份**源码可见许可证，而不是 OSI 定义的开源许可证**。需要商业授权时，请通过本仓库的 [GitHub Issues](https://github.com/Austin-Patrician/Wordless/issues) 联系维护者，并避免在 Issue 中披露商业机密。第三方与上游代码仍适用其原始许可证。

## Star History

<a href="https://www.star-history.com/#Austin-Patrician/Wordless&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Austin-Patrician/Wordless&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Austin-Patrician/Wordless&amp;type=Date" />
    <img alt="Wordless GitHub star history chart" src="https://api.star-history.com/svg?repos=Austin-Patrician/Wordless&amp;type=Date" />
  </picture>
</a>

## 社区与支持

<table>
  <tr>
    <td align="center" width="50%">
      <a href="https://qr.wordless.20250230.xyz/wechat-group.png">
        <img src="https://qr.wordless.20250230.xyz/wechat-group.png" alt="Scan with WeChat to join the Wordless community" width="180" />
      </a>
      <br />
      <strong>加入 Wordless 微信群</strong>
      <br />
      <sub>交流使用体验、问题反馈与 Agent 工作流</sub>
    </td>
    <td align="center" width="50%">
      <a href="https://qr.wordless.20250230.xyz/buy-me-coffee.png">
        <img src="https://qr.wordless.20250230.xyz/buy-me-coffee.png" alt="Buy me a coffee" width="180" />
      </a>
      <br />
      <strong>Buy Me a Coffee</strong>
      <br />
      <sub>支持 Wordless 持续开发与维护</sub>
    </td>
  </tr>
</table>

---

最后，感谢 LinuxDo 社区所有朋友的支持！欢迎加入 [https://linux.do/](https://linux.do/) 交流技术、前沿 AI 信息与使用体验。
