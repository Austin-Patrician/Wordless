import assert from "node:assert/strict";
import test from "node:test";
import { groupProviderModels, modelPresentation } from "../src/renderer/features/settings/provider-model-presentation.ts";

test("maps common model families to their provider icons", () => {
  assert.deepEqual(modelPresentation({ id: "claude-sonnet-4-6", name: "Claude Sonnet" }), { id: "anthropic", label: "Anthropic", avatarId: "anthropic" });
  assert.equal(modelPresentation({ id: "openai/gpt-5.4", name: "GPT 5.4" }).avatarId, "openai");
  assert.equal(modelPresentation({ id: "google/gemini-3.5-flash", name: "Gemini" }).avatarId, "gemini");
  assert.equal(modelPresentation({ id: "deepseek-ai/DeepSeek-V4", name: "DeepSeek V4" }).avatarId, "deepseek");
});

test("groups and sorts discovered models by family", () => {
  const groups = groupProviderModels([
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "claude-opus-4-6", name: "Claude Opus" },
    { id: "gpt-5-mini", name: "GPT 5 Mini" },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.models.length]), [["Anthropic", 1], ["OpenAI", 2]]);
});

test("uses an explicit model namespace as the group while retaining its family icon", () => {
  assert.deepEqual(modelPresentation({ id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" }), {
    id: "deepseek-ai",
    label: "deepseek-ai",
    avatarId: "deepseek",
  });
});
