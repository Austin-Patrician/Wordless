import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageToolBlock } from "@wordless/domain";
import { TooltipProvider } from "@wordless/ui-kit";

vi.mock("../src/renderer/shared/runtime", () => {
  const client = { openExternalUrl: async () => {} };
  return { useRuntimeClient: () => client };
});

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    locale: "en-US",
    reduceMotion: true,
    t: (key: string) => key,
  }),
}));

import { MessageMarkdown } from "../src/renderer/features/thread/MessageMarkdown";
import { workbenchRendererRegistry } from "../src/renderer/features/workbench/renderer-registry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function ProductionRow({ streaming, text, tool }: { streaming: boolean; text: string; tool?: MessageToolBlock }) {
  const ToolActivity = tool
    ? workbenchRendererRegistry.resolveTool("conversation", tool.name)
    : null;
  return (
    <TooltipProvider>
      <article data-production-row>
        <MessageMarkdown streaming={streaming} text={text} />
        {ToolActivity && tool ? <ToolActivity block={tool} /> : null}
      </article>
    </TooltipProvider>
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

describe("production thread row performance", () => {
  it("continues streaming commits when mounted under StrictMode", async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    let text = "initial";
    await act(async () => {
      root.render(
        <StrictMode>
          <ProductionRow streaming text={text} />
        </StrictMode>,
      );
      await delay(20);
    });

    text += " followed by a streamed update";
    await act(async () => {
      root.render(
        <StrictMode>
          <ProductionRow streaming text={text} />
        </StrictMode>,
      );
      await delay(100);
    });

    expect(document.querySelector(".message-markdown")?.textContent).toContain(
      "followed by a streamed update",
    );
  });

  it("rerenders a completed Mermaid block after the row is recycled", async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    const text = "```mermaid\ngraph TD\n  A[Session] --> B[Rendered]\n```";
    await act(async () => {
      root.render(<StrictMode><ProductionRow streaming={false} text={text} /></StrictMode>);
      await delay(300);
    });
    expect(document.querySelector(".message-mermaid-svg svg")).not.toBeNull();

    await act(async () => {
      root.render(<div />);
      await delay(20);
      root.render(<StrictMode><ProductionRow streaming={false} text={text} /></StrictMode>);
      await delay(300);
    });
    expect(document.querySelector(".message-mermaid-svg svg")).not.toBeNull();
  });

  it("keeps HTML previews opt-in and sandboxed", async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    const text = "```html\n<div data-preview>Safe preview</div><script>document.body.dataset.executed = 'yes'</script>\n```";
    await act(async () => {
      root.render(<ProductionRow streaming={false} text={text} />);
      await delay(40);
    });
    expect(document.querySelector("iframe")).toBeNull();
    const previewButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Preview");
    expect(previewButton).not.toBeUndefined();
    await act(async () => {
      previewButton?.click();
      await delay(40);
    });
    const frame = document.querySelector<HTMLIFrameElement>("iframe");
    expect(frame?.sandbox.value).toBe("");
    expect(frame?.srcdoc).toContain("Content-Security-Policy");
    expect(document.body.dataset.executed).toBeUndefined();
  });

  it("keeps a long streaming response visible before the terminal event", async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    let text = "";
    await act(async () => {
      root.render(<ProductionRow streaming text={text} />);
      await delay(20);
    });

    for (let index = 0; index < 24; index += 1) {
      text += `chunk ${index} ${"streaming content ".repeat(700)}\n`;
      await act(async () => {
        root.render(<ProductionRow streaming text={text} />);
        await delay(8);
      });
    }
    await act(async () => {
      await delay(180);
    });

    const visible = document.querySelector(".message-markdown")?.textContent ?? "";
    expect(visible).toContain("chunk 23");
    expect(visible.length).toBeGreaterThan(10_000);
    expect(visible).not.toContain("terminal marker");

    text += "\n\nterminal marker\n\n```typescript\nconst completed: string = \"yes\";\n```";
    await act(async () => {
      root.render(<ProductionRow streaming={false} text={text} />);
      await delay(180);
    });
    expect(document.querySelector(".message-markdown")?.textContent).toContain("terminal marker");
    expect(document.querySelector(".message-markdown .hljs-keyword")?.textContent).toBe("const");
  });

  it("limits growing Markdown DOM commits and flushes the complete highlighted result", async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    let text = "Stable opening paragraph.\n\n";
    await act(async () => {
      root.render(<ProductionRow streaming text={text} />);
      await delay(20);
    });
    const row = document.querySelector("[data-production-row]");
    expect(row).not.toBeNull();
    let mutationBatches = 0;
    const observer = new MutationObserver(() => { mutationBatches += 1; });
    observer.observe(document.querySelector(".message-markdown")!, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    for (let index = 0; index < 120; index += 1) {
      text += `streamed token ${index} `;
      await act(async () => {
        root.render(<ProductionRow streaming text={text} />);
        await delay(2);
      });
    }
    text += "\n\n```typescript\nconst completed: string = \"yes\";\n```";
    await act(async () => {
      root.render(<ProductionRow streaming={false} text={text} />);
      await delay(180);
    });
    observer.disconnect();

    expect(document.querySelector(".message-markdown")?.textContent).toContain("streamed token 119");
    expect(document.querySelector(".message-markdown .hljs-keyword")?.textContent).toBe("const");
    expect(document.querySelector("[data-production-row]")).toBe(row);
    expect(mutationBatches).toBeLessThan(40);
  });

  it("keeps a large real tool result collapsed instead of materializing it into the visible DOM", async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    const output = "z".repeat(1_800_000);
    const tool: MessageToolBlock = {
      type: "tool",
      callId: "large-tool",
      name: "bash",
      input: { command: "generate-output" },
      output,
      state: "complete",
    };
    await act(async () => {
      root.render(<ProductionRow streaming={false} text="Tool completed." tool={tool} />);
      await delay(30);
    });

    expect(document.querySelector("[data-production-row]")).not.toBeNull();
    expect(document.body.textContent?.length).toBeLessThan(20_000);
  });
});
