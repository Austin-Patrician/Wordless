import assert from "node:assert/strict";
import test from "node:test";
import { COVER_BOX, coverLayout } from "../src/renderer/features/design/design-cover.ts";

/**
 * 封面几何。
 *
 * 它算的是"每一帧画在哪",而算错的表现是封面**看起来有点歪**:帧没有对齐、或者被裁掉一条边。
 * 那种错在列表里一闪而过,很难靠肉眼发现 —— 所以它住在纯函数里,被这些不变量钉着。
 */

const PHONE = { height: 844, width: 390 };

test("每一帧都完整落在封面里,而且等高对齐", () => {
  const { rects } = coverLayout([PHONE, PHONE, PHONE]);

  assert.equal(rects.length, 3);
  const first = rects[0]!;
  for (const rect of rects) {
    // 不越界:封面不会被裁掉任何一帧。
    assert.ok(rect.x >= 0, `left ${rect.x}`);
    assert.ok(rect.y >= 0, `top ${rect.y}`);
    assert.ok(rect.x + rect.width <= COVER_BOX.width, "右边界");
    assert.ok(rect.y + rect.height <= COVER_BOX.height, "下边界");
    // 等高:几帧排成一行时高度必须一致,否则看起来像"其中一个被拉扁了"。
    assert.equal(rect.height, first.height);
  }
});

test("按最高那一帧归一化 —— 高的那帧决定整行的高度", () => {
  // 一高一矮:矮的那帧等比缩到和高的那帧同高(宽度按比例),而不是各自缩到一样宽。
  const { rects } = coverLayout([
    { height: 800, width: 400 },
    { height: 400, width: 400 },
  ]);

  assert.equal(rects[0]!.height, rects[1]!.height);
  // 宽高比保住:高的那帧是 1:2,矮的是 1:1 —— 归一化后前者宽度是后者的一半。
  assert.ok(rects[0]!.width < rects[1]!.width, "高的那帧更窄");
  assert.ok(Math.abs(rects[0]!.width * 2 - rects[1]!.width) < 0.01, "1:2 与 1:1 的宽度关系");
});

test("整体居中:左边留白与右边留白一样宽", () => {
  const { rects } = coverLayout([PHONE, PHONE]);
  const first = rects[0]!;
  const last = rects[rects.length - 1]!;

  const leftGap = first.x;
  const rightGap = COVER_BOX.width - (last.x + last.width);
  assert.ok(Math.abs(leftGap - rightGap) < 0.5, `left ${leftGap} vs right ${rightGap}`);
});

test("从不上采样:一帧小图不会被拉大", () => {
  // 一个 100×100 的帧塞进 480×360 的封面:能放得下就不放大 —— 放大只是把马赛克变大。
  const { scale } = coverLayout([{ height: 100, width: 100 }]);
  assert.equal(scale, 1);
});

test("没有可画的帧时给出空结果,而不是一张空图", () => {
  assert.deepEqual(coverLayout([]), { rects: [], scale: 1 });
  // 尺寸非法(0 / NaN)的帧当作没有 —— 它们画出来是一条线,而那是"封面坏了"的样子。
  assert.deepEqual(coverLayout([{ height: 0, width: 390 }, { height: 844, width: 0 }]), { rects: [], scale: 1 });
  assert.deepEqual(coverLayout([{ height: Number.NaN, width: 390 }]), { rects: [], scale: 1 });
});
