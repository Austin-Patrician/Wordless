import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRecord } from "@wordless/domain";
import {
  clampPage,
  contentSearchTargets,
  distinctWorkbenchIds,
  EMPTY_HISTORY_FILTERS,
  filterSessions,
  formatBytes,
  groupSessionsByWorkspace,
  growGroupLimit,
  GROUP_SESSION_CAP,
  initiallyExpandedGroups,
  isEverySelected,
  paginate,
  retainExistingSelection,
  shouldSearchContent,
  sortSessions,
  toggleEverySelection,
  toggleGroupKey,
  toggleSelection,
  totalUsage,
  UNASSIGNED_GROUP_KEY,
  WORKBENCH_LABEL_KEYS,
  workbenchLabelKey,
} from "../src/renderer/features/settings/session-history.ts";

function session(overrides: Partial<SessionRecord> & { id: string }): SessionRecord {
  return {
    title: "Session",
    workspaceId: null,
    runtimeRootPath: "/tmp/s",
    mode: "everyday",
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "default",
    model: { connectionId: "openai", modelId: "m" },
    thinkingLevel: "medium",
    journalPath: "/tmp/s.jsonl",
    connectorIds: [],
    interactionMode: "default",
    toolApprovalMode: "manual",
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("filters combine query, workspace and workbench type", () => {
  const sessions = [
    session({ id: "a", title: "Quarterly Report", workspaceId: "w1", workbenchId: "presentation" }),
    session({ id: "b", title: "数据清洗", workspaceId: "w2", workbenchId: "analysis" }),
    session({ id: "c", title: "report draft", workspaceId: "w1", workbenchId: "conversation" }),
  ];
  assert.equal(filterSessions(sessions, EMPTY_HISTORY_FILTERS).length, 3);
  assert.deepEqual(filterSessions(sessions, { ...EMPTY_HISTORY_FILTERS, query: "REPORT" }).map((s) => s.id), ["a", "c"]);
  assert.deepEqual(filterSessions(sessions, { ...EMPTY_HISTORY_FILTERS, workspaceId: "w1" }).map((s) => s.id), ["a", "c"]);
  assert.deepEqual(
    filterSessions(sessions, { ...EMPTY_HISTORY_FILTERS, workspaceId: "w1", workbenchId: "presentation" }).map((s) => s.id),
    ["a"],
  );
  assert.deepEqual(filterSessions(sessions, { ...EMPTY_HISTORY_FILTERS, query: "report", workspaceId: "w2" }), []);
});

test("sorts by activity, creation, title and size", () => {
  const sessions = [
    session({ id: "old", updatedAt: 100, createdAt: 500, title: "b" }),
    session({ id: "new", updatedAt: 300, createdAt: 100, title: "a" }),
  ];
  const usage = { old: 10, new: 9000 };
  assert.deepEqual(sortSessions(sessions, "recent-activity").map((s) => s.id), ["new", "old"]);
  assert.deepEqual(sortSessions(sessions, "oldest-activity").map((s) => s.id), ["old", "new"]);
  assert.deepEqual(sortSessions(sessions, "created").map((s) => s.id), ["old", "new"]);
  assert.deepEqual(sortSessions(sessions, "title").map((s) => s.id), ["new", "old"]);
  assert.deepEqual(sortSessions(sessions, "largest", usage).map((s) => s.id), ["new", "old"]);
});

// An unmeasured session must not masquerade as empty and jump to the top.
test("sessions without a measured size sort last when ordering by size", () => {
  const sessions = [
    session({ id: "unknown", updatedAt: 900 }),
    session({ id: "small", updatedAt: 1 }),
    session({ id: "big", updatedAt: 1 }),
  ];
  const sorted = sortSessions(sessions, "largest", { small: 10, big: 500 });
  assert.deepEqual(sorted.map((s) => s.id), ["big", "small", "unknown"]);
});

test("sorting does not mutate the input", () => {
  const sessions = [session({ id: "a" }), session({ id: "b" })];
  sortSessions(sessions, "title");
  assert.deepEqual(sessions.map((s) => s.id), ["a", "b"]);
});

test("selection toggles rows and the whole page", () => {
  let selected = toggleSelection(new Set<string>(), "a");
  assert.ok(selected.has("a"));
  selected = toggleSelection(selected, "a");
  assert.equal(selected.has("a"), false);

  assert.equal(isEverySelected(new Set<string>(), []), false);
  const all = toggleEverySelection(new Set<string>(), ["a", "b"]);
  assert.equal(isEverySelected(all, ["a", "b"]), true);
  assert.equal(toggleEverySelection(all, ["a", "b"]).size, 0);
});

test("selection drops ids that no longer exist and is reused when unchanged", () => {
  assert.deepEqual([...retainExistingSelection(new Set(["a", "gone"]), ["a", "b"])], ["a"]);
  const selected = new Set(["a"]);
  assert.equal(retainExistingSelection(selected, ["a", "b"]), selected);
});

test("totals ignore sessions without a measured size", () => {
  assert.equal(totalUsage({ a: 100, b: 50 }, ["a", "b", "missing"]), 150);
  assert.equal(totalUsage({}, ["a"]), 0);
});

test("formats byte counts into readable units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024 * 2.5), "2.5 MB");
  assert.equal(formatBytes(Number.NaN), "0 B");
});

test("content search needs a meaningful query and targets recent sessions", () => {
  assert.equal(shouldSearchContent(""), false);
  assert.equal(shouldSearchContent(" x "), false);
  assert.equal(shouldSearchContent("xy"), true);

  const sessions = Array.from({ length: 20 }, (_, index) => session({ id: `s${index}`, updatedAt: index }));
  const targets = contentSearchTargets(sessions);
  assert.equal(targets.length, 12);
  assert.equal(targets[0], "s19");
  assert.equal(targets.includes("s0"), false);
});

test("lists the workbench types actually present", () => {
  const sessions = [
    session({ id: "a", workbenchId: "conversation" }),
    session({ id: "b", workbenchId: "analysis" }),
    session({ id: "c", workbenchId: "conversation" }),
  ];
  assert.deepEqual(distinctWorkbenchIds(sessions), ["analysis", "conversation"]);
});

test("paginates a long list into contiguous, non-overlapping pages", () => {
  const items = Array.from({ length: 26 }, (_, index) => `s${index}`);
  const first = paginate(items, 1, 10);
  assert.equal(first.total, 26);
  assert.equal(first.pageCount, 3);
  assert.deepEqual(first.items, items.slice(0, 10));

  const last = paginate(items, 3, 10);
  assert.deepEqual(last.items, items.slice(20));
  assert.equal(last.items.length, 6);
});

// Deleting rows or narrowing filters can leave the viewer past the end; the
// list must fall back to the last page that exists rather than rendering empty.
test("clamps out-of-range page numbers", () => {
  assert.equal(clampPage(0, 3), 1);
  assert.equal(clampPage(-5, 3), 1);
  assert.equal(clampPage(2, 3), 2);
  assert.equal(clampPage(99, 3), 3);
  assert.equal(clampPage(Number.NaN, 3), 1);
  assert.equal(paginate([1, 2, 3], 99, 2).page, 2);
});

test("an empty list still reports a usable single page", () => {
  const empty = paginate([], 4, 20);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.pageCount, 1);
  assert.equal(empty.page, 1);
});

