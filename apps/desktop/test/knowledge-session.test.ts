import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { knowledgeSessionRequest, modelFromKey } from "../src/main/knowledge/knowledge-session.ts";

/**
 * 一轮加工怎么开会话。
 *
 * 这里钉的是那个**已经踩过一次**的坑:会话根必须就是知识库。
 * 错了不会报错,只会让 agent 拿着 `raws/health.md` 去会话的临时目录里找文件 ——
 * 它明明照着说明书在做,却拿到 ENOENT。
 */

const request = (overrides: Partial<Parameters<typeof knowledgeSessionRequest>[0]> = {}) =>
  knowledgeSessionRequest({
    bundleRoot: "/Users/me/Documents/Wordless Knowledge/知识库",
    modelKey: null,
    title: "知识库整理",
    messageId: "m1",
    submittedAt: 1,
    ...overrides,
  });

describe("加工会话的会话根", () => {
  it("就是当前库 —— 否则任务清单里的相对路径指向会话的临时目录", () => {
    const { options } = request();
    assert.equal(options.sessionRootPath, "/Users/me/Documents/Wordless Knowledge/知识库");
  });

  it("跟着当前库走(多库时不能是写死的根)", () => {
    const { options } = request({ bundleRoot: "/Users/me/Documents/Wordless Knowledge/工作" });
    assert.equal(options.sessionRootPath, "/Users/me/Documents/Wordless Knowledge/工作");
  });
});

describe("加工会话的定义", () => {
  it("入口、来源、工作台都对得上", () => {
    const { draft } = request();
    assert.equal(draft.entryId, "knowledge");
    assert.equal(draft.source, "knowledge");
    // **不是对话**:独立一档,免得会话根的机器行为(artifacts/)落进要能带走的库里。
    assert.equal(draft.workspaceId, null);
    assert.equal(draft.mode, "everyday");
    assert.equal(draft.interactionMode, "default");
  });

  it("无人值守:一轮加工不该停下来等人(定时那轮尤其没人守着)", () => {
    assert.equal(request().draft.toolApprovalMode, "bypass");
  });

  it("权限级别是 default —— 路径守卫要在(会话根=库已经给了读的地方)", () => {
    assert.equal(request().draft.accessLevel, "default");
  });
});

describe("模型键", () => {
  it("没配就是 null(跟随会话默认)", () => {
    assert.equal(modelFromKey(null), null);
    assert.equal(request().draft.model, null);
  });

  it("完整键拆成引用;modelId 里的斜杠不能丢", () => {
    assert.deepEqual(modelFromKey("openai/gpt-5"), { connectionId: "openai", modelId: "gpt-5" });
    assert.deepEqual(modelFromKey("openrouter/vendor/model"), { connectionId: "openrouter", modelId: "vendor/model" });
  });

  it("半截的键当没配 —— 半个引用不该落到会话上", () => {
    for (const key of ["", "/", "openai/", "/gpt-5"]) {
      assert.equal(modelFromKey(key), null, key);
    }
  });
});
