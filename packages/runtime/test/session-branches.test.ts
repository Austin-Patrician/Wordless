import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTreeEntry } from "@wordless/agent";
import { projectSessionTurnVersions } from "../src/session-branches.ts";

function user(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    message: { role: "user" } as never,
  };
}

function assistant(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    message: { role: "assistant" } as never,
  };
}

function retryDirective(id: string, parentId: string): SessionTreeEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
  };
}

function leafMarker(id: string, parentId: string, targetId: string): SessionTreeEntry {
  return {
    type: "leaf",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    targetId,
  };
}

/**
 * 驱动在"自动重试"之前写下的标记(见 `packages/agent-driver-generic`):它指向被摘下来的那条
 * 失败响应 —— 也就是那条子树的 tip。
 */
function modelRetryMarker(id: string, parentId: string, failedMessageEntryId: string): SessionTreeEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    customType: "wordless.model-retry",
    data: { attempt: 1, failedMessageEntryId },
  };
}

/** 上下文溢出恢复写下的标记(压缩记录里的字段)。 */
function overflowMarker(id: string, parentId: string, recoveredFailureEntryId: string): SessionTreeEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    customType: "wordless.context-compaction",
    data: { compactionId: "c1", trigger: "overflow", tokensAfter: 1, recoveredFailureEntryId },
  };
}

test("reports sibling response versions of a retried turn", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
  ];
  const versions = projectSessionTurnVersions(entries, "A2");
  assert.deepEqual(versions.get("U"), {
    active: 2,
    tips: ["A1", "A2"],
    total: 2,
  });
});

test("a version tip stops before the next user turn", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
    user("U2", "A2"),
    assistant("A3", "U2"),
  ];
  const versions = projectSessionTurnVersions(entries, "A3");
  assert.deepEqual(versions.get("U"), {
    active: 2,
    tips: ["A1", "A2"],
    total: 2,
  });
  // A single response is not a version set.
  assert.equal(versions.get("U2"), undefined);
});

test("tracks versions per turn and follows a rewound leaf", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
    user("U2", "A2"),
    assistant("A3", "U2"),
    leafMarker("L2", "A3", "U2"),
    assistant("A4", "U2"),
  ];
  const retried = projectSessionTurnVersions(entries, "A4");
  assert.deepEqual(retried.get("U2"), {
    active: 2,
    tips: ["A3", "A4"],
    total: 2,
  });

  const rewound = projectSessionTurnVersions(entries, "A1");
  assert.deepEqual(rewound.get("U"), {
    active: 1,
    tips: ["A1", "A2"],
    total: 2,
  });
  const rewoundToSecond = projectSessionTurnVersions(entries, "A2");
  assert.equal(rewoundToSecond.get("U")?.active, 2);
});

test("ignores leaf markers and turns without alternative versions", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    leafMarker("L2", "U", "A1"),
  ];
  assert.equal(projectSessionTurnVersions(entries, "A1").size, 0);
});

/**
 * 以下用例钉住"内部回收不算版本"。
 *
 * 真实 journal 形状(见 `packages/agent-driver-generic` 的重试流程)是:
 * 失败响应 `F1` 挂在用户消息下 → `moveTo(用户消息)` 把它摘下来 → **标记条目 `R1` 成为新的叶子**
 * → 重试出的回复挂在**标记下面**(`U → [F1, R1 → A2]`)。所以标记是链上的一个节点,不是终点。
 */

test("an automatically retried failure is not a version", () => {
  const entries = [
    user("U", null),
    assistant("F1", "U"), // 连接错误那条
    leafMarker("L1", "F1", "U"), // 摘下来
    modelRetryMarker("R1", "U", "F1"),
    assistant("A2", "R1"), // 重试后那条挂在标记下面
  ];
  // 只剩重试后那条 —— 界面上不该出现 <2/2>。
  assert.equal(projectSessionTurnVersions(entries, "A2").get("U"), undefined);
});

test("consecutive automatic retries collapse into the single surviving response", () => {
  const entries = [
    user("U", null),
    assistant("F1", "U"),
    leafMarker("L1", "F1", "U"),
    modelRetryMarker("R1", "U", "F1"),
    assistant("F2", "R1"),
    leafMarker("L2", "F2", "R1"),
    modelRetryMarker("R2", "R1", "F2"),
    assistant("A3", "R2"),
  ];
  assert.equal(projectSessionTurnVersions(entries, "A3").get("U"), undefined);
});

test("an automatic retry after tool calls is not a version either", () => {
  // 失败发生在工具调用之后:被摘下的那条不是用户条目的直接子节点,而是更深处的终点。
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    assistant("T1", "A1"), // 工具结果那一轮
    assistant("F1", "T1"), // 失败
    leafMarker("L1", "F1", "T1"),
    modelRetryMarker("R1", "T1", "F1"),
    assistant("A2", "R1"), // 重试
  ];
  assert.equal(projectSessionTurnVersions(entries, "A2").get("U"), undefined);
});

