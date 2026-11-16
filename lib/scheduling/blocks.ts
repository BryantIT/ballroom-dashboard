// lib/scheduling/blocks.ts
import "server-only";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { instructorBlocks, locations } from "../db/schema";
import * as schema from "../db/schema";
import { requirePermission } from "../auth/authorization";
import { listInstructorLocations } from "./instructor-locations";
import { localDateTimeToUtc, getLocalDateInTimezone } from "./timezone";
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
// Moved to lib/scheduling/timezone.ts (a pure module with no "server-only"
// guard and no lib/db/* import) so components/schedule/booking-form.tsx (a
// Client Component) can import localDateTimeToUtc without dragging this
// file's withTenantContext -> lib/db/client.ts chain — a Node Postgres
// client plus a module that throws as soon as it runs in the browser —
// into the client bundle. Re-exported here unchanged so every existing
// server-side caller keeps importing from "./blocks"/"@/lib/scheduling/
// blocks" exactly as before.
export { localDateTimeToUtc, getLocalDateInTimezone };

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
// availability (self-service) provided they hold appointments.manage_self;
// anyone managing a block for a *different* instructor needs
// appointments.manage_all.
//
// The self-service branch MUST still call requirePermission — it is not
// a no-op "allow it" just because instructorUserId === userId. RLS's
// tenant_isolation WITH CHECK on studio_id only confirms the inserted
// row's tenant column matches whatever app.tenant_id this transaction
// happens to have set; it does NOT confirm the caller actually has a
// membership in that studio. Without this check, any authenticated user
// could insert a block into an arbitrary studioId just by naming
// themselves as instructorUserId. requirePermission confirms both a
// real active membership and the appointments.manage_self grant that
// already governs managing one's own schedule.
export async function createBlock(
  userId: string,
  studioId: string,
  input: CreateBlockInput,
  database?: Db
): Promise<Block> {
  const isSelfService = input.kind !== "studio_holiday" && input.instructorUserId === userId;
  if (isSelfService) {
    await requirePermission(userId, studioId, "appointments.manage_self", database);
  } else {
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

// Timezone of one specific, known location — used when listBlocksInRange
// is called with an explicit locationId (e.g. checking a candidate
// appointment that already has its own locationId), which must win over
// any instructor-location inference: an instructor who works at two
// locations in different timezones has no single unambiguous "Monday"
// otherwise.
async function resolveLocationTimezone(
  studioId: string,
  locationId: string,
  database?: Db
): Promise<string> {
  const [location] = await withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) => tx.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, locationId)),
    database
  );
  if (!location) {
    throw new Error(`Location ${locationId} not found in studio ${studioId}`);
  }
  return location.timezone;
}

// Resolves which location's timezone governs a given instructor's
// regular_day_off expansion when no explicit locationId was given.
// Prefers the instructor's own assigned location(s)
// (lib/scheduling/instructor-locations.ts); if the instructor has none
// assigned, falls back to the studio's only location, if it has exactly
// one. This is a deliberate simplification for the no-locationId case —
// once a real appointment exists (Task 7/9) and its locationId is passed
// in, resolveLocationTimezone above is used instead, which is
// unambiguous even for a studio with multiple locations in different
// timezones. Never falls back to UTC/server-local (this phase's plan
// doc, Global Constraints) — an instructor with no resolvable location
// throws instead.
export async function resolveInstructorTimezone(
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
// occurrences that OVERLAP [rangeStart, rangeEnd) — not merely occurrences
// whose start falls inside it. A day-off block is at most one calendar day
// long, so an occurrence that starts before rangeStart can still extend
// into the queried window (e.g. a 09:00-17:00 Monday block queried against
// [12:00, 13:00) that same Monday); the half-open overlap predicate below
// (occurrenceStart < rangeEnd AND occurrenceEnd > rangeStart) — the same
// one lib/scheduling/conflicts.ts's checks use — is what actually decides
// inclusion, never a start-in-range check alone. The calendar-date scan
// itself (`cursor`) is pure UTC-anchored date arithmetic — it only ever
// indexes a (year, month, day) triple, never a real instant, so adding 24h
// per step has no DST ambiguity. Only the final per-occurrence conversion
// (localDateTimeToUtc) is timezone-aware.
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
      if (occurrenceStart < rangeEnd && occurrenceEnd > rangeStart) {
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
// date that OVERLAPS [startAt, endAt) (see expandRegularDayOff), alongside
// the one-off personal_time_off/studio_holiday rows as-is (also included
// whenever they overlap the range, via the same half-open predicate).
//
// `locationId` is optional and, when given, takes priority over the
// instructor-location inference for every regular_day_off row resolved
// by this call — intended for Task 8's conflict check against one
// specific candidate appointment that already has its own locationId,
// which is unambiguous even for an instructor assigned to multiple
// locations in different timezones. When omitted, the existing fallback
// (infer from the instructor's assigned location, else the studio's sole
// location) is used exactly as before — a reasonable default for a
// broad calendar view with no specific appointment in play.
export async function listBlocksInRange(
  studioId: string,
  startAt: Date,
  endAt: Date,
  locationId?: string,
  database?: Db
): Promise<ResolvedBlock[]> {
  const rows = await withTenantContext(
    { userId: "", tenantId: studioId },
    (tx) => tx.select().from(instructorBlocks).where(eq(instructorBlocks.studioId, studioId)),
    database
  );

  // Resolved once, up front, rather than per-row: when given, every
  // regular_day_off row in this call uses this same explicit timezone.
  const explicitTimeZone = locationId
    ? await resolveLocationTimezone(studioId, locationId, database)
    : undefined;

  const resolved: ResolvedBlock[] = [];

  for (const row of rows) {
    if (row.kind === "regular_day_off") {
      const timeZone =
        explicitTimeZone ?? (await resolveInstructorTimezone(studioId, row.instructorUserId!, database));
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
