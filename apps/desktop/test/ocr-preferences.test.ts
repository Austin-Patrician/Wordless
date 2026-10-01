import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeOcrPreferences } from "@wordless/domain";

/**
 * 文字识别的偏好。
 *
 * 这两项都会**改变识别行为**(缓存开关决定同一张图会不会被反复识别;粒度决定模型拿到的是整段
 * 还是逐行),所以它们的规范化必须"坏输入也能给出可用值" —— 磁盘上的旧偏好、手改过的文件、
 * 未来版本写的字段,都不能让识别直接坏掉。
 */

describe("normalizeOcrPreferences", () => {
  it("缺字段时给默认值:缓存开、纯文本", () => {
    assert.deepEqual(normalizeOcrPreferences(undefined), { cache: true, granularity: "text" });
    assert.deepEqual(normalizeOcrPreferences({}), { cache: true, granularity: "text" });
  });

  it("只给了粒度时,缓存仍然是默认的开(不是 undefined)", () => {
    assert.deepEqual(normalizeOcrPreferences({ granularity: "line" }), { cache: true, granularity: "line" });
  });

  it("认识的两个取值都保留", () => {
    assert.deepEqual(normalizeOcrPreferences({ cache: false, granularity: "line" }), { cache: false, granularity: "line" });
    assert.deepEqual(normalizeOcrPreferences({ cache: true, granularity: "text" }), { cache: true, granularity: "text" });
  });

  it("坏输入退回默认值,而不是把坏值带进识别", () => {
    for (const value of [null, 42, "line", [], { cache: "yes", granularity: "word" }, { granularity: "document-tree" }]) {
      const normalized = normalizeOcrPreferences(value);
      assert.equal(typeof normalized.cache, "boolean", JSON.stringify(value));
      assert.ok(normalized.granularity === "text" || normalized.granularity === "line", JSON.stringify(value));
    }
    // 具体点:没有"词"和"版面树"这两档(PP-OCRv5 给不出,而且版面不该由 OCR 承担)。
    assert.equal(normalizeOcrPreferences({ granularity: "word" }).granularity, "text");
    assert.equal(normalizeOcrPreferences({ granularity: "document-tree" }).granularity, "text");
  });
});