test("overflow recovery is not a version", () => {
  const entries = [
    user("U", null),
    assistant("F1", "U"),
    leafMarker("L1", "F1", "U"),
    overflowMarker("C1", "U", "F1"),
    assistant("A2", "C1"),
  ];
  assert.equal(projectSessionTurnVersions(entries, "A2").get("U"), undefined);
});

test("a user retry stays a version, and a retry inside it does not eat it", () => {
  // 用户重答过(两份答案),第二份自己又被自动重试过:标记落在用户版本**链上**、且不是终点。
  // 按"子树里含被回收条目"整条丢弃会把用户自己的版本也吃掉,所以判定必须按终点。
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    retryDirective("D1", "U"),
    assistant("B1", "D1"),
    leafMarker("L2", "B1", "D1"),
    modelRetryMarker("R1", "D1", "B1"),
    assistant("B2", "R1"),
  ];
  assert.deepEqual(projectSessionTurnVersions(entries, "B2").get("U"), {
    active: 2,
    tips: ["A1", "B2"],
    total: 2,
  });
});

test("an automatic retry does not hide a user retry made after it", () => {
  const entries = [
    user("U", null),
    assistant("F1", "U"),
    leafMarker("L1", "F1", "U"),
    modelRetryMarker("R1", "U", "F1"),
    assistant("A2", "R1"), // 自动重试后那条
    leafMarker("L2", "A2", "U"),
    retryDirective("D1", "U"),
    assistant("A3", "D1"), // 用户又重答一次
  ];
  assert.deepEqual(projectSessionTurnVersions(entries, "A3").get("U"), {
    active: 2,
    tips: ["A2", "A3"],
    total: 2,
  });
});

test("the retried-away failure stays hidden from every version you can look at", () => {
  // 标记写在"重试之后"那条链上。回收集合如果只扫活动分支,用户切到另一版时那条幽灵版本就会回来。
  const entries = [
    user("U", null),
    assistant("F1", "U"),
    leafMarker("L1", "F1", "U"),
    modelRetryMarker("R1", "U", "F1"),
    assistant("A2", "R1"),
    leafMarker("L2", "A2", "U"),
    retryDirective("D1", "U"),
    assistant("A3", "D1"),
  ];
  // 在自动重试那一版:2 个版本(自动重试后的 + 用户重答的)
  assert.deepEqual(projectSessionTurnVersions(entries, "A2").get("U"), {
    active: 1,
    tips: ["A2", "A3"],
    total: 2,
  });
  // 切到用户重答那一版:数量不变,幽灵版本不会回来
  assert.deepEqual(projectSessionTurnVersions(entries, "A3").get("U"), {
    active: 2,
    tips: ["A2", "A3"],
    total: 2,
  });
});

test("looking at a superseded version keeps it visible and consistent", () => {
  // 改动之前用户可能已经选中过那个失败版本(leaf 落在被回收的链里)。这时不能算出 total 0,
  // 也不能出现"屏幕上的内容不属于任何一个版本" —— 把它算作可见版本,用户还能切回去。
  const entries = [
    user("U", null),
    assistant("F1", "U"),
    leafMarker("L1", "F1", "U"),
    modelRetryMarker("R1", "U", "F1"),
    assistant("A2", "R1"),
    leafMarker("L2", "A2", "F1"), // 用户切到失败那版
  ];
  assert.deepEqual(projectSessionTurnVersions(entries, "F1").get("U"), {
    active: 1,
    tips: ["F1", "A2"],
    total: 2,
  });
});

test("a metadata-only branch never becomes a version", () => {
  // 重试被中断(标记下面没有回复):标记是最后一个子节点,但它不是回复。
  // 盲取最后一个子节点会把用户重答那一版丢掉,标记本身也会被当成一个"版本"。
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    retryDirective("D1", "U"),
    assistant("B1", "D1"),
    leafMarker("L2", "B1", "D1"),
    modelRetryMarker("R1", "D1", "B1"), // 重试排上了,但没跑成
  ];
  assert.deepEqual(projectSessionTurnVersions(entries, "R1").get("U"), {
    active: 2,
    tips: ["A1", "B1"],
    total: 2,
  });
});

test("a marker pointing at a missing entry changes nothing", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
    modelRetryMarker("R1", "D1", "missing"),
  ];
  assert.deepEqual(projectSessionTurnVersions(entries, "A2").get("U"), {
    active: 2,
    tips: ["A1", "A2"],
    total: 2,
  });
});
