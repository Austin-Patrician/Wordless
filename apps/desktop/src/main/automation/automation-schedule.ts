import type { AutomationSchedule } from "@wordless/domain";

function parseClock(value: string): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Time must use HH:mm format");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Time must use HH:mm format");
  return [hour, minute];
}

function intervalMs(schedule: Extract<AutomationSchedule, { kind: "interval" }>): number {
  const multiplier = schedule.unit === "minutes" ? 60_000 : schedule.unit === "hours" ? 3_600_000 : 86_400_000;
  return schedule.every * multiplier;
}

export function validateAutomationClock(value: string): void {
  parseClock(value);
}

export function nextAutomationRun(schedule: AutomationSchedule, after: number, activeFrom: number | null, activeUntil: number | null): number | null {
  const lowerBound = Math.max(after + 1, activeFrom ?? 0);
  let candidate: number;
  if (schedule.kind === "once") candidate = schedule.at;
  else if (schedule.kind === "interval") candidate = Math.max(after, activeFrom ?? after) + intervalMs(schedule);
  else {
    const [hour, minute] = parseClock(schedule.time);
    const date = new Date(lowerBound);
    date.setSeconds(0, 0);
    date.setHours(hour, minute, 0, 0);
    if (date.getTime() < lowerBound) date.setDate(date.getDate() + 1);
    for (let checked = 0; checked < 400; checked += 1) {
      const weekday = date.getDay();
      const valid = schedule.cadence === "daily"
        || (schedule.cadence === "weekdays" && weekday >= 1 && weekday <= 5)
        || (schedule.cadence === "weekly" && (schedule.weekdays ?? []).includes(weekday))
        || (schedule.cadence === "monthly" && date.getDate() === schedule.dayOfMonth);
      if (valid) break;
      date.setDate(date.getDate() + 1);
      date.setHours(hour, minute, 0, 0);
    }
    candidate = date.getTime();
  }
  if (candidate < lowerBound || (activeUntil !== null && candidate > activeUntil)) return null;
  return candidate;
}
