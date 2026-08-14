import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationMessage,
  SessionExpertSnapshot,
} from "@wordless/domain";
import {
  createExpertCollaborationSnapshot,
  expertConnectorScopes,
} from "../src/index.ts";
import {
  createSessionHistoryPage,
  createSessionHistoryProjection,
} from "../src/session-history.ts";

const expert: SessionExpertSnapshot = {
  kind: "team",
  selection: { kind: "team", id: "content-studio", version: "1" },
  name: "Content Studio",
  systemPrompt: "Coordinate the team.",
  skillIds: [],
  connectorIds: [],
  teamName: "Content Studio",
  teamPortrait: { kind: "builtin", key: "content-studio" },
  leader: {
    expertId: "content-lead",
    expertName: "Content Lead",
    portrait: { kind: "builtin", key: "content-studio" },
    systemPrompt: "Lead the team.",
    skillIds: [],
    connectorIds: [],
  },
  teamMembers: [
    {
      id: "writer",
      expertId: "content-writer",
      expertName: "Writer",
      portrait: { kind: "builtin", key: "content-writer" },
      executionProfile: "workspace-write",
      responsibility: "Write the draft.",
      systemPrompt: "Write clearly.",
      skillIds: [],
      connectorIds: [],
    },
  ],
};

function user(id: string, timestamp: number): ConversationMessage {
  return {
    id,
    role: "user",
    status: "complete",
    blocks: [{ type: "text", text: id }],
    model: null,
    timestamp,
  };
}

function delegation(
  id: string,
  timestamp: number,
  taskId: string,
  status: "running" | "completed",
): ConversationMessage {
  return {
    id,
    role: "assistant",
    status: "complete",
    blocks: [
      {
        type: "tool",
        callId: id,
        name: "delegate_expert",
        state: status === "completed" ? "complete" : "running",
        details: {
          tasks: [
            {
              id: taskId,
              memberId: "writer",
              status,
              events: [
                { id: `event:${taskId}`, type: "output", at: timestamp },
              ],
            },
          ],
        },
      },
    ],
    model: { connectionId: "test", modelId: "test" },
    timestamp,
  };
}

test("keeps delegated members outside the latest history page", () => {
  const messages: ConversationMessage[] = [
    user("u0", 1),
    delegation("a0", 2, "task-1", "completed"),
  ];
  for (let index = 1; index <= 30; index += 1)
    messages.push(user(`u${index}`, index + 2));

  const latest = createSessionHistoryPage(
    createSessionHistoryProjection(messages, []),
    "revision",
  );
  assert.equal(
    latest.items.some(
      (item) =>
        item.type === "turn" &&
        item.turn.messages.some((message) => message.id === "a0"),
    ),
    false,
  );

  const collaboration = createExpertCollaborationSnapshot(messages, expert);
  assert.equal(collaboration?.members.length, 1);
  assert.equal(collaboration?.members[0]?.memberId, "writer");
  assert.equal(collaboration?.members[0]?.taskCount, 1);
});

test("merges repeated delegations and keeps the latest member status", () => {
  const collaboration = createExpertCollaborationSnapshot(
    [
      user("u1", 1),
      delegation("a1", 2, "task-1", "completed"),
      user("u2", 3),
      delegation("a2", 4, "task-2", "running"),
    ],
    expert,
  );

  assert.equal(collaboration?.members.length, 1);
  assert.equal(collaboration?.members[0]?.taskCount, 2);
  assert.equal(collaboration?.members[0]?.latestStatus, "running");
  assert.equal(collaboration?.members[0]?.lastActiveAt, 4);
});

test("exposes the Team Lead before any member is delegated", () => {
  const modernExpert: SessionExpertSnapshot = {
    ...expert,
    name: "Content Lead",
    teamName: "Content Studio",
    teamPortrait: { kind: "builtin", key: "content-studio" },
    leader: {
      expertId: "content-lead",
      expertName: "Content Lead",
      portrait: { kind: "builtin", key: "content-studio" },
      systemPrompt: "Lead the team.",
      skillIds: ["web-research"],
      connectorIds: ["leader-web"],
    },
    skillIds: ["web-research"],
    connectorIds: ["leader-web"],
  };
  const collaboration = createExpertCollaborationSnapshot([], modernExpert);
  assert.equal(collaboration?.leader?.name, "Content Lead");
  assert.equal(collaboration?.teamName, "Content Studio");
  assert.deepEqual(collaboration?.members, []);
});

test("keeps delegated member connectors out of the primary scope", () => {
  const scopes = expertConnectorScopes(["composer"], {
    ...expert,
    connectorIds: ["leader-web"],
    teamMembers: expert.teamMembers.map((member) => ({
      ...member,
      connectorIds: ["writer-mcp"],
    })),
  });
  assert.deepEqual(scopes.primary, ["composer", "leader-web"]);
  assert.deepEqual(scopes.delegates, ["composer", "leader-web", "writer-mcp"]);
});
