import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto } from "@wordless/protocol";
import {
  activityKindForTool,
  activitySettlement,
  activityTargets,
  designRelativePath,
  frameIdOfRelativePath,
  FRAME_ACTIVITY_VISUALS,
  remainingHoldMs,
  toolPathOf,
  MIN_ACTIVITY_MS,
} from "../src/renderer/features/design/frame-activity.ts";

/**
 * agent 的活动态投影。
 *
 * 这是画布上"agent 在干什么"的**唯一证据**:位图是磁盘的快照,而工具调用是磁盘将要变的
 * 那件事。粒子亮错了帧看不出对错(它就是一层动画),所以每条判断都在这里钉住。
 */

function frame(id: string): DesignFrameDto {
  return { id, file: `frames/${id}.html`, x: 0, y: 0, width: 390, height: 844, title: id };
}

const FRAMES = [frame("index"), frame("login")];
const DESIGN = "meadow.wdesign";

test("工具名映射到活动态 —— 写一个新帧是创作,不是修改", () => {
  assert.equal(activityKindForTool("read"), "reading");
  assert.equal(activityKindForTool("edit"), "modifying");
  assert.equal(activityKindForTool("write"), "creating");
  // 认不出的工具不点亮:猜错方向比不亮更糟。
  assert.equal(activityKindForTool("bash"), null);
  assert.equal(activityKindForTool("design_screenshot"), null);
});

test("路径从工具参数里取,键名来自各工具自己的 schema", () => {
  assert.equal(toolPathOf({ path: "a/b.html" }), "a/b.html");
  assert.equal(toolPathOf({ file_path: "a/b.html" }), "a/b.html");
  assert.equal(toolPathOf({}), null);
  assert.equal(toolPathOf({ path: "" }), null);
  assert.equal(toolPathOf(undefined), null);
});

test("绝对路径与工作区相对路径都定位到同一份设计", () => {
  // 这是关键:`read` 拿到的可能是相对工作区根的路径,也可能是主进程给的绝对路径。
  // 只认一种的话,另一种下的活动态全部不亮,而画布看起来"什么都没发生"。
  assert.equal(designRelativePath({ path: "meadow.wdesign/frames/index.html", designName: DESIGN }), "frames/index.html");
  assert.equal(
    designRelativePath({ path: "/w/meadow.wdesign/frames/index.html", designName: DESIGN }),
    "frames/index.html",
  );
  assert.equal(designRelativePath({ path: "C:\\w\\meadow.wdesign\\theme.css", designName: DESIGN }), "theme.css");
  // 另一个设计、或包外的东西:不点亮。
  assert.equal(designRelativePath({ path: "/w/other.wdesign/frames/index.html", designName: DESIGN }), null);
  assert.equal(designRelativePath({ path: "/w/notes/readme.md", designName: DESIGN }), null);
});

test("改某一帧只点亮那一帧", () => {
  assert.deepEqual(
    activityTargets({ path: "meadow.wdesign/frames/login.html", designName: DESIGN, frames: FRAMES }),
    ["login"],
  );
});

test("改共享件点亮全部帧 —— theme.css 一改每一帧都变", () => {
  for (const path of ["meadow.wdesign/theme.css", "meadow.wdesign/assets/logo.svg"]) {
    assert.deepEqual(
      activityTargets({ path, designName: DESIGN, frames: FRAMES }),
      ["index", "login"],
      path,
    );
  }
});

test("包外的路径什么都不点亮", () => {
  assert.deepEqual(activityTargets({ path: "src/app.tsx", designName: DESIGN, frames: FRAMES }), []);
});

test("帧只在 frames/ 的直接子文件里认", () => {
  assert.equal(frameIdOfRelativePath("frames/index.html"), "index");
  assert.equal(frameIdOfRelativePath("theme.css"), null);
  // 嵌套目录不是一帧 —— 认了它会点亮一个不存在的 id。
  assert.equal(frameIdOfRelativePath("frames/sub/index.html"), null);
  assert.equal(frameIdOfRelativePath("frames/style.css"), null);
});

test("活干得比人眼快时,收场要等够最短停留", () => {
  // 工具调用常常不到一秒就返回。不补这一段,整段活动态就只是闪一下 —— 而那等于没有。
  assert.equal(remainingHoldMs(1_000, 1_200), MIN_ACTIVITY_MS - 200);
  assert.equal(remainingHoldMs(1_000, 1_000 + MIN_ACTIVITY_MS + 500), 0);
});

test("读与出错直接消失,改与写翻成已更新", () => {
  const at = { startedAt: 1_000, now: 1_000 + MIN_ACTIVITY_MS };

  // 读没有改动任何东西 —— 翻成"已更新"会让人以为它改过。
  assert.deepEqual(activitySettlement({ kind: "reading", isError: false, ...at }), { result: "clear", delayMs: 0 });
  // 出错的调用同样没改成,而且不该留下任何痕迹。
  assert.deepEqual(activitySettlement({ kind: "modifying", isError: true, ...at }), { result: "clear", delayMs: 0 });
  assert.deepEqual(activitySettlement({ kind: "creating", isError: false, ...at }), { result: "updated", delayMs: 0 });

  // 还没到最短停留:延后收场,而不是提前清掉。
  const early = activitySettlement({ kind: "modifying", isError: false, startedAt: 1_000, now: 1_100 });
  assert.equal(early.result, "updated");
  assert.equal(early.delayMs, MIN_ACTIVITY_MS - 100);
});

test("每个活动态都有颜色与文案 —— 色相同时承担语义", () => {
  for (const kind of ["reading", "modifying", "creating", "updated"] as const) {
    const visual = FRAME_ACTIVITY_VISUALS[kind];
    assert.match(visual.color, /^#[0-9a-f]{6}$/, kind);
    assert.ok(visual.labelKey.length > 0, kind);
  }
  // 四态四色:两种状态同色的话,描边就说不出"它在干什么"了。
  const colors = new Set(Object.values(FRAME_ACTIVITY_VISUALS).map((visual) => visual.color));
  assert.equal(colors.size, 4);
});
