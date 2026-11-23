// lib/scheduling/timezone.ts
//
// Pure, client-safe timezone-conversion helpers. Deliberately has NO
// "server-only" guard and NO imports of lib/db/* — unlike
// lib/scheduling/blocks.ts (which re-exports these two functions for every
// existing server-side caller), this module is the one components/schedule/
// booking-form.tsx (a Client Component) imports from. blocks.ts pulls in
// withTenantContext -> lib/db/client.ts, which throws at module-load time
// without DATABASE_RUNTIME_URL and is backed by `pg` (Node-only, not
// browser-safe) — importing that chain from a "use client" module would
// crash every page load in the browser (the "server-only" package throws
// as soon as it runs where `window` is defined) and drag a Node Postgres
// client into the client bundle. These two pure functions have no such
// dependency, so they live here instead, and blocks.ts re-exports them
// unchanged so every other existing caller (lib/scheduling/appointments.ts,
// app/dashboard/schedule/page.tsx) keeps importing from "./blocks"/
// "@/lib/scheduling/blocks" exactly as before.

// --- Timezone-correctness helpers ------------------------------------
//
// Node has no built-in "construct a Date from local wall-clock parts in
// an arbitrary IANA zone" API, so these use the guess-and-correct
// two-pass approach from this phase's plan doc (Global Constraints):
// guess the instant as if the local time were UTC, read back what that
// guess actually displays in the target zone via Intl, and shift by the
// difference. One iteration is sufficient except exactly at a DST
// transition boundary (not exercised by this task's tests).

function formatPartsInZone(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`Intl.DateTimeFormat did not produce a "${type}" part`);
    }
    return Number(part.value);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

// Converts a specific local wall-clock date+time in `timeZone` into the
// correct UTC instant.
export function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const displayed = formatPartsInZone(guess, timeZone);
  const displayedAsUtcMs = Date.UTC(
    displayed.year,
    displayed.month - 1,
    displayed.day,
    displayed.hour,
    displayed.minute
  );
  const intendedAsUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const diffMs = displayedAsUtcMs - intendedAsUtcMs;
  return new Date(guess.getTime() - diffMs);
}

// The local calendar date (year/month/day) `date` falls on in `timeZone`.
// Exported for reuse by lib/scheduling/appointments.ts's weekly series
// generation (Task 9) and app/dashboard/schedule/page.tsx's day-boundary
// calculation, which need the same "which local calendar date does this
// instant fall on" primitive.
export function getLocalDateInTimezone(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const { year, month, day } = formatPartsInZone(date, timeZone);
  return { year, month, day };
}
