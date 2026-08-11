import assert from "node:assert/strict";
import test from "node:test";
import type { ConfiguredModelSummary } from "@wordless/domain";
import { mediaOperationDefinition, mediaOperationUnavailableReason } from "../src/renderer/features/media/media-operations.ts";

const transparentImageModel = {
  imageCapabilities: { supportsTransparentBackground: true },
  supportsVision: true,
} as ConfiguredModelSummary;

test("requires an explicit image model before evaluating operation capabilities", () => {
  const operation = mediaOperationDefinition("remove-background");

  assert.equal(mediaOperationUnavailableReason(operation, undefined, "zh-CN"), "请先选择图片模型");
  assert.equal(mediaOperationUnavailableReason(operation, undefined, "en-US"), "Select an image model first");
  assert.equal(mediaOperationUnavailableReason(operation, transparentImageModel, "en-US"), null);
});
