import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_KNOWLEDGE_BASE_NAME,
  DEFAULT_KNOWLEDGE_LIBRARY_SETTINGS,
  DEFAULT_KNOWLEDGE_PREFERENCES,
  knowledgeSettingsFor,
  normalizeKnowledgePreferences,
  withKnowledgeLibrarySettings,
} from "@wordless/domain";

/**
 * 知识库偏好。
 *
 * 三条纪律:
 *   1. **默认开** —— 知识库是个安全的能力(写工具只在整理画像上),不该让用户先去找开关;
 *   2. **归一之后再落盘** —— 界面渲染的和磁盘上的是同一个形状(与 sidebar / ocr 同一条);
 *   3. **每库一份设置** —— 模型 / 间隔 / 预算属于某个库,开关属于功能本身。
 */

const defaults = { enabled: true, activeKnowledgeBase: null, libraries: {} };

describe("知识库偏好归一", () => {
  it("什么都没有时:开、没有当前库、没有库设置", () => {
    assert.deepEqual(normalizeKnowledgePreferences(undefined), defaults);
    assert.deepEqual(normalizeKnowledgePreferences({}), defaults);
    assert.deepEqual(normalizeKnowledgePreferences("不是对象"), defaults);
  });

  it("开关只认布尔,别的一律当没设(于是回到默认的「开」)", () => {
    assert.equal(normalizeKnowledgePreferences({ enabled: false }).enabled, false);
    assert.equal(normalizeKnowledgePreferences({ enabled: true }).enabled, true);
    assert.equal(normalizeKnowledgePreferences({ enabled: "no" }).enabled, true);
    assert.equal(normalizeKnowledgePreferences({ enabled: 0 }).enabled, true);
  });

  it("当前库名只认非空字符串,别的一律当「没选过」", () => {
    assert.equal(normalizeKnowledgePreferences({ activeKnowledgeBase: "工作" }).activeKnowledgeBase, "工作");
    assert.equal(normalizeKnowledgePreferences({ activeKnowledgeBase: "  " }).activeKnowledgeBase, null);
    assert.equal(normalizeKnowledgePreferences({ activeKnowledgeBase: 7 }).activeKnowledgeBase, null);
  });
});

describe("每个库的设置", () => {
  it("逐库校验:模型引用要么完整要么当没配,半截的不能落到磁盘上", () => {
    const normalized = normalizeKnowledgePreferences({
      libraries: {
        甲: { processingModel: { connectionId: "a", modelId: "b" }, autoProcessMinutes: 5, maxFilesPerRound: 10 },
      },
    });
    assert.deepEqual(normalized.libraries["甲"], {
      processingModel: { connectionId: "a", modelId: "b" },
      autoProcessMinutes: 5,
      maxFilesPerRound: 10,
    });
    for (const half of [{ connectionId: "a" }, { modelId: "b" }, "gpt", 42]) {
      assert.equal(normalizeKnowledgePreferences({ libraries: { 甲: { processingModel: half } } }).libraries["甲"]!.processingModel, null, JSON.stringify(half));
    }
  });

  it("间隔与预算只认允许的档位,别的一律回到默认", () => {
    assert.equal(normalizeKnowledgePreferences({ libraries: { 甲: { autoProcessMinutes: 30 } } }).libraries["甲"]!.autoProcessMinutes, 30);
    // 自由数值不生效:否则"每 0.5 分钟"这种配置会悄悄跑起来。
    assert.equal(normalizeKnowledgePreferences({ libraries: { 甲: { autoProcessMinutes: 1 } } }).libraries["甲"]!.autoProcessMinutes, 0);
    assert.equal(normalizeKnowledgePreferences({ libraries: { 甲: { maxFilesPerRound: 10 } } }).libraries["甲"]!.maxFilesPerRound, 10);
    assert.equal(normalizeKnowledgePreferences({ libraries: { 甲: { maxFilesPerRound: 7 } } }).libraries["甲"]!.maxFilesPerRound, 0);
  });

  it("坏的那项退回默认,**不连坐**别的项", () => {
    const normalized = normalizeKnowledgePreferences({ libraries: { 甲: { autoProcessMinutes: 99, maxFilesPerRound: 10 } } });
    assert.deepEqual(normalized.libraries["甲"], { processingModel: null, autoProcessMinutes: 0, maxFilesPerRound: 10 });
  });

  it("库名会变成目录名,所以偏好文件里那些逃逸的键也挡掉", () => {
    // 偏好文件是用户能直接改的。
    const normalized = normalizeKnowledgePreferences({ libraries: { "../外面": { autoProcessMinutes: 5 }, "a/b": {}, "": {} } });
    assert.deepEqual(Object.keys(normalized.libraries), []);
  });

  it("不是对象的 libraries 当成没配", () => {
    assert.deepEqual(normalizeKnowledgePreferences({ libraries: "甲" }).libraries, {});
    assert.deepEqual(normalizeKnowledgePreferences({ libraries: ["甲"] }).libraries, {});
  });

  it("没配过的库读到默认,而且**读取只有一个入口**", () => {
    const preferences = normalizeKnowledgePreferences({ libraries: { 甲: { autoProcessMinutes: 5 } } });
    assert.deepEqual(knowledgeSettingsFor(preferences, "甲"), { processingModel: null, autoProcessMinutes: 5, maxFilesPerRound: 0 });
    assert.deepEqual(knowledgeSettingsFor(preferences, "乙"), DEFAULT_KNOWLEDGE_LIBRARY_SETTINGS);
    assert.deepEqual(knowledgeSettingsFor(preferences, null), DEFAULT_KNOWLEDGE_LIBRARY_SETTINGS);
  });

  it("改一个库的设置,**别的库原样不动**", () => {
    // 界面里三个控件都走这个入口 —— 三处各写一遍"展开 + 只改一格",迟早有一处把别的库覆盖掉。
    const before = normalizeKnowledgePreferences({ libraries: { 甲: { autoProcessMinutes: 5 }, 乙: { maxFilesPerRound: 10 } } });
    const after = withKnowledgeLibrarySettings(before, "甲", { maxFilesPerRound: 20 });
    assert.deepEqual(after.libraries["甲"], { processingModel: null, autoProcessMinutes: 5, maxFilesPerRound: 20 });
    assert.deepEqual(after.libraries["乙"], { processingModel: null, autoProcessMinutes: 0, maxFilesPerRound: 10 }, "乙没被碰到");
    assert.equal(after.enabled, before.enabled);
    assert.equal(after.activeKnowledgeBase, before.activeKnowledgeBase);
  });

  it("改一个没配过的库:补上它,别的库照旧", () => {
    const after = withKnowledgeLibrarySettings(normalizeKnowledgePreferences({ libraries: { 甲: { autoProcessMinutes: 5 } } }), "乙", { autoProcessMinutes: 10 });
    assert.deepEqual(after.libraries["乙"], { processingModel: null, autoProcessMinutes: 10, maxFilesPerRound: 0 });
    assert.deepEqual(after.libraries["甲"], { processingModel: null, autoProcessMinutes: 5, maxFilesPerRound: 0 });
  });
});

