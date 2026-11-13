// lib/scheduling/blocks.ts
import "server-only";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { instructorBlocks, locations } from "../db/schema";
import * as schema from "../db/schema";
import { requirePermission } from "../auth/authorization";
import { listInstructorLocations } from "./instructor-locations";
import type { CreateBlockInput } from "../validation/scheduling";

type Db = NodePgDatabase<typeof schema>;

export type Block = typeof instructorBlocks.$inferSelect;

export type ResolvedBlock = {
  id: string;
  studioId: string;
  instructorUserId: string | null;
  kind: Block["kind"];
  label: string | null;
  startAt: Date;
  endAt: Date;
};

export class MissingLocationTimezoneError extends Error {
  constructor(studioId: string, instructorUserId: string) {
    super(
      `Cannot resolve a location timezone for instructor ${instructorUserId} in studio ${studioId} — assign ` +
        "them to a location (instructor_locations) or ensure the studio has exactly one location"
    );
    this.name = "MissingLocationTimezoneError";
  }
}

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
function getLocalDateInTimezone(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const { year, month, day } = formatPartsInZone(date, timeZone);
  return { year, month, day };
}

function parseHHMM(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [hour, minute];
}

// --- Visibility --------------------------------------------------------

// Pure function — a personal_time_off/day_off's label is visible only to
// the instructor it belongs to, or to a viewer who can see every label
// (appointments.manage_all). Everyone else sees that the slot is blocked
// but never the reason (this phase's plan doc, Global Constraints).
export function getBlockLabel(
  viewerUserId: string,
  block: { instructorUserId: string | null; label: string | null },
  viewerCanSeeAllLabels: boolean
): string | null {
  if (viewerCanSeeAllLabels || viewerUserId === block.instructorUserId) {
    return block.label;
  }
  return null;
}

// --- Writes --------------------------------------------------------

// Permission rule: a studio_holiday (instructorUserId always null)
// always requires appointments.manage_all. Otherwise (regular_day_off /
// personal_time_off), the block's own instructor may manage their own
// availability with no further permission check (self-service); anyone
// managing a block for a *different* instructor needs
// appointments.manage_all.
export async function createBlock(
  userId: string,
  studioId: string,
  input: CreateBlockInput,
  database?: Db
): Promise<Block> {
  const isSelfService = input.kind !== "studio_holiday" && input.instructorUserId === userId;
  if (!isSelfService) {
    await requirePermission(userId, studioId, "appointments.manage_all", database);
  }

  const isRegularDayOff = input.kind === "regular_day_off";

  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [created] = await tx
        .insert(instructorBlocks)
        .values({
          studioId,
          instructorUserId: input.kind === "studio_holiday" ? null : input.instructorUserId,
          kind: input.kind,
          dayOfWeek: isRegularDayOff ? input.dayOfWeek : null,
          startTime: isRegularDayOff ? input.startTime : null,
          endTime: isRegularDayOff ? input.endTime : null,
          startAt: isRegularDayOff ? null : input.startAt,
          endAt: isRegularDayOff ? null : input.endAt,
          label: input.label ?? null,
        })
        .returning();
      return created;
    },
    database
  );
}

// --- Reads --------------------------------------------------------

// Resolves which location's timezone governs a given instructor's
// regular_day_off expansion. Prefers the instructor's own assigned
// location(s) (lib/scheduling/instructor-locations.ts); if the instructor
// has none assigned, falls back to the studio's only location, if it has
// exactly one. This is a deliberate simplification for this task — once
// a real appointment exists (Task 7/9), the appointment's own locationId
// is used directly instead, which is unambiguous even for a studio with
// multiple locations in different timezones. Never falls back to
// UTC/server-local (this phase's plan doc, Global Constraints) — an
// instructor with no resolvable location throws instead.
async function resolveInstructorTimezone(
  studioId: string,
  instructorUserId: string,
  database?: Db
): Promise<string> {
  const assignedLocationIds = await listInstructorLocations(studioId, instructorUserId, database);
  if (assignedLocationIds.length > 0) {
    const [assigned] = await withTenantContext(
      { userId: "", tenantId: studioId },
      (tx) =>
        tx
          .select({ timezone: locations.timezone })
          .from(locations)
          .where(eq(locations.id, assignedLocationIds[0])),
      database
    );
    if (assigned) {
      return assigned.timezone;
    }
  }

  const studioLocations = await withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) =>
      tx
        .select({ timezone: locations.timezone })
        .from(locations)
        .where(eq(locations.studioId, studioId)),
    database
  );
  if (studioLocations.length === 1) {
    return studioLocations[0].timezone;
  }

  throw new MissingLocationTimezoneError(studioId, instructorUserId);
}

