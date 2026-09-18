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
