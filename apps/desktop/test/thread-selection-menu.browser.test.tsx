import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@wordless/ui-kit";

type HostListener = (event: unknown) => void;

const mocks = vi.hoisted(() => {
  const listeners = new Set<HostListener>();
  return {
    bridgeAvailable: true,
    listeners,
    client: {
      abortTranslation: vi.fn(async () => {}),
      openExternalUrl: async () => {},
      subscribeHost: (listener: HostListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      translateSelection: vi.fn(async () => {}),
    },
    snapshot: {
      modelConfiguration: { models: [{ enabled: true, kind: "chat" }] },
      preferences: { locale: "en-US", translation: { bubbleMaxChars: 600, model: null, targetLanguage: "zh-CN" } },
    },
  };
});

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntimeClient: () => {
    if (!mocks.bridgeAvailable) throw new Error("Electron runtime is unavailable.");
    return mocks.client;
  },
  useRuntime: () => ({ client: mocks.bridgeAvailable ? mocks.client : null, refresh: async () => {}, snapshot: mocks.snapshot }),
}));

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    locale: "en-US",
    reduceMotion: true,
    t: (key: string) => key,
  }),
}));

import { MessageMarkdown } from "../src/renderer/features/thread/MessageMarkdown";
import { captureMessageSelection, serializeRange, type SelectionMode } from "../src/renderer/features/thread/selection-snapshot";
import { MessageSelectionMenu } from "../src/renderer/features/thread/MessageSelectionMenu";
import { TranslationProvider } from "../src/renderer/features/translation/TranslationProvider";
import { TranslationPanelSlot } from "../src/renderer/features/translation/TranslationPanelSlot";
import { useTranslation } from "../src/renderer/features/translation/translation-context";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  // Reset shared mock state: the bridge-availability test runs before others and
  // would otherwise leak "unavailable" into every later case.
  mocks.bridgeAvailable = true;
  mocks.client.abortTranslation.mockClear();
  mocks.client.translateSelection.mockClear();
  mocks.snapshot.modelConfiguration.models = [{ enabled: true, kind: "chat" }];
  mocks.snapshot.preferences.translation.bubbleMaxChars = 600;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

async function renderMarkdown(text: string): Promise<HTMLElement> {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <StrictMode>
        <TooltipProvider>
          <MessageSelectionMenu className="message-markdown min-w-0">
            <MessageMarkdown text={text} />
          </MessageSelectionMenu>
        </TooltipProvider>
      </StrictMode>,
    );
  });
  const element = container.querySelector<HTMLElement>(".message-markdown");
  if (!element) throw new Error("MessageMarkdown did not render its root element");
  return element;
}

function selectNodeContents(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectSelector(root: HTMLElement, selector: string): void {
  const target = root.querySelector(selector);
  if (!target) throw new Error(`Missing selection target: ${selector}`);
  selectNodeContents(target);
}

/** Selects a substring inside the first text node that contains it. */
function selectSubstring(root: HTMLElement, needle: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    const index = value.indexOf(needle);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + needle.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  throw new Error(`No text node contains ${needle}`);
}

function serializeHtml(html: string, mode: SelectionMode): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  return serializeRange(range, mode, host);
}

describe("captureMessageSelection", () => {
  it("returns null when the selection is collapsed", async () => {
    const element = await renderMarkdown("Paragraph text");
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(captureMessageSelection(element)).toBeNull();
  });

  it("returns null when the selection lives outside the given root", async () => {
    const element = await renderMarkdown("Inside text");
    const outside = document.createElement("p");
    outside.textContent = "Outside text";
    document.body.appendChild(outside);
    selectNodeContents(outside);

    expect(captureMessageSelection(element)).toBeNull();
  });

  it("keeps the heading marker when the selection covers the whole heading", async () => {
    const element = await renderMarkdown("# Title\n\nBody text.");
    selectSelector(element, "h1");

    const snapshot = captureMessageSelection(element);
    expect(snapshot!.markdown).toBe("# Title");
  });

  it("re-emits inline emphasis and code in markdown mode", async () => {
    const element = await renderMarkdown("Body with **bold** and `code`.");
    selectSelector(element, "p");

    const snapshot = captureMessageSelection(element);
    expect(snapshot!.markdown).toBe("Body with **bold** and `code`.");
  });

  it("strips markdown markers in plain text mode", async () => {
    const element = await renderMarkdown("Body with **bold** and `code`.");
    selectSelector(element, "p");

    const snapshot = captureMessageSelection(element);
    expect(snapshot!.text).toBe("Body with bold and code.");
  });

  it("keeps whole code blocks fenced with their language", async () => {
    const element = await renderMarkdown("```ts\nconst value = 1;\n```");
    selectSelector(element, "section");

    const snapshot = captureMessageSelection(element);
    // The fence language is the app's normalized label, not the raw info string.
    expect(snapshot!.markdown).toBe("```typescript\nconst value = 1;\n```");
  });

  it("copies a partial code selection as raw source without a fence", async () => {
    const element = await renderMarkdown("```ts\nconst value = 1;\n```");
    selectSubstring(element, "value");

    const snapshot = captureMessageSelection(element);
    expect(snapshot!.markdown).toBe("value");
    expect(snapshot!.markdown).not.toContain("```");
  });

  it("ignores selections that are not inside the message root", async () => {
    const element = await renderMarkdown("Message body");
    const selection = window.getSelection()!;
    selection.removeAllRanges();

    expect(captureMessageSelection(element)).toBeNull();
  });
});

