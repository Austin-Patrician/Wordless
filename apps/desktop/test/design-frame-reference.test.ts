import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto } from "@wordless/protocol";
import {
  frameReference,
  themeReference,
  themeTokenSelection,
  workspaceRelativePath,
} from "../src/renderer/features/design/frame-reference.ts";

/**
 * 画布上的一帧 → 对话里的一个引用。
 *
 * 这里只有一件事会错,而错了以后**看起来完全正常**:路径的基准。agent 的文件工具以工作区根
 * 为准,而画布手上的路径是绝对的 —— 两边基准不同时,输入框里那个引用长得一模一样,而 agent
 * 读不到那个文件。所以换算单独成文件、单独验。
 */

function frame(id: string, title = id): DesignFrameDto {
  return { file: `frames/${id}.html`, height: 844, id, title, width: 390, x: 0, y: 0 };
}

test("绝对路径换算成工作区相对路径", () => {
  assert.equal(workspaceRelativePath("/w/meadow.wdesign/frames/index.html", "/w"), "meadow.wdesign/frames/index.html");
  // Windows 的反斜杠与尾斜杠都要归一化。
  assert.equal(workspaceRelativePath("C:\\w\\meadow.wdesign\\frames\\index.html", "C:/w/"), "meadow.wdesign/frames/index.html");
});

test("同名前缀的兄弟目录不算在工作区内", () => {
  // 这条是"带上分隔符再比"的理由:不带的话 `/w/designs-alpha` 会被当成 `/w/designs` 的子路径,
  // 于是一个**不在工作区里**的设计包得到一条看似正常的引用。
  assert.equal(workspaceRelativePath("/w/designs-alpha/x.wdesign/a.html", "/w/designs"), null);
  assert.equal(workspaceRelativePath("/other/x.wdesign/a.html", "/w"), null);
});

test("路径就是根、或者根本取不出来时返回 null", () => {
  assert.equal(workspaceRelativePath("/w", "/w"), "");
  assert.equal(workspaceRelativePath("/w/a.html", ""), null);
});

test("引用用**帧标题**当名字,路径才是给 agent 的", () => {
  const reference = frameReference({ designPath: "/w/meadow.wdesign", frame: frame("index", "首页"), workspaceRoot: "/w" });

  // 名字在输入框里给人看,而标题正是画布上那块画板的标签 —— 用文件名的话用户还得自己翻译。
  assert.deepEqual(reference, { kind: "file", name: "首页", path: "meadow.wdesign/frames/index.html" });
});

test("设计包不在工作区内时给不出引用,而不是给一条 agent 打不开的路径", () => {
  assert.equal(frameReference({ designPath: "/other/meadow.wdesign", frame: frame("index"), workspaceRoot: "/w" }), null);
  // 没有工作区的会话(设计包在会话私有根里)同理:基准不存在,换算无从谈起。
  assert.equal(frameReference({ designPath: "/w/meadow.wdesign", frame: frame("index"), workspaceRoot: null }), null);
});

test("色彩系统面板挂的是**令牌**,不是整份 theme.css", () => {
  /*
    用户看到一块颜色,他说不出 `--color-primary` 这个名字 —— 而面板唯一能替他说的事就是这个。
    路径仍指向 theme.css(那是改它的地方),名字与值取令牌本身。
  */
  assert.deepEqual(
    themeReference({
      designPath: "/w/meadow.wdesign",
      token: { name: "--color-primary", value: "#6366f1" },
      workspaceRoot: "/w",
    }),
    { kind: "theme-token", name: "--color-primary", path: "meadow.wdesign/theme.css", value: "#6366f1" },
  );
});

test("点一个令牌:没挂就挂上,已挂就摘掉", () => {
  // 这段判断是交互的全部语义 —— 画布上点一下到底是"选了"还是"取消了",只看输入框里挂着什么。
  assert.equal(themeTokenSelection([], "--color-primary"), "attach");
  assert.equal(themeTokenSelection(["--color-accent"], "--color-primary"), "attach");
  assert.equal(themeTokenSelection(["--color-primary"], "--color-primary"), "detach");
});

test("令牌引用同样遵循「取不出来就不给」:不在工作区内、没有工作区都返回 null", () => {
  const token = { name: "--color-primary", value: "#6366f1" };
  assert.equal(themeReference({ designPath: "/other/meadow.wdesign", token, workspaceRoot: "/w" }), null);
  assert.equal(themeReference({ designPath: "/w/meadow.wdesign", token, workspaceRoot: null }), null);
});
