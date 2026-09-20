import { expect, it } from "vitest";
import {
  appendConsoleEntry,
  consoleEntriesSince,
  countConsoleErrors,
  levelFromSeverity,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_TEXT_LENGTH,
  type ConsoleAppendResult,
} from "../src/console.ts";
import type { BrowserConsoleEntry } from "../src/port.ts";

function build(count: number, levels: Array<"error" | "log"> = []): { entries: BrowserConsoleEntry[]; nextId: number } {
  let entries: BrowserConsoleEntry[] = [];
  let nextId = 1;
  for (let index = 0; index < count; index++) {
    const result: ConsoleAppendResult = appendConsoleEntry(entries, nextId, {
      level: levels[index] ?? "log",
      text: `message ${index}`,
    });
    entries = result.entries;
    nextId = result.id;
  }
  return { entries, nextId };
}

it("numbers entries so a caller can ask for what is new", () => {
  const { entries, nextId } = build(3);
  expect(entries.map((entry) => entry.id)).toEqual([1, 2, 3]);
  expect(nextId).toBe(4);
});

it("keeps only the newest entries once the buffer is full", () => {
  // A chatty page must not grow the buffer for as long as the tab stays open.
  const { entries } = build(MAX_CONSOLE_ENTRIES + 5);
  expect(entries.length).toBe(MAX_CONSOLE_ENTRIES);
  expect(entries[0]?.id, "the oldest were dropped").toBe(6);
});

it("reports how many entries an append evicted", () => {
  const full = build(MAX_CONSOLE_ENTRIES);
  const result = appendConsoleEntry(full.entries, full.nextId, { level: "log", text: "one more" });
  expect(result.evicted).toBe(1);
});

it("clips a runaway message so one error cannot flood the context", () => {
  const result = appendConsoleEntry([], 1, { level: "error", text: "x".repeat(MAX_CONSOLE_TEXT_LENGTH + 500) });
  expect(result.entries[0]?.text.length).toBe(MAX_CONSOLE_TEXT_LENGTH);
});

it("returns everything when no cursor is given", () => {
  const { entries } = build(4);
  const page = consoleEntriesSince(entries);
  expect(page.entries.length).toBe(4);
  expect(page.dropped, "nothing was asked for, so nothing was lost").toBe(0);
});

it("returns only entries newer than the cursor", () => {
  const { entries } = build(5);
  const page = consoleEntriesSince(entries, { sinceId: 3 });
  expect(page.entries.map((entry) => entry.id)).toEqual([4, 5]);
  expect(page.dropped).toBe(0);
});

it("reports entries evicted between the cursor and the oldest survivor", () => {
  // Without this an agent asking from an old cursor would read an empty page as a
  // quiet page, when the messages had simply rotated out.
  const { entries } = build(MAX_CONSOLE_ENTRIES + 4);
  const page = consoleEntriesSince(entries, { sinceId: 1 });
  expect(page.dropped, "ids 2, 3 and 4 were evicted").toBe(3);
});

it("never reports negative drops for a cursor ahead of the buffer", () => {
  const { entries } = build(2);
  expect(consoleEntriesSince(entries, { sinceId: 99 }).dropped).toBe(0);
});

it("trims a long page from the front so the newest messages survive", () => {
  const { entries } = build(10);
  const page = consoleEntriesSince(entries, { limit: 3 });
  expect(page.entries.map((entry) => entry.id)).toEqual([8, 9, 10]);
});

it("counts errors across the whole buffer, not just the returned page", () => {
  const { entries } = build(6, ["error", "log", "error", "log", "log", "log"]);
  expect(countConsoleErrors(entries)).toBe(2);
  expect(consoleEntriesSince(entries, { limit: 1 }).errorCount).toBe(2);
});

it("maps Electron severities, defaulting unknown values to a log", () => {
  expect(levelFromSeverity(3)).toBe("error");
  expect(levelFromSeverity(2)).toBe("warning");
  expect(levelFromSeverity(1)).toBe("info");
  expect(levelFromSeverity(0)).toBe("log");
  // Losing a message is worse than mislabelling one.
  expect(levelFromSeverity(42)).toBe("log");
});

it("handles an empty buffer", () => {
  const page = consoleEntriesSince([], { sinceId: 7 });
  expect(page.entries).toEqual([]);
  expect(page.dropped).toBe(0);
  expect(page.errorCount).toBe(0);
});