test("degenerate page sizes do not divide by zero", () => {
  const paged = paginate([1, 2, 3], 1, 0);
  assert.equal(paged.items.length, 1);
  assert.equal(paged.pageCount, 3);
});

test("select-all covers the visible page while selection survives paging", () => {
  const items = Array.from({ length: 25 }, (_, index) => `s${index}`);
  const page1 = paginate(items, 1, 10).items;
  const page2 = paginate(items, 2, 10).items;

  let selected = toggleEverySelection(new Set<string>(), page1);
  assert.equal(isEverySelected(selected, page1), true);
  assert.equal(isEverySelected(selected, page2), false);

  selected = toggleSelection(selected, page2[0]!);
  assert.equal(selected.size, 11);
});

// The type filter and the row badge both read this map. It previously held a
// hardcoded Chinese table keyed by the wrong ids ("spreadsheet" instead of
// "workbook"), so spreadsheet sessions rendered their raw id and English users
// saw Chinese. Every WorkbenchId must be mapped, and to an i18n key that exists
// in both locales.
test("every workbench type has an i18n label", async () => {
  const { messages } = await import("../src/renderer/shared/i18n.ts");
  const workbenchIds = [
    "conversation",
    "code",
    "presentation",
    "workbook",
    "analysis",
    "ui-preview",
    "media-canvas",
  ] as const;

  for (const id of workbenchIds) {
    const key = workbenchLabelKey(id);
    assert.equal(key, WORKBENCH_LABEL_KEYS[id], `${id} resolves through the map`);
    assert.ok(key, `${id} needs a label key`);
    for (const locale of ["zh-CN", "en-US"] as const) {
      const value = (messages[locale] as Record<string, string>)[key];
      assert.ok(typeof value === "string" && value.trim().length > 0, `${locale}.${key} is missing`);
    }
  }

  assert.equal(workbenchLabelKey("legacy-workbench"), null, "unknown ids fall back to the raw id");
});

