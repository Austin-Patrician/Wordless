import { expect, it } from "vitest";
import { createDesignTools } from "../src/index.ts";
import type { DesignFactsDto, DesignPort } from "../src/port.ts";

const DESIGN = "/w/meadow.wdesign";

function facts(overrides: Partial<DesignFactsDto> = {}): DesignFactsDto {
  return {
    path: DESIGN,
    name: "meadow",
    mode: "static",
    style: "linear",
    hasDesignDoc: true,
    frames: [
      { id: "index", title: "Home", file: "frames/index.html", declaredSize: true, fileExists: true },
    ],
    ...overrides,
  };
}

function port(overrides: Partial<DesignPort> = {}): DesignPort {
  return {
    list: async () => [{ path: DESIGN, name: "meadow", frameCount: 1 }],
    read: async () => facts(),
    create: async () => ({ path: DESIGN, frameId: "index" }),
    screenshot: async () => ({ ok: true, frameId: "index", mimeType: "image/jpeg", data: "AAAA" }),
    inspect: async () => [],
    ...overrides,
  };
}

function find(tools: ReturnType<typeof createDesignTools>, name: string) {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

async function run(tool: ReturnType<typeof find>, params: unknown) {
  return await (tool.execute as unknown as (id: string, params: unknown) => Promise<{ content: unknown[]; details?: unknown }>)(
    "call-1",
    params,
  );
}

function textOf(result: { content: unknown[] }): string {
  return result.content
    .map((part) => (part as { type: string; text?: string }).text ?? "")
    .join("\n");
}

it("只声明已经能跑的工具", () => {
  // 声明了却跑不起来的工具比没有更糟:模型会去调它,然后拿到一个失败。
  const names = createDesignTools(port()).map((tool) => tool.name);
  expect(names).toEqual(["design_status", "design_create", "design_inspect", "design_screenshot"]);
});

it("工作区里没有设计时给出下一步,而不是空输出", () => {
  const tool = find(createDesignTools(port({ list: async () => [] })), "design_status");
  return run(tool, {}).then((result) => {
    expect(textOf(result)).toContain("design_create");
  });
});

it("只有一份设计时直接读它,省掉一轮往返", async () => {
  const result = await run(find(createDesignTools(port()), "design_status"), {});
  const text = textOf(result);
  expect(text).toContain(DESIGN);
  expect(text).toContain("index");
  expect(text).toContain("Home");
});

it("有多份设计时列出来让模型选,而不是替它挑一份", async () => {
  // 挑错了它会去改另一份设计 —— 比多一轮往返糟得多。
  const tool = find(
    createDesignTools(
      port({
        list: async () => [
          { path: "/w/a.wdesign", name: "a", frameCount: 2 },
          { path: "/w/b.wdesign", name: "b", frameCount: 3 },
        ],
      }),
    ),
    "design_status",
  );
  const text = textOf(await run(tool, {}));
  expect(text).toContain("/w/a.wdesign");
  expect(text).toContain("/w/b.wdesign");
  expect(text).toContain("Pass the one you mean");
});

it("给了路径但不是设计包时照实说", async () => {
  const tool = find(createDesignTools(port({ read: async () => null })), "design_status");
  const text = textOf(await run(tool, { path: "/w/notes" }));
  expect(text).toContain("not a design package");
});

it("状态里列出问题,并在有阻塞时明说没完成", async () => {
  const tool = find(
    createDesignTools(
      port({
        read: async () =>
          facts({
            frames: [
              { id: "index", title: "Home", file: "frames/index.html", declaredSize: false, fileExists: true },
            ],
          }),
      }),
    ),
    "design_status",
  );
  const text = textOf(await run(tool, { path: DESIGN }));
  expect(text).toContain("[frame-size-missing]");
  // 不阻塞:帧仍然上画布,只是靠兜底尺寸。措辞不能把它说成"没完成"。
  expect(text).toContain("No blocking problems");
  expect(text).toContain("screenshot");
});

it("状态里报出阻塞问题", async () => {
  const tool = find(
    createDesignTools(
      port({
        read: async () =>
          facts({
            frames: [{ id: "gone", title: "Gone", file: "frames/gone.html", declaredSize: true, fileExists: false }],
          }),
      }),
    ),
    "design_status",
  );
  expect(textOf(await run(tool, { path: DESIGN }))).toContain("Not finished yet");
});

it("建包之后告诉模型接下来要读什么", async () => {
  const tool = find(createDesignTools(port()), "design_create");
  const result = await run(tool, { name: "meadow", title: "Home", width: 390, height: 844 });
  const text = textOf(result);
  expect(text).toContain("theme.css");
  expect(text).toContain("@frame");
  expect(text).toContain("390×844");
});

it("建包失败时不装作成功", async () => {
  const tool = find(createDesignTools(port({ create: async () => null })), "design_create");
  const result = await run(tool, { name: "x", title: "t", width: 1, height: 1 });
  expect(textOf(result)).toContain("Could not create");
  expect((result.details as { created: boolean }).created).toBe(false);
});

it("布局检查为空时不说'看起来没问题'", async () => {
  // 已知形状都没有 ≠ 设计是对的。措辞上必须把这两件事分开,否则模型会跳过截图。
  const tool = find(createDesignTools(port()), "design_inspect");
  const text = textOf(await run(tool, { path: DESIGN }));
  expect(text).toContain("not the same as looking right");
  expect(text).toContain("screenshot");
});

it("布局检查列出问题并给出坐标事实", async () => {
  const tool = find(
    createDesignTools(
      port({
        inspect: async () => [
          { kind: "overflow-x", selector: "div.card", detail: "content is 24px wider than its box and the box does not clip" },
        ],
      }),
    ),
    "design_inspect",
  );
  const text = textOf(await run(tool, { path: DESIGN }));
  expect(text).toContain("Found 1 layout problem");
  expect(text).toContain("[overflow-x] div.card");
});

it("不给 frameIds 时检查全部帧", async () => {
  const seen: string[][] = [];
  const tool = find(
    createDesignTools(
      port({
        read: async () =>
          facts({
            frames: [
              { id: "a", title: "A", file: "frames/a.html", declaredSize: true, fileExists: true },
              { id: "b", title: "B", file: "frames/b.html", declaredSize: true, fileExists: true },
            ],
          }),
        inspect: async (_path, frameIds) => {
          seen.push([...frameIds]);
          return [];
        },
      }),
    ),
    "design_inspect",
  );
  await run(tool, { path: DESIGN });
  expect(seen).toEqual([["a", "b"]]);
});

it("截图把像素交给模型,并提醒看像素而不是看标记", async () => {
  const tool = find(createDesignTools(port()), "design_screenshot");
  const result = await run(tool, { path: DESIGN, frameId: "index" });
  const image = result.content.find((part) => (part as { type: string }).type === "image") as
    | { data: string; mimeType: string }
    | undefined;
  expect(image?.mimeType).toBe("image/jpeg");
  expect(image?.data).toBe("AAAA");
  expect(textOf(result)).toContain("not at the markup");
});

it("截图失败时给出原因,而不是空图片", async () => {
  const tool = find(
    createDesignTools(port({ screenshot: async () => ({ ok: false, frameId: "index", reason: "load-failed" }) })),
    "design_screenshot",
  );
  const result = await run(tool, { path: DESIGN, frameId: "index" });
  expect(textOf(result)).toContain("load-failed");
  expect(result.content.some((part) => (part as { type: string }).type === "image")).toBe(false);
});
