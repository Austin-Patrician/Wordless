import assert from "node:assert/strict";
import test from "node:test";
import { projectSessionTurnVersions } from "../src/session-branches.ts";

/**
 * Exercises the real agent session tree, because retry depends on journal
 * invariants that fixtures cannot prove: `moveTo` rewinds the leaf, appends
 * parent to that leaf (creating a sibling version), and `leaf` markers are
 * written into the journal without becoming branch entries.
 */
async function createSession() {
  const agent = (await import("@wordless/agent")) as unknown as {
    InMemorySessionStorage: new (options: {
      metadata: { createdAt: string; id: string };
    }) => unknown;
    Session: new (storage: unknown) => {
      appendMessage(message: unknown, entryId?: string): Promise<string>;
      appendCustomEntry(customType: string, data?: unknown): Promise<string>;
      appendCustomMessageEntry(
        customType: string,
        content: string,
        display: boolean,
        details?: unknown,
      ): Promise<string>;
      getBranch(): Promise<{ id: string }[]>;
      getEntries(): Promise<{ id: string; parentId: string | null; type: string }[]>;
      getLeafId(): Promise<string | null>;
      moveTo(entryId: string | null): Promise<string | undefined>;
    };
  };
  const storage = new agent.InMemorySessionStorage({
    metadata: { createdAt: new Date(0).toISOString(), id: "session-retry" },
  });
  return new agent.Session(storage);
}

function message(role: "assistant" | "user", text: string) {
  return { role, content: [{ type: "text", text }] };
}

test("rewinding the leaf turns a regenerated response into a sibling version", async () => {
  const session = await createSession();
  const userEntryId = await session.appendMessage(message("user", "explain retry"));
  await session.appendMessage(message("assistant", "first answer"));

  await session.moveTo(userEntryId);
  await session.appendCustomMessageEntry("wordless.retry-instruction", "<wordless-retry>shorter</wordless-retry>", false);
  await session.appendMessage(message("assistant", "second answer"));

  const entries = await session.getEntries();
  const versions = projectSessionTurnVersions(
    entries as never,
    await session.getLeafId(),
  );
  const projected = versions.get(userEntryId);
  assert.equal(projected?.total, 2);
  assert.equal(projected?.active, 2);

  const branchEntryIds = (await session.getBranch()).map((entry) => entry.id);
  assert.equal(branchEntryIds.length, 3);
  assert.ok(
    (await session.getLeafId()) !== null &&
      branchEntryIds.includes((await session.getLeafId()) as string),
  );

  // The user message survives the retry, the superseded answer leaves the model
  // context, and the regenerated answer is what the next turn builds on.
  const retriedContext = (await session.buildContext()).messages.map((entry) =>
    JSON.stringify((entry as { content?: unknown }).content),
  );
  assert.equal(retriedContext.length, 3);
  assert.match(retriedContext[0]!, /"explain retry"/);
  assert.match(retriedContext[1]!, /wordless-retry/);
  assert.match(retriedContext[2]!, /"second answer"/);
  assert.ok(!retriedContext.some((entry) => entry.includes("first answer")));

  // Switching back must restore the first answer as the active branch.
  await session.moveTo(projected!.tips[0]!);
  const restoredIds = (await session.getBranch()).map((entry) => entry.id);
  assert.equal(restoredIds.length, 2);
  const restored = projectSessionTurnVersions(
    await session.getEntries() as never,
    await session.getLeafId(),
  ).get(userEntryId);
  assert.equal(restored?.active, 1);
});

/**
 * 自动重试(模型侧可重试错误)与用户重答走的是**同一套 journal 机制**(`moveTo` + 追加),
 * 但只有后者是用户可选的版本。区别写在 journal 里:自动重试会先写一条
 * `wordless.model-retry` 标记,指向被摘下来的那条失败响应。
 *
 * 这条测试走真实的 `Session`(而不是夹具),因为要证明的正是"真实写入的形状能被认出来":
 * 标记条目 `type: "custom"`、挂在用户消息下,重试出的回复挂在**标记下面**。
 */
test("an automatic retry leaves no version behind, while a user retry still does", async () => {
  const session = await createSession();
  const userEntryId = await session.appendMessage(message("user", "why did it fail"));
  const failedEntryId = await session.appendMessage(message("assistant", "connection error"));

  // 驱动在自动重试之前的动作:把失败响应摘下来 → 写标记(它成为新的叶子)→ 重跑。
  await session.moveTo(userEntryId);
  await session.appendCustomEntry("wordless.model-retry", {
    attempt: 1,
    failedMessageEntryId: failedEntryId,
  });
  const recoveredEntryId = await session.appendMessage(message("assistant", "recovered answer"));

  const afterAutomaticRetry = projectSessionTurnVersions(
    await session.getEntries() as never,
    await session.getLeafId(),
  );
  // 用户没要过第二份答案 —— 界面上不该出现 <2/2>,更不该能切到那条失败响应。
  assert.equal(afterAutomaticRetry.get(userEntryId), undefined);

  // 用户真的点了重答:这才是一个版本。
  await session.moveTo(userEntryId);
  await session.appendCustomMessageEntry("wordless.retry-instruction", "<wordless-retry>again</wordless-retry>", false);
  const userRetryEntryId = await session.appendMessage(message("assistant", "user-requested answer"));

  const projected = projectSessionTurnVersions(
    await session.getEntries() as never,
    await session.getLeafId(),
  ).get(userEntryId);
  assert.equal(projected?.total, 2);
  assert.equal(projected?.active, 2);
  // 两个版本是"自动重试后那条"和"用户重答那条";失败那条不在其中。
  assert.deepEqual(projected?.tips, [recoveredEntryId, userRetryEntryId]);
  assert.ok(!projected!.tips.includes(failedEntryId));

  // 版本切换要把叶子移到 tip 上,并且真的能看到那一版的内容。
  await session.moveTo(projected!.tips[0]!);
  const restored = await session.buildContext();
  assert.ok(restored.messages.some((entry) => JSON.stringify(entry.content).includes("recovered answer")));
});
