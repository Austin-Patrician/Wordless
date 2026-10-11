import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRoundLogLine, roundLogKind, type RoundLogFacts } from "../src/main/knowledge/knowledge-derived.ts";

/**
 * 时间线那一行。
 *
 * 这里钉的是**那个已经骗过人的行为**:日志只记计划不记产出,于是"计划 1 页、实际 0 页"
 * 写成 `加工:+1` —— 系统报告成功,用户以为成功了。
 */

const facts = (overrides: Partial<RoundLogFacts> = {}): RoundLogFacts => ({
  added: 1,
  changed: 0,
  moved: 0,
  deleted: 0,
  reaped: 0,
  result: { written: 1, failed: 0, gone: 0 },
  ...overrides,
});

describe("一轮的日志行", () => {
  it("产出在前,计划在后 —— 「成没成」是这一行的答案", () => {
    assert.equal(formatRoundLogLine(facts()), "写成 1 页,未成 0 页(计划 +1 ~0,移动 0,删除 0,回收 0)");
  });

  it("**计划 1 页、实际 0 页必须看得出来**(这正是骗过人的那个场景)", () => {
    const line = formatRoundLogLine(facts({ result: { written: 0, failed: 1, gone: 0 } }));
    assert.match(line, /^写成 0 页,未成 1 页/);
    assert.match(line, /计划 \+1/);
  });

  it("原文已被删除的不算失败 —— 它走孤儿回收,说清是另一回事", () => {
    const line = formatRoundLogLine(facts({ result: { written: 0, failed: 0, gone: 1 } }));
    assert.match(line, /1 个原文已删除/);
    assert.match(line, /未成 0 页/);
  });

  it("只有工程动作的轮次说那些动作 —— 说「写成 0 页」会让正常的事看起来像失败", () => {
    const line = formatRoundLogLine(facts({ added: 0, moved: 2, deleted: 1, reaped: 1, result: null }));
    assert.equal(line, "移动 2,删除 1,回收 1(计划 +0 ~0)");
    assert.doesNotMatch(line, /写成/);
  });

  it("写成过页才算 Creation,否则只是工程侧的增删改", () => {
    assert.equal(roundLogKind(facts()), "Creation");
    assert.equal(roundLogKind(facts({ result: { written: 0, failed: 1, gone: 0 } })), "Update");
    assert.equal(roundLogKind(facts({ added: 0, moved: 1, result: null })), "Update");
  });
});