describe("serializeRange", () => {
  it("drops copy buttons and other UI affordances", () => {
    expect(serializeHtml('<p>Visible<button aria-label="Copy code">Copy</button></p>', "markdown")).toBe("Visible");
  });

  it("keeps code block fences without leaking the header label", () => {
    const markdown = serializeHtml('<section class="message-code-block"><header><span>TypeScript</span><button>Copy code</button></header><pre><code class="hljs" data-wordless-language="ts">const a = 1;</code></pre></section>', "markdown");

    expect(markdown).toBe("```ts\nconst a = 1;\n```");
    expect(markdown).not.toContain("Copy code");
    expect(markdown).not.toContain("TypeScript");
  });

  it("keeps list nesting on single lines", () => {
    expect(serializeHtml("<ul><li>First<ul><li>Nested</li></ul></li><li>Second</li></ul>", "markdown")).toBe("- First\n  - Nested\n- Second");
  });

  it("numbers ordered list items", () => {
    expect(serializeHtml("<ol><li>One</li><li>Two</li></ol>", "markdown")).toBe("1. One\n2. Two");
  });

  it("renders tables with a divider row", () => {
    const html = '<div class="message-markdown-table"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table></div>';
    expect(serializeHtml(html, "markdown")).toBe("| Name | Value |\n| --- | --- |\n| a | 1 |");
  });

  it("keeps task list state", () => {
    const html = '<ul><li><input type="checkbox" checked disabled>Done</li><li><input type="checkbox" disabled>Pending</li></ul>';
    expect(serializeHtml(html, "markdown")).toBe("- [x] Done\n- [ ] Pending");
  });

  it("quotes blockquotes line by line", () => {
    expect(serializeHtml("<blockquote><p>First line</p><p>Second line</p></blockquote>", "markdown")).toBe("> First line\n>\n> Second line");
  });

  it("separates blocks with a blank line", () => {
    expect(serializeHtml("<h2>Heading</h2><p>Paragraph</p>", "markdown")).toBe("## Heading\n\nParagraph");
  });

  it("covers links, images, and rules", () => {
    expect(serializeHtml('<p><a href="https://example.com">Docs</a></p><hr><p><img alt="Chart" src="https://example.com/a.png"></p>', "markdown")).toBe("[Docs](https://example.com)\n\n---\n\n![Chart](https://example.com/a.png)");
  });
});

