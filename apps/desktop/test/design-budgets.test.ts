import assert from "node:assert/strict";
import test from "node:test";
import {
  DESIGN_CANVAS_BUDGETS,
  allowsLiveSurface,
  texturePixelRatio,
} from "../src/renderer/features/design/budgets.ts";

test("活体只在 1:1 出现(带容差),非有限缩放不给活体", () => {
  // **这是正确性,不是性能取舍。** 宿主只做 `setBounds`、不做缩放补偿,所以非 1:1 时原生
  // 视图的视口不等于帧的声明尺寸 —— 页面会重排,画布上看到的是错的版面。
  // 取"明显在内"与"明显在外"两侧,而不是正好压在边界上:`1 - 0.02` 在浮点里是
  // 0.98000000000000001…,`abs(...) <= 0.02` 会答 false —— 那不是规则的意图,只是浮点。
  const tolerance = DESIGN_CANVAS_BUDGETS.liveZoomTolerance;
  assert.equal(allowsLiveSurface(1), true);
  assert.equal(allowsLiveSurface(1 + tolerance * 0.5), true);
  assert.equal(allowsLiveSurface(1 - tolerance * 0.5), true);
  assert.equal(allowsLiveSurface(1 + tolerance * 2), false);
  assert.equal(allowsLiveSurface(1 - tolerance * 2), false);

  // 曾经这里是「≥ 0.75」,于是 0.9 被判为够格 —— 而它渲染出来的是重排后的版面。
  // 这条测试以前恰恰在**保护**那个缺陷。
  assert.equal(allowsLiveSurface(0.9), false);
  assert.equal(allowsLiveSurface(0.75), false);
  // 缩小看全局时不该有活体。
  assert.equal(allowsLiveSurface(0.25), false);
  // NaN 若被判为"够格",会带着一个坏相机去 attach 原生视图。
  assert.equal(allowsLiveSurface(Number.NaN), false);
  assert.equal(allowsLiveSurface(Number.POSITIVE_INFINITY), false);
});

test("位图按设备像素比光栅,但有上限", () => {
  assert.equal(texturePixelRatio(1), 1);
  assert.equal(texturePixelRatio(2), 2);
  // Retina 之外还有 3x 屏;无上限会让单张位图涨到 9 倍像素。
  assert.equal(texturePixelRatio(3), DESIGN_CANVAS_BUDGETS.texturePixelRatioCap);
  assert.equal(texturePixelRatio(4), DESIGN_CANVAS_BUDGETS.texturePixelRatioCap);
});

test("异常的 devicePixelRatio 回落到 1 而不是把 NaN 传下去", () => {
  // 这个值会直接乘进位图尺寸,NaN 会让整条光栅链路失效。
  assert.equal(texturePixelRatio(Number.NaN), 1);
  assert.equal(texturePixelRatio(0), 1);
  assert.equal(texturePixelRatio(-2), 1);
  // 非有限值统一回落到中性的 1,而不是夹到上限 —— 一条规则比两种特例好记,
  // 也避免"Infinity 拿到 2x 位图"这种没人能解释的结果。
  assert.equal(texturePixelRatio(Number.POSITIVE_INFINITY), 1);
});

test("预算本身是自洽的", () => {
  // 活体上限是架构决定,改成 2 之前先回来看设计文档。
  assert.equal(DESIGN_CANVAS_BUDGETS.maxLiveViews, 1);
  assert.ok(DESIGN_CANVAS_BUDGETS.maxTextures > 0);
  assert.ok(DESIGN_CANVAS_BUDGETS.textureMaxEdge > 0);
  assert.ok(DESIGN_CANVAS_BUDGETS.textureByteBudget > 0);
  assert.ok(DESIGN_CANVAS_BUDGETS.rasterMarginPx >= 0);

  // 档位必须严格递增:`zoomBucket` 按它找"覆盖当前 zoom 的最小档"。
  const buckets = DESIGN_CANVAS_BUDGETS.zoomBuckets;
  assert.ok(buckets.length > 0);
  for (let index = 1; index < buckets.length; index += 1) {
    assert.ok(buckets[index] > buckets[index - 1], `档位不是递增的:${buckets.join(", ")}`);
  }
  // 必须有一档是 1:1,否则永远拿不到像素精准的位图。
  assert.ok(buckets.includes(1));
});
