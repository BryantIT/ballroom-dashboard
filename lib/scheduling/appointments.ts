// lib/scheduling/appointments.ts
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext, type Tx } from "../db/with-tenant-context";
import { appointments, appointmentAttendees, appointmentSeries, studentAssignments, locations } from "../db/schema";
import * as schema from "../db/schema";
import { hasPermission, requirePermission } from "../auth/authorization";
import {
  checkInstructorConflict,
  checkRoomConflict,
  checkRoomLocationMatch,
  checkAvailabilityBlock,
  InstructorConflictError,
  RoomConflictError,
  RoomLocationMismatchError,
  InstructorUnavailableError,
} from "./conflicts";
import { localDateTimeToUtc, getLocalDateInTimezone } from "./blocks";
import type { CreateAppointmentInput, CreateAppointmentSeriesInput } from "../validation/scheduling";

type Db = NodePgDatabase<typeof schema>;

export type Appointment = typeof appointments.$inferSelect;

// The four conflict-check error classes from Task 8 (lib/scheduling/conflicts.ts).
// createAppointmentSeries catches exactly these per-occurrence (see its own
// doc comment below) — anything else (permission errors, a missing
// cross-instructor reason) is a hard failure of the whole call, not a
// per-occurrence skip.
const CONFLICT_ERROR_CLASSES = [
  InstructorConflictError,
  RoomConflictError,
  RoomLocationMismatchError,
  InstructorUnavailableError,
] as const;

function isConflictError(error: unknown): boolean {
  return CONFLICT_ERROR_CLASSES.some((ErrorClass) => error instanceof ErrorClass);
}

export class CrossInstructorReasonRequiredError extends Error {
  constructor(studentId: string, currentInstructorUserId: string, bookedInstructorUserId: string) {
    super(
      `Student ${studentId}'s current primary instructor (${currentInstructorUserId}) differs from the ` +
        `instructor being booked (${bookedInstructorUserId}) — a crossInstructorReason is required`
    );
    this.name = "CrossInstructorReasonRequiredError";
  }
}

// Permission rule (this task's brief): appointments.manage_all lets a staff
// member book for any instructor; appointments.manage_self only lets an
// instructor book their own slot. Mirrors lib/scheduling/blocks.ts's
// createBlock self-service rule — the self-service branch still calls
// requirePermission rather than treating instructorUserId === userId as an
// automatic pass, for the same reason documented there (RLS only confirms
// the tenant column, not that the caller holds a real grant).
async function requireAppointmentPermission(
  userId: string,
  studioId: string,
  instructorUserId: string,
  database?: Db
): Promise<void> {
  if (instructorUserId === userId) {
    if (await hasPermission(userId, studioId, "appointments.manage_all", database)) {
      // Still confirm an active membership exists (hasPermission alone
      // returns false, not throws, for a missing membership — but a true
      // result already implies one; nothing further to do).
      return;
    }
    await requirePermission(userId, studioId, "appointments.manage_self", database);
    return;
  }

  await requirePermission(userId, studioId, "appointments.manage_all", database);
}

