import assert from "node:assert/strict";
import test from "node:test";
import {
  DESIGN_CANVAS_BUDGETS,
  allowsLiveSurface,
  texturePixelRatio,
} from "../src/renderer/features/design/budgets.ts";

test("活体阈值是包含关系,非有限缩放不给活体", () => {
  const threshold = DESIGN_CANVAS_BUDGETS.liveZoomThreshold;
  assert.equal(allowsLiveSurface(threshold), true);
  assert.equal(allowsLiveSurface(threshold + 0.01), true);
  assert.equal(allowsLiveSurface(threshold - 0.01), false);
  // 缩小看全局时不该有活体 —— 这条同时是正确性要求,不只是性能取舍。
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

  // 档位必须严格递增:`zoomBucket` 的语义建立在"不超过当前 zoom 的最大档"上。
  const buckets = DESIGN_CANVAS_BUDGETS.zoomBuckets;
  assert.ok(buckets.length > 0);
  for (let index = 1; index < buckets.length; index += 1) {
    assert.ok(buckets[index] > buckets[index - 1], `档位不是递增的:${buckets.join(", ")}`);
  }
  // 必须有一档是 1:1,否则永远拿不到像素精准的位图。
  assert.ok(buckets.includes(1));
});
