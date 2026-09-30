/**
 * 助手回复底部操作行的可见性。
 *
 * 这里曾经只有一个 `showFooter = !isRunning && isLastMessage`,于是"复制 / 用量详情 / 时间戳"
 * 只在**最新那条**消息底下出现 —— 那不是任何人的本意,只是几个判断被合成了一个开关。
 *
 * 拆开之后:
 *
 * - **每条**回复都有的:复制、用量详情、时间戳(它们是这条回复自己的属性);
 * - **只有最新一轮**才有的:重做 / 版本切换 —— 重做是"以这一轮为末端重写之后的历史",
 *   对中间的回复做重做在语义上不成立,还会把后面已经发生的对话丢掉。它由调用方决定是否传入,
 *   不在这里判。
 *
 * 四种情况下不显示:
 *
 * 1. 还没有消息(用户刚发出去、助手还没出声);
 * 2. 这一行就是**正在生成**的那一轮 —— 回复没答完,不该摆"复制"和用量;
 * 3. 还有消息在流(`status === "streaming"`);
 * 4. 有待处理的交互(审批 / 提问)。
 *
 * 第 2 条和第 3 条不是重复:文本流式那段会标 `streaming`,但**一次调用完成、工具在跑、下一次
 * 调用还没出字**的空档里,行里的消息全是 `complete` —— 只看流式标记,那一刻就会冒出一个不该
 * 有的操作行。第 2 条由调用方给(会话在跑 **且** 这是最后一行),覆盖所有"还没答完"的形态;
 * 第 3 条留着,防的是状态标记与元数据不同步。
 */
export function assistantFooterVisibility(input: {
  hasPendingInteraction: boolean;
  isStreaming: boolean;
  /** 这一行就是正在生成的那一轮(调用方:会话在跑 且 这是最后一行)。 */
  isTurnRunning: boolean;
  messageCount: number;
}): { showActions: boolean } {
  if (input.messageCount === 0) return { showActions: false };
  if (input.isTurnRunning) return { showActions: false };
  if (input.isStreaming) return { showActions: false };
  if (input.hasPendingInteraction) return { showActions: false };
  return { showActions: true };
}
