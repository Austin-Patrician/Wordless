import { expect, it } from "vitest";
import { NO_SHARED_TAB_MESSAGE, createBrowserTools } from "../src/index.ts";
import type { BrowserPort, BrowserTabSummary } from "../src/port.ts";

const EMPTY_SNAPSHOT = { url: "", title: "", text: "", refs: [], truncated: false, settling: false };

const SHARED: BrowserTabSummary = {
  id: "tab-1",
  url: "http://localhost:3000/todos",
  title: "Todo",
  loading: false,
  loadError: null,
};

function port(overrides: Partial<BrowserPort> = {}): BrowserPort {
  return {
    listSharedTabs: async () => [SHARED],
    readSnapshot: async () => ({ tab: SHARED, snapshot: { url: SHARED.url, title: SHARED.title, text: "", refs: [], truncated: false, settling: false } }),
    readConsole: async () => ({ tab: SHARED, entries: [], dropped: 0, errorCount: 0 }),
    captureScreenshot: async () => null,
    act: async () => ({ ok: false as const, failure: { code: "not_shared" as const, message: "not shared" } }),
    ...overrides,
  };
}

type BrowserTool = ReturnType<typeof createBrowserTools>[number];
type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: Record<string, unknown>;
};

function find(tools: BrowserTool[], name: string): BrowserTool {
  const tool = tools.find((entry) => entry.name === name);
  // Throwing narrows the type, which an expect cannot do — and a missing tool
  // should fail loudly rather than surface later as an undefined access.
  if (!tool) throw new Error(`${name} is not registered`);
  return tool;
}

/** The one place the loose `input` type is adapted; each tool's own schema validates it. */
async function run(tools: BrowserTool[], name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = await find(tools, name).execute("call", input as never);
  return result as unknown as ToolResult;
}

function textOf(result: ToolResult): string {
  return result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

it("registers the reading tools and the acting tools", () => {
  const names = createBrowserTools(port()).map((entry) => entry.name);
  expect(names).toEqual([
    "browser_tabs",
    "browser_snapshot",
    "browser_console",
    "browser_screenshot",
    "browser_click",
    "browser_type",
    "browser_press",
  ]);
});

it("tells the agent what to ask for when nothing is shared", async () => {
  // The gate is per tab, so the useful failure is an instruction rather than an
  // error the model would retry blindly.
  const tools = createBrowserTools(port({ listSharedTabs: async () => [] }));
  const result = await run(tools, "browser_tabs");
  expect(textOf(result)).toBe(NO_SHARED_TAB_MESSAGE);
});

it("refuses to read a page when the user has shared nothing", async () => {
  const tools = createBrowserTools(port({ readSnapshot: async () => null }));
  const result = await run(tools, "browser_snapshot");
  expect(textOf(result)).toBe(NO_SHARED_TAB_MESSAGE);
});

it("describes a shared tab with its url and load state", async () => {
  const tools = createBrowserTools(port());
  const result = await run(tools, "browser_tabs");
  const text = textOf(result);
  expect(text).toMatch(/tab-1: Todo/);
  expect(text).toMatch(/url: http:\/\/localhost:3000\/todos/);
});

it("surfaces a failed load instead of letting the agent read a blank page as empty", async () => {
  // The single most likely thing to be wrong during development is that the dev
  // server is not running, and an empty tree would read as "the page is empty".
  const failed = { ...SHARED, loadError: { description: "ERR_CONNECTION_REFUSED", url: "http://localhost:3000/" } };
  const tools = createBrowserTools(port({ readSnapshot: async () => ({ tab: failed, snapshot: EMPTY_SNAPSHOT }) }));
  const text = textOf(await run(tools, "browser_snapshot"));
  expect(text).toMatch(/last load failed with ERR_CONNECTION_REFUSED/);
});

it("warns that a still-loading read may be incomplete", async () => {
  const loading = { ...SHARED, loading: true };
  const tools = createBrowserTools(port({ readSnapshot: async () => ({ tab: loading, snapshot: EMPTY_SNAPSHOT }) }));
  const text = textOf(await run(tools, "browser_snapshot"));
  expect(text).toMatch(/still loading/);
});

it("renders the accessibility tree with references", async () => {
  const tools = createBrowserTools(port({
    readSnapshot: async () => ({
      tab: SHARED,
      snapshot: { ...EMPTY_SNAPSHOT, text: '[@e1] button "Add"', refs: [{ ref: "@e1", role: "button", name: "Add", ordinal: 1, backendDOMNodeId: 2 }] },
    }),
  }));
  const result = await run(tools, "browser_snapshot");
  const text = textOf(result);
  expect(text).toMatch(/\[@e1\] button "Add"/);
  expect(result.details.refCount).toBe(1);
});

it("says so rather than returning nothing when a page has no readable content", async () => {
  const tools = createBrowserTools(port());
  const text = textOf(await run(tools, "browser_snapshot"));
  expect(text).toMatch(/no readable content yet/);
});

it("formats console entries with level and source", async () => {
  const tools = createBrowserTools(port({
    readConsole: async () => ({
      tab: SHARED,
      dropped: 0,
      errorCount: 1,
      entries: [{ id: 1, level: "error", text: "Boom", source: "app.js", line: 12 }],
    }),
  }));
  const result = await run(tools, "browser_console");
  const text = textOf(result);
  expect(text).toMatch(/\[error\] Boom \(app\.js:12\)/);
  expect(text).toMatch(/1 error\(s\) in the buffer/);
});

it("reports rotated-out console messages instead of looking quiet", async () => {
  // An agent asking from an old cursor must not read an empty page as silence.
  const tools = createBrowserTools(port({
    readConsole: async () => ({ tab: SHARED, entries: [], dropped: 7, errorCount: 0 }),
  }));
  const text = textOf(await run(tools, "browser_console"));
  expect(text).toMatch(/7 earlier message\(s\) were dropped/);
});

it("hands back the newest console id so the next read can be incremental", async () => {
  const tools = createBrowserTools(port({
    readConsole: async () => ({
      tab: SHARED,
      dropped: 0,
      errorCount: 0,
      entries: [
        { id: 4, level: "log", text: "a", source: null, line: null },
        { id: 5, level: "log", text: "b", source: null, line: null },
      ],
    }),
  }));
  const result = await run(tools, "browser_console");
  expect(result.details.sinceId).toBe(5);
});

it("returns a screenshot as image content, not text", async () => {
  const tools = createBrowserTools(port({
    captureScreenshot: async () => ({ data: "AAAA", mimeType: "image/png", tab: SHARED }),
  }));
  const result = await run(tools, "browser_screenshot");
  const content = result.content;
  expect(content[1]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
});

it("explains the sharing gate when a screenshot is refused", async () => {
  const tools = createBrowserTools(port({ captureScreenshot: async () => null }));
  const text = textOf(await run(tools, "browser_screenshot"));
  expect(text).toBe(NO_SHARED_TAB_MESSAGE);
});