describe("selection context menu", () => {
  function openContextMenu(target: Element): void {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
  }

  it("does not wrap the markdown root in an extra element and keeps text selectable", async () => {
    const element = await renderMarkdown("Selectable text");
    // The menu trigger must not introduce a layout wrapper around the markdown.
    expect(element.parentElement).toBe(document.getElementById("root"));
    expect(getComputedStyle(element).userSelect).not.toBe("none");
  });

  it("opens the menu when a selection exists inside the message", async () => {
    const element = await renderMarkdown("Select me");
    selectSelector(element, "p");

    await act(async () => {
      openContextMenu(element);
    });

    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain("selectionCopy");
    expect(menu!.textContent).toContain("selectionCopyMarkdown");
  });

  it("stays closed when nothing is selected", async () => {
    const element = await renderMarkdown("Select me");
    window.getSelection()?.removeAllRanges();

    await act(async () => {
      openContextMenu(element);
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("selection translation", () => {
  function openContextMenu(target: Element): void {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
  }

  /** Radix menu items select on pointer up, so a bare click() is not enough. */
  function press(element: Element): void {
    for (const type of ["pointerenter", "pointerdown", "pointerup", "click"]) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  }

  function emit(event: { requestId: string; phase: string; text?: string; targetLanguage?: string; error?: string }): void {
    for (const listener of mocks.listeners) {
      listener({ type: "translation", event: { text: "", ...event } });
    }
  }

  async function renderHarness(text: string, options: { onOpenSettings?: () => void; onRevealPanel?: () => void; panel?: boolean; streaming?: boolean } = {}): Promise<HTMLElement> {
    const container = document.getElementById("root")!;
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <TooltipProvider>
            <TranslationProvider onOpenSettings={options.onOpenSettings ?? (() => {})} onRevealPanel={options.onRevealPanel ?? (() => {})} sessionId="session-1">
              <article><MessageSelectionMenu className="message-markdown min-w-0" streaming={options.streaming ?? false}><MessageMarkdown streaming={options.streaming ?? false} text={text} /></MessageSelectionMenu></article>
              {options.panel ? <aside><TranslationPanelSlot /></aside> : null}
            </TranslationProvider>
          </TooltipProvider>
        </StrictMode>,
      );
    });
    const element = container.querySelector<HTMLElement>(".message-markdown");
    if (!element) throw new Error("MessageMarkdown did not render its root element");
    return element;
  }

  async function openMenuWithSelection(element: HTMLElement, selector = "p"): Promise<void> {
    selectSelector(element, selector);
    await act(async () => {
      openContextMenu(element);
    });
  }

  function translateItem(): HTMLElement {
    const item = document.querySelector<HTMLElement>('[data-wordless-action="translate"]');
    if (!item) throw new Error("The translate menu item was not rendered");
    return item;
  }

  beforeEach(() => {
    mocks.bridgeAvailable = true;
    mocks.client.translateSelection.mockClear();
    mocks.client.abortTranslation.mockClear();
    mocks.snapshot.modelConfiguration.models = [{ enabled: true, kind: "chat" }];
    mocks.snapshot.preferences.translation.bubbleMaxChars = 600;
  });

  it("offers translation with the configured language and streams the result into a bubble", async () => {
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);

    expect(translateItem().textContent).toContain("简体中文");
    const submenuTrigger = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === "translationOtherLanguages");
    expect(submenuTrigger).not.toBeUndefined();

    await act(async () => {
      press(translateItem());
    });

    const request = mocks.client.translateSelection.mock.calls[0]?.[0] as { requestId: string; sessionId: string; text: string } | undefined;
    expect(request?.sessionId).toBe("session-1");
    expect(request?.text).toBe("Hello world");
    expect(typeof request?.requestId).toBe("string");

    await act(async () => {
      emit({ phase: "start", requestId: request!.requestId, targetLanguage: "zh-CN" });
      emit({ phase: "delta", requestId: request!.requestId, text: "你好" });
    });
    expect(document.body.textContent).toContain("你好");

    await act(async () => {
      emit({ phase: "delta", requestId: request!.requestId, text: "世界" });
      emit({ phase: "done", requestId: request!.requestId, text: "你好世界", targetLanguage: "zh-CN" });
    });
    expect(document.body.textContent).toContain("你好世界");
  });

  it("sends the language chosen from the submenu as a one-off override", async () => {
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);

    const submenuTrigger = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === "translationOtherLanguages")!;
    await act(async () => {
      press(submenuTrigger);
    });
    const japanese = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find((item) => item.textContent === "日本語");
    expect(japanese).not.toBeUndefined();
    await act(async () => {
      press(japanese!);
    });

    expect(mocks.client.translateSelection.mock.calls[0]?.[0]).toMatchObject({ sessionId: "session-1", targetLanguage: "ja", text: "Hello world" });
  });

  it("does not offer translation for a selection inside a code block", async () => {
    const element = await renderHarness("```ts\nconst value = 1;\n```");
    await openMenuWithSelection(element, "pre code");

    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent ?? "");
    expect(document.querySelector('[data-wordless-action="translate"]')).toBeNull();
    expect(labels.some((label) => label.includes("selectionCopy"))).toBe(true);
  });

  it("disables translation while the assistant is still streaming", async () => {
    const element = await renderHarness("Generating text", { streaming: true });
    await openMenuWithSelection(element);

    const item = translateItem();
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("translationUnavailableWhileStreaming");
    expect(document.querySelector('[role="menuitem"]:not([aria-disabled="true"])')).not.toBeUndefined();
  });

  it("disables translation when no chat model is enabled", async () => {
    mocks.snapshot.modelConfiguration.models = [];
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);

    expect(translateItem().textContent).toContain("translationNeedsModel");
    expect(translateItem().getAttribute("aria-disabled")).toBe("true");
  });

  it("shows long selections in the panel instead of a bubble", async () => {
    const onRevealPanel = vi.fn();
    mocks.snapshot.preferences.translation.bubbleMaxChars = 8;
    const element = await renderHarness("This selection is far longer than the bubble limit", { onRevealPanel });
    await openMenuWithSelection(element);

    await act(async () => {
      press(translateItem());
    });

    expect(onRevealPanel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).toBeNull();
  });

  it("survives the focus restore that happens when the context menu closes", async () => {
    // Closing a Radix menu returns focus to its trigger. A non-modal Radix
    // popover treats any outside focus as a dismissal, which used to close the
    // bubble the instant it appeared.
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });
    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).not.toBeNull();

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    await act(async () => {
      outside.focus();
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).not.toBeNull();
    outside.remove();
  });

  it("dismisses when the thread scrolls after the settle window", async () => {
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });
    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).not.toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    await act(async () => {
      document.body.dispatchEvent(new Event("scroll"));
    });

    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).toBeNull();
  });

  it("dismisses when the user clicks outside the bubble", async () => {
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });
    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).not.toBeNull();

    // The dismissable layer arms its listener on the next macrotask so the
    // interaction that opened the bubble cannot dismiss it, and it defers the
    // dismissal of a primary click until that click completes. So the outside
    // interaction has to be a full click, not a lone pointerdown.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      for (const type of ["pointerdown", "pointerup", "click"]) {
        outside.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true }));
      }
      outside.remove();
    });

    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).toBeNull();
  });

  it("shows a destructive stop control while streaming and a neutral retry afterwards", async () => {
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });
    const requestId = (mocks.client.translateSelection.mock.calls[0]?.[0] as { requestId: string }).requestId;

    await act(async () => {
      emit({ phase: "start", requestId, targetLanguage: "zh-CN" });
    });
    const stop = document.querySelector('[aria-label="translationStop"]');
    expect(stop).not.toBeNull();
    expect(stop!.className).toContain("text-red-600");
    expect(document.querySelector('[aria-label="translationRetry"]')).toBeNull();

    await act(async () => {
      emit({ phase: "done", requestId, text: "你好世界", targetLanguage: "zh-CN" });
    });
    expect(document.querySelector('[aria-label="translationStop"]')).toBeNull();
    const retry = document.querySelector('[aria-label="translationRetry"]');
    expect(retry).not.toBeNull();
    expect(retry!.className).not.toContain("red");
  });

  it("offers the language options above the original and the translation in the panel", async () => {
    const element = await renderHarness("Hello world", { panel: true });
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });
    const requestId = (mocks.client.translateSelection.mock.calls[0]?.[0] as { requestId: string }).requestId;
    await act(async () => {
      emit({ phase: "done", requestId, text: "你好世界", targetLanguage: "zh-CN" });
    });

    const text = document.body.textContent ?? "";
    const languageAt = text.indexOf("日本語");
    const originalAt = text.indexOf("translationOriginal");
    const resultAt = text.indexOf("translationResult");
    expect(languageAt).toBeGreaterThanOrEqual(0);
    expect(languageAt).toBeLessThan(originalAt);
    expect(originalAt).toBeLessThan(resultAt);
  });

  it("marks the entry being read in the session history", async () => {
    const element = await renderHarness("Hello world", { panel: true });
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });

    const history = document.querySelector('[aria-current="true"]');
    expect(history).not.toBeNull();
    expect(history!.textContent).toContain("Hello world");
    // Each row carries the language and the time it was started.
    expect(history!.textContent).toContain("简体中文");
  });

  it("stops the request when the bubble is closed", async () => {
    const element = await renderHarness("Hello world");
    await openMenuWithSelection(element);
    await act(async () => {
      press(translateItem());
    });
    const requestId = (mocks.client.translateSelection.mock.calls[0]?.[0] as { requestId: string }).requestId;

    const close = document.querySelector<HTMLElement>('[aria-label="translationClose"]');
    expect(close).not.toBeNull();
    await act(async () => {
      close!.click();
    });

    expect(mocks.client.abortTranslation).toHaveBeenCalledWith(requestId);
    expect(document.querySelector('[aria-label="translationBubbleLabel"]')).toBeNull();
  });
});

