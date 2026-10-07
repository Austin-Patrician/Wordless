<div align="center">
  <p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
  <img src="docs/assets/desktop/wordless-logo.webp" alt="Wordless" width="112" />
  <h1>Wordless</h1>
  <p><strong>Less talk. Finish the work.</strong></p>
  <p>A local-first Agent platform for real tasks: focused context, fewer wasted tokens and round trips, and editable, verifiable deliverables.</p>

  <p>
    <a href="https://github.com/Austin-Patrician/Wordless/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/Austin-Patrician/Wordless?display_name=tag&style=flat-square" /></a>
    <a href="https://github.com/Austin-Patrician/Wordless/actions/workflows/release-desktop.yml"><img alt="Desktop Release" src="https://img.shields.io/github/actions/workflow/status/Austin-Patrician/Wordless/release-desktop.yml?label=desktop%20release&style=flat-square" /></a>
    <img alt="macOS 13+" src="https://img.shields.io/badge/macOS-13%2B-111111?style=flat-square&logo=apple" />
    <img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-0078D4?style=flat-square&logo=windows11" />
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-source--available-5b6758?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://github.com/Austin-Patrician/Wordless/releases/latest"><strong>Download the latest release</strong></a>
    ·
    <a href="apps/website/src/content/docs/en/docs/index.mdx">User manual</a>
    ·
    <a href="docs/architecture/overview.md">Architecture</a>
    ·
    <a href="https://github.com/Austin-Patrician/Wordless/issues">Report an issue</a>
  </p>
</div>

![Wordless desktop workspace](docs/assets/desktop/wordless-workspace.png)

## What is Wordless?

Wordless is not another chat window that only returns text. It is an Agent workbench for macOS and Windows: select a workspace, model, and work mode, then let the Agent read context and invoke tools within explicit permission boundaries. Presentations, spreadsheets, research results, UI designs, generated images, and code changes stay visible in the same interface where the work happens.

Wordless is local-first. Workspaces, conversations, and artifacts remain on your device. Google sign-in and cloud sync are optional, so local work continues when you are signed out or offline. The interface ships in Chinese and English.

## Why we built Wordless

Most AI products are optimized to produce an answer. Real work needs something stricter: understand only the relevant context, take the right action, leave a usable artifact, and verify what happened. Wordless is built around that outcome rather than around a longer conversation.

- **Output before narration**: execution status belongs in the interface. The model should spend its response on decisions, results, and exceptions instead of repeatedly describing progress.
- **Scoped context before bulk ingestion**: `@` references, workbook selections, presentation elements, and work-mode Profiles narrow the input to what the task actually needs.
- **Tokens spent on useful work**: task-specific tools, context compaction, and provider cache accounting are designed to reduce repeated or irrelevant context.
- **End-to-end delivery**: planning, tool execution, artifact creation, inspection, and correction remain in one task instead of stopping at advice.
- **Verification before confidence**: tests, quality scans, sources, diffs, tool results, and interactive previews make the result inspectable.

> [!NOTE]
> "Fewer tokens" is a design objective, not a fixed savings guarantee. Actual usage depends on the model, provider, task, selected context, and number of correction rounds. "Finish the work" means minimizing avoidable handoffs and round trips, not pretending every complex task can be completed correctly in one model turn.

## Why Pi Agent Harness

