import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_CATCH_UP_WINDOW_MS,
  latestMissedAutomationRun,
  nextAutomationRun,
} from "../src/main/automation/automation-schedule.ts";

function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

test("daily schedules preserve local wall clock", () => {
  assert.equal(nextAutomationRun({ kind: "recurring", cadence: "daily", time: "09:00" }, local(2026, 8, 12, 8), null, null), local(2026, 8, 12, 9));
  assert.equal(nextAutomationRun({ kind: "recurring", cadence: "daily", time: "09:00" }, local(2026, 8, 12, 10), null, null), local(2026, 8, 13, 9));
});

test("weekday schedules skip weekends", () => {
  assert.equal(nextAutomationRun({ kind: "recurring", cadence: "weekdays", time: "09:00" }, local(2026, 8, 14, 10), null, null), local(2026, 8, 17, 9));
});

test("weekly schedules select configured weekday", () => {
  assert.equal(nextAutomationRun({ kind: "recurring", cadence: "weekly", weekdays: [5], time: "17:30" }, local(2026, 8, 12, 10), null, null), local(2026, 8, 14, 17, 30));
});

test("monthly schedules skip months without the selected day", () => {
  assert.equal(nextAutomationRun({ kind: "recurring", cadence: "monthly", dayOfMonth: 31, time: "09:00" }, local(2026, 4, 1), null, null), local(2026, 5, 31, 9));
});

test("interval and once schedules respect absolute time", () => {
  assert.equal(nextAutomationRun({ kind: "interval", every: 2, unit: "hours" }, 1_000, null, null), 7_201_000);
  assert.equal(nextAutomationRun({ kind: "once", at: 10_000 }, 1_000, null, null), 10_000);
  assert.equal(nextAutomationRun({ kind: "once", at: 10_000 }, 10_000, null, null), null);
});

test("active end date suppresses later runs", () => {
  assert.equal(nextAutomationRun({ kind: "recurring", cadence: "daily", time: "09:00" }, local(2026, 8, 12, 10), null, local(2026, 8, 12, 23)), null);
});

test("catch-up uses only the most recent missed recurring run", () => {
  const now = local(2026, 8, 13, 12);
  assert.equal(
    latestMissedAutomationRun(
      { kind: "recurring", cadence: "daily", time: "09:00" },
      local(2026, 8, 10, 9),
      now,
      null,
      null,
    ),
    local(2026, 8, 13, 9),
  );
});

test("catch-up uses one missed interval and one missed once schedule", () => {
  assert.equal(
    latestMissedAutomationRun(
      { kind: "interval", every: 2, unit: "hours" },
      1_000,
      7_500_000,
      null,
      null,
    ),
    7_201_000,
  );
  assert.equal(
    latestMissedAutomationRun(
      { kind: "once", at: 10_000 },
      10_000,
      20_000,
      null,
      null,
    ),
    10_000,
  );
});

test("catch-up skips runs outside the recovery window", () => {
  assert.equal(
    latestMissedAutomationRun(
      { kind: "once", at: 0 },
      0,
      AUTOMATION_CATCH_UP_WINDOW_MS + 1,
      null,
      null,
    ),
    null,
  );
});