// Expands a single regular_day_off row into zero or more concrete
// occurrences whose start falls inside [rangeStart, rangeEnd). The
// calendar-date scan itself (`cursor`) is pure UTC-anchored date
// arithmetic — it only ever indexes a (year, month, day) triple, never a
// real instant, so adding 24h per step has no DST ambiguity. Only the
// final per-occurrence conversion (localDateTimeToUtc) is timezone-aware.
function expandRegularDayOff(
  block: Block,
  rangeStart: Date,
  rangeEnd: Date,
  timeZone: string
): ResolvedBlock[] {
  const occurrences: ResolvedBlock[] = [];
  const [startHour, startMinute] = parseHHMM(block.startTime!);
  const [endHour, endMinute] = parseHHMM(block.endTime!);

  const firstLocalDate = getLocalDateInTimezone(rangeStart, timeZone);
  // The local calendar date of the instant just before rangeEnd — rangeEnd
  // itself is exclusive, so scanning up to (rangeEnd - 1ms)'s local date
  // covers every date that could possibly produce an in-range occurrence.
  const lastLocalDate = getLocalDateInTimezone(new Date(rangeEnd.getTime() - 1), timeZone);

  let cursor = Date.UTC(firstLocalDate.year, firstLocalDate.month - 1, firstLocalDate.day);
  const endCursor = Date.UTC(lastLocalDate.year, lastLocalDate.month - 1, lastLocalDate.day);

  while (cursor <= endCursor) {
    const cursorDate = new Date(cursor);
    const year = cursorDate.getUTCFullYear();
    const month = cursorDate.getUTCMonth() + 1;
    const day = cursorDate.getUTCDate();
    // A pure calendar-date property once year/month/day are already
    // correct for the target timezone — no further tz conversion needed
    // to know which weekday a given (y, m, d) triple is.
    const weekday = cursorDate.getUTCDay();

    if (weekday === block.dayOfWeek) {
      const occurrenceStart = localDateTimeToUtc(year, month, day, startHour, startMinute, timeZone);
      const occurrenceEnd = localDateTimeToUtc(year, month, day, endHour, endMinute, timeZone);
      if (occurrenceStart >= rangeStart && occurrenceStart < rangeEnd) {
        occurrences.push({
          id: block.id,
          studioId: block.studioId,
          instructorUserId: block.instructorUserId,
          kind: block.kind,
          label: block.label,
          startAt: occurrenceStart,
          endAt: occurrenceEnd,
        });
      }
    }

    cursor += 24 * 60 * 60 * 1000;
  }

  return occurrences;
}

// Expands regular_day_off rows into one concrete occurrence per matching
// date inside [startAt, endAt), alongside the one-off
// personal_time_off/studio_holiday rows as-is (included when they overlap
// the range).
export async function listBlocksInRange(
  studioId: string,
  startAt: Date,
  endAt: Date,
  database?: Db
): Promise<ResolvedBlock[]> {
  const rows = await withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) => tx.select().from(instructorBlocks).where(eq(instructorBlocks.studioId, studioId)),
    database
  );

  const resolved: ResolvedBlock[] = [];

  for (const row of rows) {
    if (row.kind === "regular_day_off") {
      const timeZone = await resolveInstructorTimezone(studioId, row.instructorUserId!, database);
      resolved.push(...expandRegularDayOff(row, startAt, endAt, timeZone));
    } else if (row.startAt && row.endAt && row.startAt < endAt && row.endAt > startAt) {
      resolved.push({
        id: row.id,
        studioId: row.studioId,
        instructorUserId: row.instructorUserId,
        kind: row.kind,
        label: row.label,
        startAt: row.startAt,
        endAt: row.endAt,
      });
    }
  }

  return resolved;
}
