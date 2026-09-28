import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineComposerAttachment, InlineSkillComposerHandle } from "../src/renderer/features/thread/InlineSkillComposer.tsx";

/**
 * 输入框里那两种附件(chip)的进出。
 *
 * 这一层只有真挂上组件才验得出来:Lexical 的节点必须**同时**声明类并在 `initialConfig.nodes` 里
 * 注册,漏了注册不会在类型检查里露头 —— 表现是运行时一句
 * "Attempted to create node ThemeTokenNode that was not configured to be used on the editor"。
 * 这正是这条用例存在的原因(写它之前,插入令牌那条路没有任何测试走到)。
 *
 * 验的是三件事:插得进去、读得回来(part 的形状)、摘得掉。
 */

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ locale: "en-US", t: (key: string): string => key }),
}));

const { InlineSkillComposer } = await import("../src/renderer/features/thread/InlineSkillComposer.tsx");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN: InlineComposerAttachment = {
  kind: "theme-token",
  name: "--color-primary",
  path: "meadow.wdesign/theme.css",
  value: "#4f46e5",
};

const FILE: InlineComposerAttachment = {
  kind: "file",
  name: "Index",
  path: "meadow.wdesign/frames/index.html",
};

describe("输入框附件", () => {
  let container: HTMLDivElement;
  let root: Root;
  let handle: ReturnType<typeof createRef<InlineSkillComposerHandle>>;
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    handle = createRef<InlineSkillComposerHandle>();
    onChange = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <InlineSkillComposer
          ariaLabel="Message"
          className=""
          onChange={onChange}
          onSubmit={() => {}}
          placeholder="Write a message"
          ref={handle}
        />,
      );
    });
  }

  /** 最后一次上报的 parts —— 输入框的真实内容就是它。 */
  function lastParts(): readonly { type: string }[] {
    const calls = onChange.mock.calls;
    return (calls.at(-1)?.[0] as { parts: readonly { type: string }[] })?.parts ?? [];
  }

  it("插入一个令牌:不抛,且读回来的 part 带名字与值", async () => {
    await render();

    await act(async () => {
      handle.current?.insertWorkspaceReference(TOKEN);
    });

    expect(lastParts()).toContainEqual({
      type: "theme-token-reference",
      name: "--color-primary",
      path: "meadow.wdesign/theme.css",
      value: "#4f46e5",
    });
  });

  it("只插入一个令牌(没有正文)也要让占位符让开", async () => {
    // 用户点色块之后输入框里只有一个 chip、没有文字。占位符若还留着就会**压在 chip 上** ——
    // "有内容"的判断必须按 part 走,不能靠数几个手写的字段。
    await render();
    expect(container.textContent).toContain("Write a message");

    await act(async () => {
      handle.current?.insertWorkspaceReference(TOKEN);
    });

    expect(container.textContent).not.toContain("Write a message");
  });

  it("插入一个文件引用:走的还是文件那条路", async () => {
    await render();

    await act(async () => {
      handle.current?.insertWorkspaceReference(FILE);
    });

    expect(lastParts()).toContainEqual({
      type: "workspace-reference",
      kind: "file",
      name: "Index",
      path: "meadow.wdesign/frames/index.html",
    });
  });

  it("摘掉一个令牌:part 跟着消失", async () => {
    await render();
    await act(async () => {
      handle.current?.insertWorkspaceReference(TOKEN);
    });
    expect(lastParts()).toContainEqual(expect.objectContaining({ type: "theme-token-reference" }));

    await act(async () => {
      handle.current?.removeAttachment(TOKEN);
    });

    expect(lastParts().some((part) => part.type === "theme-token-reference")).toBe(false);
  });

  it("把一份带令牌的草稿放回输入框(重开会话那条路)", async () => {
    // 这条走的是 `$nodesFromPromptParts`:会话带着草稿重开时,存下来的 part 要变回 chip ——
    // 它和"插入"是两条路,但都要求节点已注册。
    await render();

    await act(async () => {
      handle.current?.setValue([
        { type: "text", text: "Make the button " },
        { type: "theme-token-reference", name: "--color-accent", path: "meadow.wdesign/theme.css", value: "#0ea5e9" },
      ]);
    });

    expect(lastParts()).toContainEqual({
      type: "theme-token-reference",
      name: "--color-accent",
      path: "meadow.wdesign/theme.css",
      value: "#0ea5e9",
    });
  });

  it("摘掉一个没挂上的令牌是空操作,不会顺手带走别的", async () => {
    // 面板上再点一次已挂的令牌就是这条路;它不该把同名的兄弟附件(比如某个同路径的文件引用)也删掉。
    await render();
    await act(async () => {
      handle.current?.insertWorkspaceReference(FILE);
      handle.current?.insertWorkspaceReference(TOKEN);
    });

    await act(async () => {
      handle.current?.removeAttachment({ ...TOKEN, name: "--color-accent" });
    });

    expect(lastParts()).toContainEqual(expect.objectContaining({ type: "theme-token-reference" }));
    expect(lastParts()).toContainEqual(expect.objectContaining({ type: "workspace-reference" }));
  });
});
