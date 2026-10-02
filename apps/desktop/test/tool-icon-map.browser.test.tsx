import { act } from "react";
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

import { workbenchRendererRegistry } from "../src/renderer/features/workbench/renderer-registry";
import extractTextIcon from "../src/icons/common-icons/extract_text_from_image.svg";
import readIcon from "../src/icons/common-icons/read.svg";

/**
 * 工具的**图标映射**是"静默退化"的典型:漏一条映射不会报错、不会警告,
 * 只是那一行工具悄悄变成一个通用的扳手(`Wrench` fallback)——
 * 而 `Wrench` 也是 `<svg>`,不是空白,所以肉眼很容易漏过去。
 *
 * 这条测试从**渲染结果**上钉住这件事:`standardToolIconSources` 是模块私有的,
 * 从外面 import 不到,所以唯一可信的观测点就是渲染出来的 DOM ——
 * 映射命中是一个 `src` 指向该 SVG 资产的 `<img>`,没命中就是那个 `<svg>` 扳手。
 *
 * 注意 `src` 在测试环境里是**内联的 data URL**(vite 把 SVG 资产内联了),所以断言用的是
 * "同一个 import 出来的值",而不是文件名 —— 文件名并不出现在 URL 里。
 */

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

function toolBlock(name: string): MessageToolBlock {
  return {
    type: "tool",
    callId: `call-${name}`,
    name,
    input: {},
    output: "done",
    state: "complete",
  };
}

async function renderTool(name: string): Promise<void> {
  const ToolActivity = workbenchRendererRegistry.resolveTool("conversation", name);
  const root = createRoot(document.querySelector("#root")!);
  roots.push(root);
  await act(async () => {
    root.render(
      <TooltipProvider>
        <ToolActivity block={toolBlock(name)} />
      </TooltipProvider>,
    );
  });
}

describe("工具图标映射", () => {
  it("extract_text_from_image 用的是我们给它的那个图标,而不是通用扳手", async () => {
    await renderTool("extract_text_from_image");

    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toBe(extractTextIcon);
    expect(image?.getAttribute("src")).not.toBe(readIcon);
  });

  it("它和同目录的图标一样,在深色模式下反色(否则深底上就是个黑块)", async () => {
    await renderTool("extract_text_from_image");
    expect(document.querySelector("img")?.className).toContain("dark:invert");
  });

  it("对照:`read` 走的是同一条路(映射命中就是这个形状)", async () => {
    await renderTool("read");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(readIcon);
  });

  it("对照:没有映射的工具回落到 <svg> 扳手 —— 证明上面几条不是恒真", async () => {
    await renderTool("definitely_not_a_mapped_tool");

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
