import assert from "node:assert/strict";
import test from "node:test";

import { assistantFooterVisibility } from "../src/renderer/features/thread/assistant-message-footer.ts";

/**
 * 守卫:操作行是**每条**回复自己的属性,不是"最新那条"的属性。
 *
 * 这个判定原来被合在一个 `showFooter = !isRunning && isLastMessage` 里,于是复制与用量详情
 * 只在最新一条消息底下出现。这里锁的就是"别再合回去"。
 */

const settled = { hasPendingInteraction: false, isStreaming: false, isTurnRunning: false, messageCount: 1 };

test("一条已经答完的回复:显示操作行(与它是不是最新无关)", () => {
  assert.equal(assistantFooterVisibility(settled).showActions, true);
});

test("正在生成的那一轮不显示 —— 哪怕行里的消息都已经 complete", () => {
  // 这次踩到的就是它:一次调用完成、工具在跑、下一次调用还没出字的那段空档里,
  // 行里没有任何 `streaming` 消息,只看流式标记就会冒出一个不该有的操作行。
  assert.equal(assistantFooterVisibility({ ...settled, isTurnRunning: true }).showActions, false);
});

test("还在流的那一行不显示:用量还没定,复制也还早", () => {
  assert.equal(assistantFooterVisibility({ ...settled, isStreaming: true }).showActions, false);
});

test("有待处理交互(审批 / 提问)的那一行不显示", () => {
  assert.equal(assistantFooterVisibility({ ...settled, hasPendingInteraction: true }).showActions, false);
});

test("用户刚发出去、助手还没出声的行没有操作行", () => {
  assert.equal(assistantFooterVisibility({ ...settled, messageCount: 0 }).showActions, false);
});