test("groups sessions by space, ordering groups by recent activity", () => {
  const sessions = [
    session({ id: "a1", workspaceId: "wa", updatedAt: 10 }),
    session({ id: "b1", workspaceId: "wb", updatedAt: 90 }),
    session({ id: "a2", workspaceId: "wa", updatedAt: 20 }),
  ];
  const groups = groupSessionsByWorkspace(sessions);
  assert.deepEqual(groups.map((group) => group.key), ["wb", "wa"], "most recently used space first");
  // The caller's sort order is preserved inside each group.
  assert.deepEqual(groups[1]!.sessions.map((s) => s.id), ["a1", "a2"]);
});

test("sessions without a space collect into one trailing group", () => {
  const sessions = [
    session({ id: "loose", workspaceId: null, updatedAt: 999 }),
    session({ id: "in-space", workspaceId: "wa", updatedAt: 1 }),
  ];
  const groups = groupSessionsByWorkspace(sessions);
  assert.deepEqual(groups.map((group) => group.key), ["wa", UNASSIGNED_GROUP_KEY]);
  assert.equal(groups[1]!.workspaceId, null);
  assert.deepEqual(groups[1]!.sessions.map((s) => s.id), ["loose"]);
});

test("group totals sum only the sessions inside that group", () => {
  const sessions = [
    session({ id: "a1", workspaceId: "wa" }),
    session({ id: "a2", workspaceId: "wa" }),
    session({ id: "b1", workspaceId: "wb" }),
  ];
  const groups = groupSessionsByWorkspace(sessions, { a1: 100, a2: 50, b1: 7 });
  const wa = groups.find((group) => group.key === "wa")!;
  assert.equal(wa.totalBytes, 150);
  assert.equal(groups.find((group) => group.key === "wb")!.totalBytes, 7);
});

test("an unmeasured group reports zero rather than NaN", () => {
  const groups = groupSessionsByWorkspace([session({ id: "a", workspaceId: "wa" })]);
  assert.equal(groups[0]!.totalBytes, 0);
});

test("groups start collapsed unless there is only one", () => {
  const many = groupSessionsByWorkspace([
    session({ id: "a", workspaceId: "wa" }),
    session({ id: "b", workspaceId: "wb" }),
  ]);
  assert.equal(initiallyExpandedGroups(many).size, 0);

  const single = groupSessionsByWorkspace([session({ id: "a", workspaceId: "wa" })]);
  assert.deepEqual([...initiallyExpandedGroups(single)], ["wa"]);
  assert.equal(initiallyExpandedGroups([]).size, 0);
});

test("group expand state toggles per key", () => {
  let expanded = toggleGroupKey(new Set<string>(), "wa");
  assert.ok(expanded.has("wa"));
  expanded = toggleGroupKey(expanded, "wa");
  assert.equal(expanded.has("wa"), false);
});

test("showing more grows a group limit without exceeding the group", () => {
  assert.equal(growGroupLimit(0, 5), 5);
  assert.equal(growGroupLimit(GROUP_SESSION_CAP, 200), GROUP_SESSION_CAP * 2);
  assert.equal(growGroupLimit(180, 200), 200);
});
