import assert from "node:assert/strict";
import test from "node:test";
import type { EnabledModelRecord, ProviderConnectionRecord } from "@wordless/domain";
import {
  countModelPickerModels,
  filterModelPickerGroups,
  modelPickerGroups,
} from "../src/renderer/features/workbench/model-picker-groups.ts";

function connection(id: string, displayName: string, authStatus: ProviderConnectionRecord["authStatus"] = "configured"): ProviderConnectionRecord {
  return {
    id,
    kind: "builtin",
    providerId: id,
    avatarId: null,
    displayName,
    baseUrl: null,
    api: null,
    authStatus,
    createdAt: 0,
    updatedAt: 0,
  };
}

function model(connectionId: string, modelId: string, displayName = modelId): EnabledModelRecord {
  return {
    connectionId,
    modelId,
    displayName,
    capabilities: {
      supportsText: true,
      supportsVision: false,
      supportsToolUse: "unknown",
      supportsReasoning: false,
      supportedThinkingLevels: [],
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
    },
    enabled: true,
    updatedAt: 0,
  };
}

/** The shape a real profile has: one model id exposed by several endpoints. */
const CONNECTIONS = [connection("routin-glm", "Routin GLM"), connection("hyb-gpt", "HYB GPT"), connection("wong", "Wong")];
const MODELS = [
  model("hyb-gpt", "glm-5.3-flash"),
  model("routin-glm", "glm-5.3-flash"),
  model("wong", "minimaxai/minimax-m3", "MiniMax M3"),
  model("routin-glm", "deepseek-v4.1-flash", "DeepSeek V4.1"),
];

test("models are grouped under the provider that exposes them", () => {
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  assert.deepEqual(
    groups.map((group) => [group.id, group.label, group.models.map((entry) => entry.modelId)]),
    [
      ["routin-glm", "Routin GLM", ["glm-5.3-flash", "deepseek-v4.1-flash"]],
      ["hyb-gpt", "HYB GPT", ["glm-5.3-flash"]],
      ["wong", "Wong", ["minimaxai/minimax-m3"]],
    ],
  );
});

test("the same model id under two providers stays in two groups", () => {
  // The whole reason the grouping exists: as a flat list these were two identical rows
  // told apart only by a 16px icon.
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  assert.equal(groups.filter((group) => group.models.some((entry) => entry.modelId === "glm-5.3-flash")).length, 2);
});

test("groups follow the configured order, and models keep the order they came in", () => {
  // Neither is alphabetical: sorting would scramble names the user chose, and the
  // configured order is the one the settings sidebar shows.
  const groups = modelPickerGroups(
    [model("wong", "zeta"), model("hyb-gpt", "alpha"), model("wong", "beta")],
    CONNECTIONS,
  );
  assert.deepEqual(groups.map((group) => group.id), ["hyb-gpt", "wong"]);
  assert.deepEqual(groups[1].models.map((entry) => entry.modelId), ["zeta", "beta"]);
});

test("a provider the snapshot does not describe still gets a group, after the known ones", () => {
  const groups = modelPickerGroups([model("ghost", "m1"), ...MODELS], CONNECTIONS);
  assert.equal(groups.at(-1)?.id, "ghost");
  // Its name falls back to the id, and it counts as unconfigured so its rows disable
  // rather than looking selectable.
  assert.equal(groups.at(-1)?.label, "ghost");
  assert.equal(groups.at(-1)?.configured, false);
});

test("a blank display name falls back to the provider id", () => {
  const groups = modelPickerGroups([model("hyb-gpt", "m1")], [connection("hyb-gpt", "   ")]);
  assert.equal(groups[0].label, "hyb-gpt");
});

test("configured follows the connection's auth status", () => {
  const groups = modelPickerGroups(
    [model("hyb-gpt", "m1"), model("wong", "m2")],
    [connection("hyb-gpt", "HYB GPT", "missing"), connection("wong", "Wong")],
  );
  assert.deepEqual(groups.map((group) => [group.id, group.configured]), [["hyb-gpt", false], ["wong", true]]);
});

test("search matches a model's display name and id", () => {
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  assert.deepEqual(
    filterModelPickerGroups(groups, "minimax-m3").map((group) => group.models.map((entry) => entry.modelId)),
    [["minimaxai/minimax-m3"]],
  );
  assert.deepEqual(
    filterModelPickerGroups(groups, "DeepSeek").map((group) => group.models.map((entry) => entry.modelId)),
    [["deepseek-v4.1-flash"]],
  );
});

test("a query matching the provider keeps every model of that provider", () => {
  // These provider names describe what they serve (`routin-glm`, `hyb-gpt`), so typing
  // part of one should bring up the whole group rather than only the rows that happen
  // to spell it out.
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  const filtered = filterModelPickerGroups(groups, "routin");
  assert.deepEqual(filtered.map((group) => group.id), ["routin-glm"]);
  assert.equal(filtered[0].models.length, 2);
});

test("search ignores case and surrounding whitespace", () => {
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  assert.deepEqual(filterModelPickerGroups(groups, "  GLM-5.3 ").map((group) => group.id), ["routin-glm", "hyb-gpt"]);
});

test("groups left with nothing are dropped, so no empty header renders", () => {
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  const filtered = filterModelPickerGroups(groups, "deepseek");
  assert.deepEqual(filtered.map((group) => group.id), ["routin-glm"]);
  assert.equal(filtered[0].models.length, 1);
  assert.deepEqual(filterModelPickerGroups(groups, "nothing-like-this"), []);
});

test("an empty query returns the groups untouched", () => {
  const groups = modelPickerGroups(MODELS, CONNECTIONS);
  assert.equal(filterModelPickerGroups(groups, ""), groups);
  assert.equal(filterModelPickerGroups(groups, "   "), groups);
});

test("the model count drives the empty state", () => {
  assert.equal(countModelPickerModels(modelPickerGroups(MODELS, CONNECTIONS)), 4);
  assert.equal(countModelPickerModels([]), 0);
});