Wordless uses the MIT-licensed [Pi Agent Harness](https://github.com/earendil-works/pi) as its agent foundation instead of rebuilding a generic model and tool loop. Pi provides the portable primitives; Wordless turns them into scenario-specific desktop workflows.

| Product need | Pi foundation | Wordless adaptation |
| --- | --- | --- |
| Multiple model providers | Unified streaming API and model capability data | Visual provider configuration, reasoning depth, credential storage, and usage display |
| Multi-step execution | Agent loop, structured tool calls, events, and state | Approval checkpoints, risk handling, visible tool states, persistence, and recovery |
| Different kinds of work | Composable tools and a UI-independent core | Profiles, Drivers, Extensions, specialized capabilities, and artifact workbenches |
| Long-running context | Continuable message and Agent state | Session journal, search, context compaction, steering, and follow-up handling |

```text
Task intent
    -> Profile
    -> Driver + Extensions
    -> Pi-derived agent loop
    -> Capabilities and workspace policy
    -> Interactive artifact surface
```

One loop does not mean one generic Agent. Each Profile deliberately changes the context, tools, permission declarations, execution guidance, artifact type, and verification surface:

| Profile | Scenario adaptation |
| --- | --- |
| General | Everyday work, Skills, MCP, and optional workspace tools |
| Coding | Indexed search, file edits, Shell, tests, diffs, and coding policy |
| Presentation | OfficeCLI-backed slide tools, quality scans, and interactive PPTX preview |
| Spreadsheet | Workbook selections, formulas, charts, quality checks, and publishing |
| Data Analysis | Data inspection, confirmed research plans, delegated dimensions, sources, and reports |

This separation keeps Pi replaceable. Provider protocols live behind `@wordless/ai`, the loop and events behind `@wordless/agent`, and concrete runtime integration behind the Driver SDK. Upgrading Pi or introducing another Driver should change adapters and event mapping rather than every Composer, approval, storage, and artifact UI.

## Wordless and Tencent WorkBuddy

Wordless and Tencent WorkBuddy both aim to move beyond chat and deliver real work. They take different product routes. The comparison below is based on Tencent's public [WorkBuddy product page](https://cloud.tencent.com/product/workbuddy) and [official overview](https://www.workbuddy.cn/docs/workbuddy/Overview) available in September 2026; capabilities and commercial plans may change.

| Dimension | Wordless | Tencent WorkBuddy |
| --- | --- | --- |
| Product route | Local-first, source-available Agent platform for users who want to control models, tools, permissions, and extensions | Turnkey commercial workplace Agent for broad business roles and managed adoption |
| Scenario composition | Repository-visible Profiles, Drivers, Extensions, Skills, and MCP integrations, covering documents, data, code, UI design, and images | Domain experts, Skills, project spaces, and multi-Agent collaboration |
| Models and cost | Bring your own provider and API key; usage is billed by the selected provider | Tencent-operated product and quota plans, with model configuration exposed through its product experience |
| Data and execution | Conversations and artifacts stay local by default; workspace policy and explicit approvals gate tool execution | Can operate authorized local folders while account, service, and team boundaries follow the Tencent product |
| Artifact experience | Dedicated in-app surfaces for PPT, spreadsheets, data, code, UI design, and images support selecting an object, range, or frame and continuing from that exact context | Covers broad document, spreadsheet, PPT, research, coding, and creative delivery workflows |
| Collaboration and ecosystem | Currently optimized for individual, local workflows with optional settings sync and developer-controlled extensions | Project spaces, shared experts, Skills, connectors, team reuse, and the Tencent ecosystem |
| Transparency and customization | Source-visible architecture, BYOK models, explicit event and permission boundaries, replaceable adapters | Managed product with a larger ready-made expert and service ecosystem |

Choose WorkBuddy when you want a mature, ready-made office and team ecosystem with managed experts. Choose Wordless when local-first data, BYOK models, explicit approvals, source-visible architecture, and deep workflow customization matter more. This is a difference in product priorities, not a claim that one tool is universally better.

## Core capabilities

- **Workspace context**: use `@` to reference workspace files and folders, `$` to select Skills, and `!` to point at an open task. File indexing respects `.gitignore`.
- **UI design**: pick a built-in style or describe the interface from scratch. The Agent writes real HTML frames into an `x.wdesign` package, on a canvas you can zoom, select, align, recolour, and export from.
- **Image generation and editing**: generate images on a canvas, then iterate with variations, cropping, local edits, background removal, and object removal.
- **Text recognition (OCR)**: bundled and offline. When the model cannot see images itself, it can read **printed text** out of a screenshot, a scanned page, or a photo of a document. It is **not a replacement for vision**: layout, colour, chart trends, stamps, and handwriting are out of reach, and the result carries a note saying the text was machine-recognised.
- **Interactive Presentation**: after the Agent creates or edits slides, inspect pages, select elements, and continue iterating in the right workspace instead of downloading a one-off file.
- **Interactive Spreadsheet**: inspect cells, charts, and changes directly. Continue from the current selection and verify updates immediately.
- **Data Analysis and deep research**: divide research into dimensions, delegate work in parallel, follow progress, and return reports and charts to the workspace.
- **Coding workflow**: combine planning, file search, Shell, diffs, and test results into reviewable code changes.
- **Tasks and automation**: keep work as trackable tasks with owners, status, and a timeline, and schedule prompts to run on a recurring trigger.
- **Digital employees**: turn a working method into a reusable role, group roles into a team, and delegate parts of a task to them.
- **Controlled tool execution**: tool calls require manual approval by default. Session auto-approval is available, a documented bypass mode exists for work you have already sandboxed, and high-risk actions return to explicit review. One-time access outside the workspace is also supported.
- **Models and reasoning depth**: configure built-in and OpenAI-compatible providers, including sign-in with a supported subscription where the provider offers one, plus Base URLs, model capabilities, context limits, and reasoning levels.
- **Skills & MCP**: import reusable Skills, discover and install connectors from the official MCP Registry, and connect custom stdio or HTTP servers.
- **Built-in browser**: let the Agent open a page in the right-hand panel, read it, and act on it under the same approval rules.
- **Conversation experience**: message search and navigation, context compaction, Markdown/GFM, syntax highlighting, Mermaid, KaTeX math rendering, and in-place translation.
- **Interface language**: Chinese (default) and English, switchable from Settings, the sidebar, or first-run setup.

## Built for real artifacts

### UI design

Pick a built-in style and describe the interface, or ask for one from scratch. Frames are real HTML files in an `x.wdesign` package inside your workspace, so the Agent can check the structure, re-check it against the style's tokens, and look at the rendered pixels instead of guessing at them. You arrange, align, and recolour on the canvas; when a screen is ready, export it as a render — PNG, long image, or PDF, with an optional device shell — or download the design's materials.

<!-- Screenshot: design-export.png — the export dialog: frames rail, PNG / long image / PDF, frames per page, export scale, device shell, shadow, watermark, Save. -->
![Design export dialog](docs/assets/desktop/design-export.png)

<!-- Screenshot: design-canvas.png — canvas with 3+ styled frames, tool bar (select / hand / new frame / style / colour system / zoom), a selected frame's colour system, zoom percentage. English UI, no real workspace paths. -->
![UI design canvas with HTML frames](docs/assets/desktop/design-canvas.png)

<!-- Screenshot: design-library.png — design library with the built-in style wall (recognisable style names), search and sort, "start from a style" action. -->
![Design library and built-in styles](docs/assets/desktop/design-library.png)

Two interfaces generated from a brief — each one is still an `x.wdesign` package you can reopen and keep editing, not an exported picture:

<!-- Showcase: output of this work mode. Keep these as generated design packages, not retouched mockups. -->
| A generated interface | Another generated interface |
| --- | --- |
| ![Generated interface, first example](docs/assets/desktop/design-example-01.png) | ![Generated interface, second example](docs/assets/desktop/design-example-02.png) |

### Presentation

Generation progress, tool states, and slide previews remain in one task context. Select a page or an individual object and ask the Agent to continue refining its layout, content, or visual treatment.

![Interactive presentation workspace](docs/assets/desktop/presentation-preview.png)

### Spreadsheet

Select a data region in the workbook preview and use that selection as precise context for the next action. Agent changes appear in the workbook immediately instead of remaining as text suggestions.

![Interactive spreadsheet selection](docs/assets/desktop/spreadsheet-selection.png)

### Data Analysis

Delegate complex research by dimension and distinguish queued, running, completed, and failed work in the timeline, making every researcher's current activity visible.

![Parallel data analysis research](docs/assets/desktop/data-analysis-research.png)

### Coding

Plans, file edits, diffs, and test results remain traceable. Workspace policy governs tool execution, and critical actions enter the approval flow before they occur.

![Coding plan, diff, and tests](docs/assets/desktop/code-plan-diff-tests.png)

### Image generation

Generated images stay on the canvas as nodes, so the next instruction can refer to a result instead of re-describing it. Eight operations cover generating, variations, cropping, local edits, background removal, object removal, and multi-view.

<!-- Screenshot: media-canvas.png — media canvas with several generated candidates, a node graph with iteration edges, and the edit-operation menu. -->
![Image generation canvas](docs/assets/desktop/media-canvas.png)

## Beyond a single conversation

A session is where work happens; these are the surfaces that keep it visible after the model stops typing. Each one is a row in the sidebar.

- **Tasks**: work becomes a task with an owner, a status, and a timeline. Move between overview, board, timeline, list, and dashboard views, and drop a task into the conversation with `!` when it is time to work on it.
- **Automations**: run a prompt on a schedule, keep the run history, and start from a template.
- **Digital employees**: save reusable roles, group them into a team, and delegate from the conversation.
- **Translation**: select text in a message to translate it in place, or keep the translation panel open beside the conversation.

Two more things reach you after the work stops, without you watching the window:

- **Desktop notifications** (**Settings → General**): when Wordless is not in the foreground, the Agent waiting for an approval or an answer, a completed run, and a failed run each raise a system notification. A session you are already looking at is left alone.
- **Message push** (**Settings → Message push**): automations and scheduled runs can deliver their result to a DingTalk, Feishu, or WeCom group robot. The body is a template with a fixed set of variables, each automation can override the defaults, and the credential stays on this machine.

<!-- Screenshot: tasks-board.png — task centre with the board (to-do / in progress / done columns with cards) and the timeline view (bars, week/month range switch). -->
![Task board and timeline](docs/assets/desktop/tasks-board.png)

<!-- Screenshot: automation.png — automation list or run history with queued / running / completed / failed states and a schedule. -->
![Automation runs and history](docs/assets/desktop/automation.png)

<!-- Screenshot: digital-employees.png — digital employee cards and a team, ideally with a delegation visible. -->
![Digital employees and teams](docs/assets/desktop/digital-employees.png)

<!-- Screenshot: translation.png — selected text with the translation bubble, or the translation panel beside a conversation. -->
![Inline translation](docs/assets/desktop/translation.png)

## Remote access

Continue this computer's sessions from your phone. Everything is end-to-end encrypted, and both the session and the execution stay on this machine. **Settings → Remote access** offers two ways in:

- **Local network**: the phone and this computer on the same WiFi is enough. Turn the switch on and Wordless runs the relay and the web client here, fills in the address, and shows a QR code — scan it and you are in. No server, no configuration.
- **Remote**: works on any network the phone happens to be on, including mobile data. It needs a relay server **you deploy yourself**, and Wordless gives you two routes: a tutorial to type out, or SSH details so it deploys for you — after probing the server it tells you what it found wrong (a port already taken, the wrong distribution, an earlier deployment), leaves a version stamp on the server (a desktop upgrade means deploying again), and can be taken down again in one action.

Pairing is a QR scan, or typing a connection code plus a password. **The first phone to present a key pins the identity public key**, an unclaimed connection code expires after ten minutes, every phone that connects raises a system notification, and each phone can be unpaired on its own.

What the phone can do is **continue the conversation**: list and read sessions, send messages, abort, switch models, attach files, answer approvals and questions, and search workspace files read-only. It is **not remote desktop** — no screen streaming, no settings, no picking files on this machine, no operating the desktop. The Agent keeps running on this computer.

<!-- Screenshot: remote-access.png — remote access settings: the local-network / remote pair of modes, the QR code, and the address with "open on your phone". -->

## Extension and control

Skills capture reusable working methods, while MCP connects external capabilities. Skills can be imported from a file or discovered on SkillsMP; the MCP tab discovers connectors from the official MCP Registry, showing transport, capabilities, publisher, and source repository before anything is installed, and surfacing updates for installed connectors the same way. Model capability and tool permission remain separate: a model can request an action without automatically receiving permission to execute it.

![Skills and MCP settings](docs/assets/desktop/skills-and-mcp.png)

<!-- Screenshot: mcp-marketplace.png — the MCP discover tab: registry search results with transport, publisher and an install action, plus an installed connector showing an update. -->
![MCP connector discovery](docs/assets/desktop/mcp-marketplace.png)

Sensitive credentials such as API keys and OAuth tokens are stored in the operating system's secure credential storage when available. Google cloud sync is disabled by default. When enabled, it only syncs the data types declared in Settings, excluding API keys, workspace files, generated artifacts, and conversation content.

![Security and privacy settings](docs/assets/desktop/security-privacy.png)

## Architecture

Wordless is a modular monolithic desktop application and does not require a separate local HTTP backend. The React Renderer communicates with Electron Main through a restricted Preload Bridge. The main process composes the Runtime, Agent Profiles, Capabilities, persistence, and platform adapters.

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

Work modes are not separate copies of the Agent. Profiles assemble prompts, tools, drivers, and extensions, while the shared Runtime owns sessions, events, approvals, and persistence. Each work mode can evolve independently, and underlying dependencies remain replaceable.

### Kernel boundaries and portability

The product-level Profile mapping above is implemented through explicit dependency boundaries. `@wordless/ai` isolates provider protocols and model capabilities, `@wordless/agent` isolates the loop and event types, and `agent-driver-sdk` defines the contract between Runtime and a concrete kernel. Profiles do not depend directly on Electron, while session journals and domain messages remain owned by Wordless.

| Profile assembly and driver registry | Tool boundaries across work modes |
| --- | --- |
| ![Profile, driver, and registry architecture](docs/assets/desktop/profile-driver-registry.png) | ![Profile tool comparison](docs/assets/desktop/profile-tool-comparison.png) |

Upstream Pi remains credited under its original MIT license. See [Architecture Overview](docs/architecture/overview.md), [Dependency Rules](docs/architecture/dependencies.md), and [Upstream Source Record](UPSTREAM.md) for the detailed boundaries.

## Installation

Download the package for your device from [GitHub Releases](https://github.com/Austin-Patrician/Wordless/releases/latest):

| Device | Installer | Requirement |
| --- | --- | --- |
| Apple Silicon Mac (M1/M2/M3/M4 and later) | `Wordless-<version>-mac-arm64.dmg` | macOS 13 or later |
| Intel Mac | `Wordless-<version>-mac-x64.dmg` | macOS 13 or later |
| Windows 10/11 x64 | `Wordless-<version>-win-x64.exe` | NSIS installer |

Files ending in `.zip`, `.blockmap`, `latest.yml`, and `latest-mac.yml` are primarily used by the update workflow. For a normal installation, choose the `.dmg` or `.exe` file.

> [!IMPORTANT]
> Current macOS releases are test builds without Apple Developer ID notarization. Download them only from the official Wordless repository. On first launch, you may need to Control-click Wordless in Finder and choose **Open**, or use **System Settings → Privacy & Security → Open Anyway**. Do not disable Gatekeeper globally.

On first launch, a short guided tour creates your first workspace, connects a model, and walks through the sidebar. You can replay it from Settings.

Wordless needs a shell and Node to run the agent, and neither is something you have to install: Node falls back to the runtime the app already ships (Electron is a Node), and Windows does not require Git Bash — without bash it uses PowerShell or cmd. Python is only used by the data features, and a copy ships with the app too. Anything missing is listed honestly in **Settings → Environment**, with a link to the official download page; that panel is read-only and never installs anything for you.

Wordless notifies you when a new version is available but never forces installation. Because unsigned macOS builds cannot use the standard signed update path reliably, some versions must be downloaded as a DMG and installed manually over the existing application.

## Model configuration

Wordless does not bundle model credits. Before starting your first task, configure an available provider under **Settings → Models**:

1. Select a built-in provider — Wordless ships dozens, from Anthropic, OpenAI, Google, and DeepSeek to gateways such as OpenRouter and Cloudflare — or create a custom provider. Providers that accept a subscription account show a sign-in button next to the API key field.
2. Enter the API key, or sign in to the subscription. Credentials are stored separately from ordinary model JSON.
3. For OpenAI-compatible services, enter the Base URL, typically ending in `/v1`, the actual Model ID, and the matching protocol.
4. Enable the model under **Enabled models**, then return to the Composer and select it.
5. If the model declares reasoning support, select a reasoning depth from the chosen model's secondary options. The default is `medium` until changed manually. Image generation models are configured on the same page.

<!-- Screenshot: model-providers.png — provider list showing the subscription sign-in buttons (Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot) next to a key-based provider. -->
![Model providers, including subscription sign-in](docs/assets/desktop/model-providers.png)

![Model and thinking-depth selector](docs/assets/desktop/model-thinking-depth.png)

See the [custom model configuration guide](apps/website/src/content/docs/en/docs/models.mdx) for complete field descriptions, JSON examples, and troubleshooting. Always use the provider's own documentation when setting context windows, maximum output, and reasoning parameters.

## Local development

### Requirements

- Node.js `22.19.0` or later
- npm, included with a compatible Node.js release
- macOS 13+ or Windows 10/11 x64 to run the corresponding desktop build

### Start the desktop application

```bash
git clone https://github.com/Austin-Patrician/Wordless.git
cd Wordless
npm ci
npm run dev:electron --workspace=@wordless/desktop
```

The desktop development command prepares the OfficeCLI assets for the current platform, builds the Electron main process, and starts both the Renderer and Electron.

### Common commands

```bash
# Run repository type and static checks
npm run check

# Run Desktop main-process tests
npm run test:host --workspace=@wordless/desktop

# Run Renderer tests (unit, and in a real browser)
npm run test:thread-unit --workspace=@wordless/desktop
npm run test:thread-browser --workspace=@wordless/desktop

# Build Desktop without creating an installer
npm run build:desktop --workspace=@wordless/desktop

# Check and build the Website and user manual
npm run build --workspace=@wordless/website
```

Release builds additionally run packaged probes (`npm run verify:packaged-icon`, `verify:packaged-fff`, `verify:packaged-design-build`), which exercise the installer that was just produced. They must run outside the repository checkout: inside it, Node resolves the repository's own `node_modules` and reports success for packages that never made it into the package.

Packaging commands:

```bash
npm run dist:mac --workspace=@wordless/desktop
npm run dist:win --workspace=@wordless/desktop
```

## Monorepo

```text
apps/
  desktop/                         Electron main, Preload, and React Renderer
  website/                         Astro website and bilingual Starlight manual
packages/
  ai, agent/                       Internal fork based on Pi
  runtime, protocol, persistence/  Session orchestration, IPC contracts, persistence
  coding-agent/                    Read, write, edit, shell, and workspace search tools
  agent-driver-*/                  Generic, Coding, Presentation, Spreadsheet, SDK
  agent-extension-*/               Compaction, plan, runtime, Subagent extensions
  capabilities/                    Browser, data, design, filesystem, shell, Office
  profiles/                        Built-in work-mode Profiles (general, coding, ppt, excel, data, ui)
  agent-workspace-policy/          Approval, risk levels, and workspace boundaries
  connector-registry/              Skills and MCP connector catalog and installation
  domain/                          Shared domain types, workbenches, and permissions
  platform-node/                   Node-side platform adapters, indexing, and search
  profile-sdk, provider-sdk/       Extension points for Profiles and model providers
  model-config, skill-registry/    Model configuration and Skills registry
  workspace-search/                Workspace search and ignore rules
  ui-kit/                          Shared Renderer state and UI primitives
docs/                              Architecture documentation and README assets
third_party/                       Third-party notices shipped with releases
open-vetta/                        Vendored upstream tree kept for reference; not part of the build
```

`apps/website` is built and deployed independently and is not packaged into the Desktop installer.

## Data and privacy

- Workspace files, conversations, and artifacts remain local by default.
- Model requests are sent to the provider selected by the user. The transmitted context depends on the task and explicitly referenced material.
- Tools execute in Electron Main or in a user-configured MCP service. The Renderer does not receive direct Node.js access.
- Google sign-in is optional. Google Cloud Sync must be enabled separately, and network failures never block local work.
- Cloud sync currently covers model metadata and user preferences, including the interface language. It excludes API keys, conversation content, workspace files, and generated artifacts.
- The interface ships in Chinese (default) and English; the choice is stored locally and included in sync only when you enable it.

See [Security & Privacy](apps/website/src/content/docs/en/docs/security-privacy.mdx) for security boundaries and data flows. Do not include API keys, OAuth tokens, private files, or sensitive full logs in public issues.

## Third-party projects

Wordless builds on excellent third-party projects and retains their original licenses and attribution:

- [Pi Agent Harness](https://github.com/earendil-works/pi): upstream source for `packages/ai` and `packages/agent`; see [UPSTREAM.md](UPSTREAM.md).
- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI): Presentation and Office document engine.
- [Electron](https://github.com/electron/electron), [React](https://github.com/facebook/react), and [Vite](https://github.com/vitejs/vite): desktop and frontend foundations.
- [React Virtuoso](https://github.com/petyosi/react-virtuoso): virtualization for long conversations.
- [Astro](https://github.com/withastro/astro) and [Starlight](https://github.com/withastro/starlight): website and user manual.
- [Three.js](https://github.com/mrdoob/three.js): 3D visuals on the Website.
- [Tailwind CSS](https://tailwindcss.com): the Renderer's styling engine, and the token pipeline behind designs.
- [React Flow](https://reactflow.dev): the design canvas, its nodes, and frame interaction.
- [Mermaid](https://mermaid.js.org), [KaTeX](https://katex.org), and [highlight.js](https://highlightjs.org): diagrams, math, and code highlighting in messages.
- [sharp](https://sharp.pixelplumbing.com) and `pdf-parse`: image and PDF processing.
- `@ff-labs/fff-node`: the local file index behind workspace search and `@` references.

Third-party components are not relicensed under the Wordless custom license. They remain subject to the licenses in their own repositories or accompanying files.

## Contributing

Reproducible bug reports, feature proposals, documentation feedback, and pull requests are welcome through [GitHub Issues](https://github.com/Austin-Patrician/Wordless/issues). Run checks and tests appropriate to your change before submitting, and never commit credentials, personal data, build artifacts, or workspace content.

## License and commercial use

Original Wordless code and assets are licensed under the [Wordless Source-Available License 1.0](LICENSE). Personal, educational, research, evaluation, and non-commercial internal use is free. Commercial use, paid services, SaaS, resale, commercial hosting, or revenue-related distribution requires prior written authorization.

This is a **source-available license, not an OSI-approved open-source license**. For commercial licensing, contact the maintainers through [GitHub Issues](https://github.com/Austin-Patrician/Wordless/issues) without disclosing confidential business information. Third-party and upstream code remains subject to its original licenses.

## Star History

<a href="https://www.star-history.com/#Austin-Patrician/Wordless&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Austin-Patrician/Wordless&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Austin-Patrician/Wordless&amp;type=Date" />
    <img alt="Wordless GitHub star history chart" src="https://api.star-history.com/svg?repos=Austin-Patrician/Wordless&amp;type=Date" />
  </picture>
</a>

## Community & Support

<table>
  <tr>
    <td align="center" width="50%">
      <a href="https://qr.wordless.20250230.xyz/wechat-group.png">
        <img src="https://qr.wordless.20250230.xyz/wechat-group.png" alt="Scan with WeChat to join the Wordless community" width="180" />
      </a>
      <br />
      <strong>Join the Wordless WeChat group</strong>
      <br />
      <sub>Share product feedback, questions, and Agent workflows</sub>
    </td>
    <td align="center" width="50%">
      <a href="https://qr.wordless.20250230.xyz/buy-me-coffee.png">
        <img src="https://qr.wordless.20250230.xyz/buy-me-coffee.png" alt="Buy me a coffee" width="180" />
      </a>
      <br />
      <strong>Buy Me a Coffee</strong>
      <br />
      <sub>Support the continued development and maintenance of Wordless</sub>
    </td>
  </tr>
</table>

---

Finally, thank you to everyone at LinuxDo for supporting Wordless. Join [https://linux.do/](https://linux.do/) for technical discussions, frontier AI news, and practical AI experience sharing.