// Shared core: runs the four Task 8 conflict checks, then the
// cross-instructor-reason check, then inserts the appointment + attendee
// rows — all against the transaction (`tx`) the caller already opened.
// `seriesId` is null for a one-off appointment, or the owning
// appointment_series row's id for a generated occurrence.
async function bookAppointmentCore(
  tx: Tx,
  studioId: string,
  seriesId: string | null,
  input: {
    instructorUserId: string;
    locationId: string;
    roomId: string;
    startAt: Date;
    endAt: Date;
    attendeeStudentIds: string[];
    crossInstructorReason?: { code: string; note?: string };
  }
): Promise<Appointment> {
  await checkInstructorConflict(tx, studioId, input.instructorUserId, input.startAt, input.endAt);
  await checkRoomConflict(tx, studioId, input.roomId, input.startAt, input.endAt);
  await checkRoomLocationMatch(tx, input.roomId, input.locationId);
  await checkAvailabilityBlock(tx, studioId, input.instructorUserId, input.startAt, input.endAt, input.locationId);

  if (!input.crossInstructorReason) {
    for (const studentId of input.attendeeStudentIds) {
      const [currentPrimary] = await tx
        .select({ instructorUserId: studentAssignments.instructorUserId })
        .from(studentAssignments)
        .where(
          and(
            eq(studentAssignments.studentId, studentId),
            eq(studentAssignments.studioId, studioId),
            eq(studentAssignments.isPrimary, true),
            isNull(studentAssignments.endedAt)
          )
        )
        .limit(1);

      if (currentPrimary && currentPrimary.instructorUserId !== input.instructorUserId) {
        throw new CrossInstructorReasonRequiredError(
          studentId,
          currentPrimary.instructorUserId,
          input.instructorUserId
        );
      }
    }
  }

  const [created] = await tx
    .insert(appointments)
    .values({
      studioId,
      seriesId,
      instructorUserId: input.instructorUserId,
      locationId: input.locationId,
      roomId: input.roomId,
      startAt: input.startAt,
      endAt: input.endAt,
      crossInstructorReasonCode: input.crossInstructorReason?.code ?? null,
      crossInstructorReasonNote: input.crossInstructorReason?.note ?? null,
    })
    .returning();

  await tx.insert(appointmentAttendees).values(
    input.attendeeStudentIds.map((studentId) => ({
      studioId,
      appointmentId: created.id,
      studentId,
    }))
  );

  return created;
}

// Books a single appointment (one-off, or a single occurrence booked
// outside a series). Permission check happens before the transaction is
// even opened — same ordering as lib/scheduling/blocks.ts's createBlock.
export async function createAppointment(
  userId: string,
  studioId: string,
  input: CreateAppointmentInput,
  database?: Db
): Promise<Appointment> {
  await requireAppointmentPermission(userId, studioId, input.instructorUserId, database);

  return withTenantContext(
    { userId, tenantId: studioId },
    (tx) => bookAppointmentCore(tx, studioId, null, input),
    database
  );
}

// --- Weekly series generation ------------------------------------------

const DEFAULT_SERIES_WINDOW_WEEKS = 12;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseHHMM(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [hour, minute];
}

async function resolveLocationTimezone(studioId: string, locationId: string, database?: Db): Promise<string> {
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

// Generates weekly occurrences starting from the first `dayOfWeek` date
// on/after `seriesStartDate`'s own local calendar date, stepping by
// exactly 7 calendar days, each converted to a concrete [startAt, endAt)
// instant via localDateTimeToUtc. `windowEnd` is an EXCLUSIVE instant
// bound (half-open, same convention as every other interval in this
// phase — see lib/scheduling/conflicts.ts) — an occurrence is included
// only while its own startAt instant is strictly before windowEnd. The
// calendar-day stepping itself is pure UTC-anchored y/m/d arithmetic
// (same technique as lib/scheduling/blocks.ts's expandRegularDayOff
// cursor), never a real instant, so it carries no DST ambiguity; only the
// per-occurrence conversion is timezone-aware.
function generateWeeklyOccurrences(
  seriesStartDate: Date,
  windowEnd: Date,
  dayOfWeek: number,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  timeZone: string
): { startAt: Date; endAt: Date }[] {
  const startLocal = getLocalDateInTimezone(seriesStartDate, timeZone);
  let cursor = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);

  // Advance to the first occurrence of dayOfWeek on/after seriesStartDate's
  // own local calendar date (never before it).
  while (new Date(cursor).getUTCDay() !== dayOfWeek) {
    cursor += MS_PER_DAY;
  }

  const occurrences: { startAt: Date; endAt: Date }[] = [];
  // A deterministic upper bound on iterations (rather than `while (true)`
  // + break) — generously padded, since the per-occurrence `startAt >=
  // windowEnd` check below is what actually decides termination.
  const maxIterations = Math.max(0, Math.ceil((windowEnd.getTime() - cursor) / (7 * MS_PER_DAY))) + 2;

  for (let i = 0; i < maxIterations; i++) {
    const cursorDate = new Date(cursor);
    const year = cursorDate.getUTCFullYear();
    const month = cursorDate.getUTCMonth() + 1;
    const day = cursorDate.getUTCDate();

    const startAt = localDateTimeToUtc(year, month, day, startHour, startMinute, timeZone);
    if (startAt >= windowEnd) {
      break;
    }
    const endAt = localDateTimeToUtc(year, month, day, endHour, endMinute, timeZone);
    occurrences.push({ startAt, endAt });

    cursor += 7 * MS_PER_DAY;
  }

  return occurrences;
}

