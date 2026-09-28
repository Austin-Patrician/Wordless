import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto } from "@wordless/protocol";
import { arrangeFrames, arrangeRequires } from "../src/renderer/features/design/arrange.ts";

/**
 * 对齐与分布。
 *
 * 它是这一层里**唯一不需要新 IPC** 的编辑动作(只改清单里的 x/y,走已有的 `moveDesignFrames`),
 * 也是"画布从只能看变成能做版面"里最便宜的一步。算错的表现是"帧跑到了一个说不通的位置" ——
 * 既不像崩溃也不像空白,所以每条都在这里钉住。
 */

function frame(id: string, x: number, y: number, width = 100, height = 50): DesignFrameDto {
  return { file: `frames/${id}.html`, height, id, title: id, width, x, y };
}

function arrange(frames: DesignFrameDto[], selectedFrameIds: string[], mode: Parameters<typeof arrangeFrames>[0]["mode"]) {
  return arrangeFrames({ frames, mode, selectedFrameIds });
}

test("对齐的基准是被选中的那批的包围盒,不是整个画布", () => {
  const frames = [frame("a", 0, 0), frame("b", 200, 100), frame("c", 9999, 0)];
  // c 没有被选中 —— 它在很远的地方,绝不能把基准拉过去。
  assert.deepEqual(arrange(frames, ["a", "b"], "left"), [{ frameId: "b", x: 0, y: 100 }]);

  // 而右/底对齐才**真的**钉住这条:未选中的 c 在很远的地方,如果基准取的是整个画布,
  // 被选中的帧会被推到 10099 附近去。上面那条左对齐在两种实现下碰巧结果相同(a 本来就是
  // 最左那一帧),所以它单独不足以覆盖这条规则。
  // 选中集 a(0..100) 与 b(200..300) → 包围盒 0..300 → 右对齐把 a 推到 200。
  // 若基准取整个画布(0..10099),两个都会被推到 9999 附近。
  assert.deepEqual(arrange(frames, ["a", "b"], "right"), [{ frameId: "a", x: 200, y: 0 }]);
  const column = [frame("a", 0, 0), frame("b", 200, 100), frame("c", 0, 9999)];
  // 选中集高 0..150 → 底对齐把 a 推到 y=100。
  assert.deepEqual(arrange(column, ["a", "b"], "bottom"), [{ frameId: "a", x: 0, y: 100 }]);
});

test("左/右/水平居中都对着包围盒,而不是彼此", () => {
  const frames = [frame("a", 0, 0, 100), frame("b", 200, 0, 40)];
  // 包围盒 0..240。右对齐 → b 的右边缘贴到 240 → x = 200(本来就在那,不该被返回)。
  assert.deepEqual(arrange(frames, ["a", "b"], "right"), [{ frameId: "a", x: 140, y: 0 }]);
  // 水平居中:中心 120 → a 的 x = 120-50 = 70,b 的 x = 120-20 = 100。
  assert.deepEqual(arrange(frames, ["a", "b"], "center-h"), [
    { frameId: "a", x: 70, y: 0 },
    { frameId: "b", x: 100, y: 0 },
  ]);
});

test("上/下/垂直居中对纵轴生效", () => {
  const frames = [frame("a", 0, 0, 100, 100), frame("b", 0, 300, 100, 40)];
  assert.deepEqual(arrange(frames, ["a", "b"], "top"), [{ frameId: "b", x: 0, y: 0 }]);
  assert.deepEqual(arrange(frames, ["a", "b"], "bottom"), [{ frameId: "a", x: 0, y: 240 }]);
  // 包围盒 0..340,中心 170 → a 的 y = 170-50 = 120,b 的 y = 170-20 = 150。
  assert.deepEqual(arrange(frames, ["a", "b"], "middle"), [
    { frameId: "a", x: 0, y: 120 },
    { frameId: "b", x: 0, y: 150 },
  ]);
});

test("只返回真的动了的帧 —— 提交一批没变的位置会让清单白写一次", () => {
  const frames = [frame("a", 0, 0), frame("b", 0, 0)];
  // 两帧本来就左对齐:结果为空,调用方据此不发 IPC。
  assert.deepEqual(arrange(frames, ["a", "b"], "left"), []);
});

test("分布让**空隙**相等,而不是让起点等距", () => {
  // 宽度不同。包围盒 = 0 .. (480+100) = 580,总宽 580,帧本身占 120+40+100 = 260,
  // 于是两段空隙各 (580-260)/2 = 160。
  const frames = [frame("a", 0, 0, 120), frame("b", 200, 0, 40), frame("c", 480, 0, 100)];
  const out = arrange(frames, ["a", "b", "c"], "distribute-h");
  // 首尾不动:b 落到 0+120+160 = 280,而 c 正好接在 280+40+160 = 480。
  // 如果实现是"起点等距"(不看宽度),这里会得到 290。
  assert.deepEqual(out, [{ frameId: "b", x: 280, y: 0 }]);
});

test("垂直分布同理", () => {
  const frames = [frame("a", 0, 0, 100, 100), frame("b", 0, 150, 100, 100), frame("c", 0, 500, 100, 100)];
  const out = arrange(frames, ["a", "b", "c"], "distribute-v");
  // 包围盒 0..600,高度 600;帧占 300 → 两段空隙各 150 → b 落到 0+100+150 = 250。
  assert.deepEqual(out, [{ frameId: "b", x: 0, y: 250 }]);
});

test("分布按坐标排序,不按清单顺序 —— 顺序错了会把帧左右对调", () => {
  const frames = [frame("c", 480, 0, 100), frame("a", 0, 0, 100), frame("b", 200, 0, 100)];
  const out = arrange(frames, ["a", "b", "c"], "distribute-h");
  assert.deepEqual(out, [{ frameId: "b", x: 240, y: 0 }]);
});

test("帧太少时什么都不做", () => {
  const one = [frame("a", 0, 0)];
  assert.deepEqual(arrange(one, ["a"], "left"), []);
  // 两帧之间没有"间距"可言,所以分布要三帧。
  const two = [frame("a", 0, 0), frame("b", 200, 0)];
  assert.deepEqual(arrange(two, ["a", "b"], "distribute-h"), []);
  assert.equal(arrangeRequires("left"), 2);
  assert.equal(arrangeRequires("distribute-h"), 3);
  assert.equal(arrangeRequires("distribute-v"), 3);
});
