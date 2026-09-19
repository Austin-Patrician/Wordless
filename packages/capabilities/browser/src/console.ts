import type { BrowserConsoleEntry, BrowserConsoleLevel } from "./port.js";

/**
 * Console capture for a page the agent is watching.
 *
 * A page that renders but throws is the single most useful thing an agent can be
 * told about while proving its own work, and it is exactly what a screenshot
 * cannot convey. Kept bounded because a chatty page would otherwise grow without
 * limit for as long as the tab stays open.
 *
 * Pure functions over an array: the caller owns the buffer and the id counter, so
 * the retention and paging rules can be tested without a browser.
 */

/** Roughly a few screens of messages; beyond this the oldest are dropped. */
export const MAX_CONSOLE_ENTRIES = 200;

/** Text beyond this is clipped, so one runaway error cannot flood the context. */
export const MAX_CONSOLE_TEXT_LENGTH = 2_000;

export const DEFAULT_CONSOLE_PAGE_SIZE = 50;

export type ConsoleAppendResult = {
  entries: BrowserConsoleEntry[];
  id: number;
  /** How many entries this append evicted. */
  evicted: number;
};

export function appendConsoleEntry(
  entries: readonly BrowserConsoleEntry[],
  nextId: number,
  input: { level: BrowserConsoleLevel; text: string; source?: string | null; line?: number | null },
  limit: number = MAX_CONSOLE_ENTRIES,
): ConsoleAppendResult {
  const entry: BrowserConsoleEntry = {
    id: nextId,
    level: input.level,
    text: clip(input.text, MAX_CONSOLE_TEXT_LENGTH),
    source: input.source ?? null,
    line: input.line ?? null,
  };
  const combined = [...entries, entry];
  const overflow = Math.max(0, combined.length - Math.max(1, limit));
  return {
    entries: overflow > 0 ? combined.slice(overflow) : combined,
    id: nextId + 1,
    evicted: overflow,
  };
}

export type ConsolePage = {
  entries: BrowserConsoleEntry[];
  /** Entries the buffer dropped before they could be reported under `sinceId`. */
  dropped: number;
  errorCount: number;
};

/**
 * Entries after `sinceId`, newest page last.
 *
 * `dropped` is reported rather than hidden: an agent that asked for everything
 * since id 3 and silently receives entries from id 90 would conclude the page was
 * quiet when it was merely rotated out.
 */
export function consoleEntriesSince(
  entries: readonly BrowserConsoleEntry[],
  options: { sinceId?: number; limit?: number } = {},
): ConsolePage {
  const requested = options.sinceId;
  const newer = requested === undefined ? [...entries] : entries.filter((entry) => entry.id > requested);
  const limit = Math.max(1, options.limit ?? DEFAULT_CONSOLE_PAGE_SIZE);
  // Trim from the front: the most recent messages are the ones that explain the
  // current state.
  const page = newer.length > limit ? newer.slice(newer.length - limit) : newer;
  // Ids strictly between what was asked for and the oldest surviving entry were
  // evicted before they could be reported. Distinguishing "quiet" from "rotated
  // out" matters: an agent that asked from id 3 and silently got id 90 back would
  // conclude the page had been silent.
  const availableFrom = entries[0]?.id;
  const dropped =
    requested === undefined || availableFrom === undefined ? 0 : Math.max(0, availableFrom - requested - 1);
  return { entries: page, dropped, errorCount: countConsoleErrors(entries) };
}

export function countConsoleErrors(entries: readonly BrowserConsoleEntry[]): number {
  return entries.filter((entry) => entry.level === "error").length;
}

/**
 * Maps an Electron `console-message` severity onto our levels.
 *
 * Electron reports a numeric severity; anything unrecognised is treated as a
 * plain log rather than dropped, because losing a message is worse than
 * mislabelling one.
 */
export function levelFromSeverity(severity: number): BrowserConsoleLevel {
  switch (severity) {
    case 3: return "error";
    case 2: return "warning";
    case 1: return "info";
    default: return "log";
  }
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}