export type CreateAppointmentSeriesResult = {
  seriesId: string;
  created: Appointment[];
  skipped: { date: Date; reason: string }[];
};

// Materializes a weekly recurring series into concrete appointments rows,
// one per week, from `input.seriesStartDate` through
// min(input.seriesEndDate, seriesStartDate + 12 weeks) — an open-ended
// series (no seriesEndDate) is always bounded to this task's 12-week
// default window; a real "keep generating forever" job is out of scope
// here (this phase's plan doc defers it).
//
// Each occurrence is booked in its own transaction via bookAppointmentCore.
// A conflict-class error (any of the four from Task 8 — see
// CONFLICT_ERROR_CLASSES above) aborts and rolls back ONLY that
// occurrence's transaction; it's caught here, recorded in `skipped`, and
// generation continues with the next week. Any other error (a missing
// cross-instructor reason, a permission failure) is NOT one of those four
// classes and propagates, failing the whole call — a real staff workflow
// wants the other weeks booked even if one week collides on a room or
// instructor, but a missing required reason or a permission problem is a
// caller mistake that should fail loudly, not silently skip every week.
export async function createAppointmentSeries(
  userId: string,
  studioId: string,
  input: CreateAppointmentSeriesInput,
  database?: Db
): Promise<CreateAppointmentSeriesResult> {
  await requireAppointmentPermission(userId, studioId, input.instructorUserId, database);

  const timeZone = await resolveLocationTimezone(studioId, input.locationId, database);

  // windowEnd is an EXCLUSIVE instant bound (see generateWeeklyOccurrences)
  // — "min(seriesEndDate, seriesStartDate + 12 weeks)" per this task's
  // brief, with the 12-week default itself also exclusive, so an
  // open-ended series materializes exactly 12 occurrences when its
  // dayOfWeek/startTime land on seriesStartDate's own local date.
  const defaultWindowEnd = new Date(
    input.seriesStartDate.getTime() + DEFAULT_SERIES_WINDOW_WEEKS * 7 * MS_PER_DAY
  );
  const windowEnd = input.seriesEndDate
    ? new Date(Math.min(input.seriesEndDate.getTime(), defaultWindowEnd.getTime()))
    : defaultWindowEnd;

  const [series] = await withTenantContext(
    { userId, tenantId: studioId },
    (tx) =>
      tx
        .insert(appointmentSeries)
        .values({
          studioId,
          instructorUserId: input.instructorUserId,
          locationId: input.locationId,
          roomId: input.roomId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          seriesStartDate: input.seriesStartDate,
          seriesEndDate: input.seriesEndDate ?? null,
        })
        .returning(),
    database
  );

  const [startHour, startMinute] = parseHHMM(input.startTime);
  const [endHour, endMinute] = parseHHMM(input.endTime);

  const occurrences = generateWeeklyOccurrences(
    input.seriesStartDate,
    windowEnd,
    input.dayOfWeek,
    startHour,
    startMinute,
    endHour,
    endMinute,
    timeZone
  );

  const created: Appointment[] = [];
  const skipped: { date: Date; reason: string }[] = [];

  for (const { startAt, endAt } of occurrences) {
    try {
      const appointment = await withTenantContext(
        { userId, tenantId: studioId },
        (tx) =>
          bookAppointmentCore(tx, studioId, series.id, {
            instructorUserId: input.instructorUserId,
            locationId: input.locationId,
            roomId: input.roomId,
            startAt,
            endAt,
            attendeeStudentIds: input.attendeeStudentIds,
            crossInstructorReason: input.crossInstructorReason,
          }),
        database
      );
      created.push(appointment);
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }
      skipped.push({ date: startAt, reason: (error as Error).message });
    }
  }

  return { seriesId: series.id, created, skipped };
}