describe("多库之前的老结构要迁移", () => {
  /**
   * 那时只有一个库,那几项就属于当时那个库。不迁移的话,用户配好的加工模型会**静默消失** ——
   * 自动加工不再跑,而他不知道为什么。
   */
  it("扁平的老设置搬到当前库名下", () => {
    const normalized = normalizeKnowledgePreferences({
      enabled: false,
      activeKnowledgeBase: "工作",
      processingModel: { connectionId: "a", modelId: "b" },
      autoProcessMinutes: 10,
      maxFilesPerRound: 20,
    });
    assert.deepEqual(normalized.libraries["工作"], {
      processingModel: { connectionId: "a", modelId: "b" },
      autoProcessMinutes: 10,
      maxFilesPerRound: 20,
    });
    assert.equal(normalized.enabled, false);
    assert.equal(normalized.activeKnowledgeBase, "工作");
  });

  it("没记当前库时,搬到**默认那个库**名下 —— 单库时代建的正是它", () => {
    const normalized = normalizeKnowledgePreferences({ autoProcessMinutes: 5 });
    assert.deepEqual(Object.keys(normalized.libraries), [DEFAULT_KNOWLEDGE_BASE_NAME]);
    assert.equal(normalized.libraries[DEFAULT_KNOWLEDGE_BASE_NAME]!.autoProcessMinutes, 5);
  });

  it("全新的安装不迁移 —— 不在偏好文件里凭空留一个库", () => {
    assert.deepEqual(normalizeKnowledgePreferences({ enabled: true }).libraries, {});
    assert.deepEqual(normalizeKnowledgePreferences(undefined).libraries, {});
  });

  it("新结构优先:已经有 libraries 时,老字段不再被读", () => {
    const normalized = normalizeKnowledgePreferences({
      activeKnowledgeBase: "工作",
      autoProcessMinutes: 30,
      libraries: { 工作: { autoProcessMinutes: 5 } },
    });
    assert.equal(normalized.libraries["工作"]!.autoProcessMinutes, 5, "以新结构为准");
  });
});

describe("默认值本身", () => {
  it("默认偏好就是归一一个空对象的结果(不会两处漂)", () => {
    assert.deepEqual(DEFAULT_KNOWLEDGE_PREFERENCES, normalizeKnowledgePreferences(undefined));
  });

  it("默认库设置是「跟随会话模型 / 只手动 / 不限」", () => {
    assert.deepEqual(DEFAULT_KNOWLEDGE_LIBRARY_SETTINGS, { processingModel: null, autoProcessMinutes: 0, maxFilesPerRound: 0 });
  });
});