describe("missing desktop bridge", () => {
  // `WorkbenchShell` renders unconditionally, including when the preload bridge
  // is missing, so the provider must not introduce a throw-on-mount path: it
  // used to call `useRuntimeClient`, which throws in exactly that state.
  it("still renders its children and reports translation as unavailable", async () => {
    mocks.bridgeAvailable = false;
    const observed: (ReturnType<typeof useTranslation>)[] = [];
    function Probe() {
      observed.push(useTranslation());
      return <span data-probe>workbench content</span>;
    }
    const container = document.getElementById("root")!;
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <TranslationProvider onOpenSettings={() => {}} onRevealPanel={() => {}} sessionId="session-1">
            <Probe />
          </TranslationProvider>
        </StrictMode>,
      );
    });

    expect(container.querySelector("[data-probe]")).not.toBeNull();
    expect(observed.at(-1)).toBeNull();
  });
});

describe("real pointer interaction", () => {
  async function renderMessage(text: string): Promise<HTMLElement> {
    const container = document.getElementById("root")!;
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <TooltipProvider>
            <TranslationProvider onOpenSettings={() => {}} onRevealPanel={() => {}} sessionId="session-1">
              <article><MessageSelectionMenu className="message-markdown min-w-0"><MessageMarkdown text={text} /></MessageSelectionMenu></article>
            </TranslationProvider>
          </TooltipProvider>
        </StrictMode>,
      );
    });
    const element = container.querySelector<HTMLElement>(".message-markdown");
    if (!element) throw new Error("MessageMarkdown did not render its root element");
    return element;
  }

  it("opens the menu for a double-clicked word when the right click lands beside it", async () => {
    // Chromium clears the selection when the right button goes down away from
    // it, which is the normal case for a one-word double-click selection.
    const element = await renderMessage("Hello world again");
    const paragraph = element.querySelector("p")!;
    await userEvent.dblClick(paragraph);
    expect(window.getSelection()?.toString()).toBe("again");

    await userEvent.click(element, { button: "right", position: { x: 4, y: 8 } } as never);

    const menu = document.querySelector('[role="menu"]');
    expect(menu, "the remembered selection should still open the menu").not.toBeNull();
    expect(menu!.textContent).toContain("selectionCopy");
  });

  it("does not reuse a remembered selection for a right click in another paragraph", async () => {
    const element = await renderMessage("First paragraph\n\nSecond paragraph");
    const paragraphs = element.querySelectorAll("p");
    await userEvent.dblClick(paragraphs[0]!);
    expect(window.getSelection()?.toString()).not.toBe("");

    await userEvent.click(paragraphs[1]!, { button: "right" } as never);

    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("forgets the selection once the user clicks without selecting", async () => {
    const element = await renderMessage("Hello world again");
    const paragraph = element.querySelector("p")!;
    await userEvent.dblClick(paragraph);
    // A plain click collapses the selection, so the memory must be dropped.
    await userEvent.click(paragraph);
    expect(window.getSelection()?.isCollapsed).toBe(true);

    await userEvent.click(element, { button: "right", position: { x: 4, y: 8 } } as never);

    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("selection menu coverage", () => {
  // The menu used to wrap rendered markdown only, so user messages, tool output,
  // and error details - all rendered as plain text - had no right-click actions
  // at all. It now wraps the whole thread surface instead.
  it("offers the menu for plain text that is not rendered as markdown", async () => {
    const container = document.getElementById("root")!;
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <TooltipProvider>
            <MessageSelectionMenu className="thread-surface">
              <div className="message-markdown min-w-0"><MessageMarkdown text="Assistant reply" /></div>
              <span className="whitespace-pre-wrap">Plain user message</span>
            </MessageSelectionMenu>
          </TooltipProvider>
        </StrictMode>,
      );
    });
    const surface = container.querySelector<HTMLElement>(".thread-surface")!;
    const plain = surface.querySelector("span")!;
    const range = document.createRange();
    range.selectNodeContents(plain);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    await act(async () => {
      plain.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });

    const menu = document.querySelector('[role="menu"]');
    expect(menu, "plain text should offer the selection menu").not.toBeNull();
    expect(menu!.textContent).toContain("selectionCopy");
  });

  it("does not lay out a wrapper of its own", async () => {
    const container = document.getElementById("root")!;
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <TooltipProvider>
            <MessageSelectionMenu style={{ display: "contents" }}>
              <div data-child><MessageMarkdown text="Reply" /></div>
            </MessageSelectionMenu>
          </TooltipProvider>
        </StrictMode>,
      );
    });
    // `display: contents` keeps the trigger out of the layout box tree, so the
    // thread and its virtualized scroller render exactly as before. It is set
    // inline, so the guarantee does not depend on the stylesheet being loaded.
    const trigger = container.querySelector('[data-wordless-selection-surface]');
    expect(trigger).not.toBeNull();
    expect(getComputedStyle(trigger!).display).toBe("contents");
    expect(container.querySelector("[data-child]")).not.toBeNull();
  });
});
