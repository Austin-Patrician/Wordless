import { Type, type TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import { DEFAULT_CONSOLE_PAGE_SIZE, consoleEntriesSince } from "./console.js";
import type {
  BrowserActOutcome,
  BrowserActRequest,
  BrowserPort,
  BrowserSnapshotSummary,
  BrowserTabSummary,
} from "./port.js";
import { buildSnapshot } from "./snapshot.js";
import type { OcrPort } from "@wordless/capability-ocr";

/**
 * Read-only browser tools for the agent.
 *
 * Read-only on purpose: seeing a page is what lets an agent check its own work,
 * and it is the half with no meaningful security surface. Acting on a page —
 * clicking, typing — needs the approval and origin policies from the design
 * doc, and is deliberately absent here.
 *
 * Everything is gated on the user having shared a tab. There is no fallback that
 * reads whatever happens to be open, because the whole point of the gate is that
 * "the agent can read my pages" is a decision the user makes per tab.
 */

type ToolDetails = Record<string, unknown>;

/** Preserves parameter inference, so each tool's `input` is typed from its schema. */
function tool<TParameters extends TSchema>(definition: AgentTool<TParameters, ToolDetails>): AgentTool<TParameters, ToolDetails> {
  return definition;
}

export const NO_SHARED_TAB_MESSAGE =
  "No browser tab is shared with you. Ask the user to open the page in the browser panel and turn on sharing for it.";

/**
 * 模型看不了图片时的截图答复。
 *
 * 截图的价值全在"像素"上,而看不见像素的模型拿不到任何东西 —— 与其塞给它一个它读不了的
 * image block(它会以为"我看过了"),不如直说,并把它指向可访问性树。
 */
/** 截了、也识别了,但图里没有文字(纯图形页面)。 */
export const SCREENSHOT_NO_TEXT_MESSAGE =
  "The screenshot was read, but no text was recognized in it. This model cannot view images, so the page's visual content is not available to it: use browser_snapshot for the accessibility tree, or ask the user.";

export const SCREENSHOT_UNSUPPORTED_MESSAGE =
  "Screenshots are unavailable: the current model cannot view images. Use browser_snapshot to read the page as text (it returns the accessibility tree), and browser_console for errors. If a purely visual judgement is needed, ask the user to switch to a vision-capable model.";

function textResult(content: string, details: ToolDetails = {}): AgentToolResult<ToolDetails> {
  return { content: [{ type: "text", text: content }], details };
}

function describeTab(tab: BrowserTabSummary): string {
  const label = tab.title || tab.url || "(untitled)";
  const parts = [`${tab.id}: ${label}`];
  if (tab.url && tab.url !== label) parts.push(`  url: ${tab.url}`);
  if (tab.loading) parts.push("  still loading");
  if (tab.loadError) parts.push(`  last load failed: ${tab.loadError.description} (${tab.loadError.url})`);
  return parts.join("\n");
}

/**
 * Header prepended to a page read.
 *
 * The load state belongs here rather than in the tool's text body: an agent that
 * reads a blank tree from a page which failed to load would otherwise conclude the
 * page is empty, when the real answer is that the dev server is not running.
 */
function describeReadState(tab: BrowserTabSummary): string[] {
  const notes = [`tab ${tab.id}`, `url: ${tab.url || "(none)"}`];
  if (tab.title) notes.push(`title: ${tab.title}`);
  if (tab.loading) notes.push("note: the page is still loading, so this may be incomplete — read again when it settles.");
  if (tab.loadError) notes.push(`note: the last load failed with ${tab.loadError.description}, so the page below is not what the user expects.`);
  return notes;
}

export interface BrowserToolOptions {
  /**
   * 当前模型能否看图片(`model.input.includes("image")`)。
   *
   * 默认 `true` —— 截图是浏览器面板的主要用途,只有明确知道看不了时才降级。
   */
  imagesVisible?: boolean;
  /**
   * 看不了图时的**兜底**:把截图交给本地文字识别,返回图里的文字。
   *
   * 不给这个能力时,`browser_screenshot` 只能回一句"这个模型看不了图片" —— 那是实话,但对
   * "页面上的报错写了什么"这种问题毫无帮助。有了它,截图至少能读成文字。
   */
  ocr?: OcrPort;
}

export function createBrowserTools(port: BrowserPort, options: BrowserToolOptions = {}): AgentTool[] {
  const imagesVisible = options.imagesVisible ?? true;
  const tabs = tool({
    name: "browser_tabs",
    label: "List shared browser tabs",
    description: `List the browser tabs the user has shared with you. Only shared tabs can be read. Returns "${NO_SHARED_TAB_MESSAGE}" when there are none.`,
    parameters: Type.Object({}),
    async execute() {
      const shared = await port.listSharedTabs();
      if (shared.length === 0) return textResult(NO_SHARED_TAB_MESSAGE, { tabCount: 0 });
      return textResult(shared.map(describeTab).join("\n"), { tabCount: shared.length, tabs: shared });
    },
  });

  const snapshot = tool({
    name: "browser_snapshot",
    label: "Read a shared page",
    description:
      "Read a shared browser tab as indented text from its accessibility tree. Interactive elements carry a stable @eN reference, and duplicate labels are disambiguated with an ordinal. Prefer this over fetching the URL: it shows the rendered page, including anything a browser would not see from the HTML alone.",
    parameters: Type.Object({ tabId: Type.Optional(Type.String({ minLength: 1 })) }),
    async execute(_id, input) {
      const read = await port.readSnapshot(input.tabId);
      if (!read) return textResult(NO_SHARED_TAB_MESSAGE, { tabCount: 0 });
      const header = describeReadState(read.tab);
      const body = read.snapshot.text || "(the page has no readable content yet)";
      return textResult([...header, "", body].join("\n"), {
        tabId: read.tab.id,
        url: read.tab.url,
        refCount: read.snapshot.refs.length,
        truncated: read.snapshot.truncated,
        refs: read.snapshot.refs,
      });
    },
  });

  const console = tool({
    name: "browser_console",
    label: "Read page console output",
    description:
      "Read console messages and uncaught errors from a shared browser tab. Use sinceId from a previous call to read only what is new; a non-zero `dropped` means older messages were rotated out before you read them.",
    parameters: Type.Object({
      tabId: Type.Optional(Type.String({ minLength: 1 })),
      sinceId: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    async execute(_id, input) {
      const page = await port.readConsole(input.tabId, { sinceId: input.sinceId, limit: input.limit ?? DEFAULT_CONSOLE_PAGE_SIZE });
      if (!page) return textResult(NO_SHARED_TAB_MESSAGE, { tabCount: 0 });
      const header = describeReadState(page.tab);
      if (page.dropped > 0) header.push(`note: ${page.dropped} earlier message(s) were dropped before this read.`);
      const lines = page.entries.map((entry) => {
        const where = entry.source ? ` (${entry.source}${entry.line === null ? "" : `:${entry.line}`})` : "";
        return `[${entry.level}] ${entry.text}${where}`;
      });
      if (lines.length === 0) lines.push("(no console output)");
      const summary = `${page.errorCount} error(s) in the buffer`;
      const newestId = page.entries.at(-1)?.id;
      return textResult([...header, summary, "", ...lines].join("\n"), {
        tabId: page.tab.id,
        errorCount: page.errorCount,
        dropped: page.dropped,
        entryCount: page.entries.length,
        ...(newestId === undefined ? {} : { sinceId: newestId }),
      });
    },
  });

  const screenshot = tool({
    name: "browser_screenshot",
    label: "Screenshot a shared page",
    description:
      "Capture the current visual state of a shared browser tab. Use this only when the accessibility tree cannot describe what matters — canvas, WebGL, or a purely visual layout problem. It costs far more context than browser_snapshot.",
    parameters: Type.Object({ tabId: Type.Optional(Type.String({ minLength: 1 })) }),
    async execute(_id, input) {
      // 看不了图的模型:像素递不过去。有本地文字识别时**改成读文字** —— 截图的常见用途就是
      // "页面上写了什么报错",那件事 OCR 做得到;没有它才退回一句实话。
      if (!imagesVisible && options.ocr?.recognizeInline) {
        const shot = await port.captureScreenshot(input.tabId);
        if (!shot) return textResult(NO_SHARED_TAB_MESSAGE, { tabCount: 0 });
        const outcome = await options.ocr.recognizeInline(
          [{ name: `tab-${shot.tab.id}.png`, mimeType: shot.mimeType, base64: shot.data }],
          { signal: new AbortController().signal },
        );
        if (outcome.ok) {
          const recognizedText = outcome.recognition.pages.map((page) => page.text).join("\n").trim();
          const details = { tabId: shot.tab.id, url: shot.tab.url, imagesVisible: false, ocr: true };
          if (recognizedText === "") return textResult(SCREENSHOT_NO_TEXT_MESSAGE, details);
          return textResult([
            `tab ${shot.tab.id}`,
            `url: ${shot.tab.url || "(none)"}`,
            "",
            recognizedText,
            "",
            "---",
            "The text above was extracted from the screenshot by a local OCR engine: it is not a visual description of the page. Layout, colour and anything graphical are not available.",
          ].join("\n"), details);
        }
        return textResult(SCREENSHOT_UNSUPPORTED_MESSAGE, { tabCount: 0, imagesVisible: false, ocr: outcome.code });
      }
      // 既看不了图、也没有文字识别:连截都不截 —— 截图只是白烧一次渲染。
      if (!imagesVisible) return textResult(SCREENSHOT_UNSUPPORTED_MESSAGE, { tabCount: 0, imagesVisible: false });
      const shot = await port.captureScreenshot(input.tabId);
      if (!shot) return textResult(NO_SHARED_TAB_MESSAGE, { tabCount: 0 });
      return {
        content: [
          { type: "text", text: [`tab ${shot.tab.id}`, `url: ${shot.tab.url || "(none)"}`].join("\n") },
          { type: "image", data: shot.data, mimeType: shot.mimeType },
        ],
        details: { tabId: shot.tab.id, url: shot.tab.url, mimeType: shot.mimeType },
      };
    },
  });

  const click = actTool("browser_click", "Click an element", {
    description:
      "Click an element in a shared local page by its @eN handle from browser_snapshot. Only pages served from localhost can be acted on. The result reports whether the page changed and, when it did, a fresh snapshot to act from.",
    request: (input) => ({
      kind: "click",
      ref: input.ref,
      ...(input.button ? { button: input.button } : {}),
      ...(input.clickCount === undefined ? {} : { clickCount: input.clickCount }),
    }),
    parameters: Type.Object({
      ref: Type.String({ minLength: 1 }),
      button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")])),
      clickCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
      tabId: Type.Optional(Type.String({ minLength: 1 })),
    }),
  });

  const type = actTool("browser_type", "Type into an element", {
    description:
      "Type text into an element in a shared local page, by its @eN handle. Set clear to replace existing content, and submit to press Enter afterwards.",
    request: (input) => ({
      kind: "type",
      ref: input.ref,
      text: input.text,
      ...(input.clear === undefined ? {} : { clear: input.clear }),
      ...(input.submit === undefined ? {} : { submit: input.submit }),
    }),
    parameters: Type.Object({
      ref: Type.String({ minLength: 1 }),
      text: Type.String(),
      clear: Type.Optional(Type.Boolean()),
      submit: Type.Optional(Type.Boolean()),
      tabId: Type.Optional(Type.String({ minLength: 1 })),
    }),
  });

  const press = actTool("browser_press", "Press a key", {
    description:
      "Press a keyboard key in a shared local page, for keys browser_type cannot send such as Enter, Escape or Tab.",
    request: (input) => ({ kind: "press", key: input.key }),
    parameters: Type.Object({
      key: Type.String({ minLength: 1 }),
      tabId: Type.Optional(Type.String({ minLength: 1 })),
    }),
  });

  return [tabs, snapshot, console, screenshot, click, type, press];

  /**
   * Shared shape for the acting tools: they differ only in parameters and in how
   * they map onto a request, and every failure mode is rendered the same way so the
   * agent reads one grammar across all of them.
   */
  function actTool<TParameters extends TSchema>(
    name: string,
    label: string,
    definition: {
      description: string;
      parameters: TParameters;
      request: (input: import("typebox").Static<TParameters> & { tabId?: string }) => BrowserActRequest;
    },
  ) {
    return tool({
      name,
      label,
      description: definition.description,
      parameters: definition.parameters,
      async execute(_id, input) {
        const { tabId, ...rest } = input as Record<string, unknown> & { tabId?: string };
        return renderAct(await port.act(tabId, definition.request(rest as never)));
      },
    });
  }

  function renderAct(outcome: BrowserActOutcome): AgentToolResult<ToolDetails> {
    if (!outcome.ok) {
      const { failure } = outcome;
      const lines = [failure.message];
      if (failure.code === "ref_ambiguous") lines.push("Candidates:", ...failure.candidates.map((entry) => `  ${entry}`));
      if ("snapshot" in failure) lines.push("", ...renderSnapshot(failure.snapshot));
      // The extra detail goes in `details` so the model reads the message first.
      return textResult(lines.join("\n"), { ok: false, failure: failure.code });
    }
    const lines = [`${outcome.target.ref} ${outcome.target.role} "${outcome.target.name}"`];
    if (outcome.healedFrom) {
      // Say so rather than pretend: the agent's handle no longer exists, and its
      // next action must use the new one.
      lines.push(`note: the page renumbered since your snapshot, so this resolved to ${outcome.target.ref} instead of ${outcome.healedFrom}.`);
    }
    lines.push(outcome.settled ? "page settled" : "page had not settled when this returned; read again if the result looks incomplete");
    lines.push(outcome.changed ? "page changed:" : "page did not change");
    if (outcome.snapshot) lines.push("", ...renderSnapshot(outcome.snapshot));
    return textResult(lines.join("\n"), {
      ok: true,
      ref: outcome.target.ref,
      ...(outcome.healedFrom ? { healedFrom: outcome.healedFrom } : {}),
      settled: outcome.settled,
      changed: outcome.changed,
    });
  }

  function renderSnapshot(snapshot: BrowserSnapshotSummary): string[] {
    const header = [`url: ${snapshot.url || "(none)"}`];
    if (snapshot.title) header.push(`title: ${snapshot.title}`);
    if (snapshot.truncated) header.push("note: the tree was truncated; not every element is listed.");
    return [...header, "", snapshot.text || "(no readable content)"];
  }
}

export { buildSnapshot, DEFAULT_MAX_SNAPSHOT_LINES } from "./snapshot.js";
export { describeRefs, findRef, healRef, type RefHealing, type RefHint } from "./refs.js";
export {
  ACTION_LIMIT_PER_WINDOW,
  ACTION_WINDOW_MS,
  checkActionBudget,
  evaluateActRequest,
  isActionableUrl,
  isLoopbackUrl,
  originOf,
  type ActDenial,
} from "./action-policy.js";
export {
  appendConsoleEntry,
  consoleEntriesSince,
  countConsoleErrors,
  levelFromSeverity,
  MAX_CONSOLE_ENTRIES,
} from "./console.js";
export type {
  AxNode,
  BrowserActFailure,
  BrowserActOutcome,
  BrowserActRequest,
  BrowserConsoleEntry,
  BrowserConsoleLevel,
  BrowserConsolePage,
  BrowserPort,
  BrowserSnapshotSummary,
  BrowserTabSummary,
  SnapshotRef,
  SnapshotResult,
} from "./port.js";
