import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlankAssistantMessage,
  type ConversationMessage,
  type MessageBlock,
} from "../src/index.ts";

/**
 * 「空白助手消息」的判据 —— 用户取消、宿主照常落盘的那一条。
 *
 * 这条测试守的是一个**只影响观感、不会报错**的判断:判宽了,一条真回复(部分正文、思考、
 * 工具执行)会从界面上消失,而那是取消之前已经发生的事;判窄了,取消之后会留下一条空壳,
 * 底下还挂着复制(空串)与用量(0)。
 */

function message(
  blocks: MessageBlock[],
  patch: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    blocks,
    id: "message-1",
    model: null,
    role: "assistant",
    status: "aborted",
    timestamp: 1,
    ...patch,
  };
}

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const reasoning = (value: string): MessageBlock => ({
  type: "reasoning",
  text: value,
});
const tool: MessageBlock = {
  callId: "call-1",
  name: "read",
  state: "complete",
  type: "tool",
};

test("取消之后什么都没有:那是空白(界面不该把它画成一条回复)", () => {
  // 宿主造的那条失败消息就是"一个空文本块"(`emitRunFailure`);provider 中止时也可能给零块。
  assert.equal(isBlankAssistantMessage(message([text("")])), true);
  assert.equal(isBlankAssistantMessage(message([])), true);
  // 只有空白也算空 —— 它同样是占位,不是内容。
  assert.equal(isBlankAssistantMessage(message([text("   \n  ")])), true);
});

test("**中止的那一条带 errorMessage,但它仍然是空白** —— 那句话界面根本不会显示", () => {
  // 真实形状(见 `createFailureMessage` 与 tool-activity-groups 的用例):中止消息带着
  // `errorMessage: "Request was aborted."`,而错误行只对 `status === "error"` 显示。
  // 判据把 errorMessage 一律当"有话说"的话,用户看到的就是一个只有头像的空壳(实测报过)。
  assert.equal(
    isBlankAssistantMessage(
      message([text("")], { errorMessage: "Request was aborted." }),
    ),
    true,
  );
  assert.equal(
    isBlankAssistantMessage(message([], { errorMessage: "Request was aborted." })),
    true,
  );
});

test("已经吐出来的东西:一律不算空白(取消之前干过的事必须看得见)", () => {
  assert.equal(isBlankAssistantMessage(message([text("部分回复")])), false);
  assert.equal(isBlankAssistantMessage(message([text(""), reasoning("想过一下")])), false);
  assert.equal(isBlankAssistantMessage(message([text(""), tool])), false);
  // 工具跑完再取消:工具块就是这一轮的全部证据。
  assert.equal(isBlankAssistantMessage(message([tool])), false);
});

test("还在流式中:空白是正常的 —— 那时要看的是运行状态", () => {
  assert.equal(
    isBlankAssistantMessage(message([text("")], { status: "streaming" })),
    false,
  );
});

test("失败了的那一条有话说:它不是空白", () => {
  // `status === "error"` 的那一条**会被显示出来**(`shouldShowAssistantResponseError`),
  // 所以哪怕正文为空,也不能当成"没有回复"。
  assert.equal(
    isBlankAssistantMessage(
      message([text("")], { status: "error", errorMessage: "boom" }),
    ),
    false,
  );
});

test("用户消息永远不是空白:取消不抹掉用户发出去的东西", () => {
  assert.equal(
    isBlankAssistantMessage(message([text("")], { role: "user", status: "complete" })),
    false,
  );
});