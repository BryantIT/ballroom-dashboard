// lib/scheduling/conflicts.ts
import "server-only";
import { and, eq, gt, lt, ne, notInArray } from "drizzle-orm";
import type { Tx } from "../db/with-tenant-context";
import { appointments, rooms } from "../db/schema";
import { listBlocksInRange } from "./blocks";

// Appointment statuses that no longer occupy an instructor's calendar or a
// room — a canceled/late-canceled/no-show appointment doesn't block a new
// booking over the same slot. Every other status (the default "scheduled",
// plus "checked_in"/"completed") still counts as occupying the slot.
const INACTIVE_STATUSES = ["canceled", "late_canceled", "no_show"] as const;

// Overlap predicate used by every time-range check in this module (this
// phase's plan doc, Task 8 brief): a half-open interval, so one appointment
// ending exactly when another starts does not conflict.
//   candidateStart < other.endAt AND candidateEnd > other.startAt

export class InstructorConflictError extends Error {
  constructor(instructorUserId: string, startAt: Date, endAt: Date) {
    super(
      `Instructor ${instructorUserId} already has an overlapping appointment between ` +
        `${startAt.toISOString()} and ${endAt.toISOString()}`
    );
    this.name = "InstructorConflictError";
  }
}

export class RoomConflictError extends Error {
  constructor(roomId: string, startAt: Date, endAt: Date) {
    super(
      `Room ${roomId} already has an overlapping appointment between ` +
        `${startAt.toISOString()} and ${endAt.toISOString()}`
    );
    this.name = "RoomConflictError";
  }
}

export class RoomLocationMismatchError extends Error {
  constructor(roomId: string, locationId: string) {
    super(`Room ${roomId} does not belong to location ${locationId}`);
    this.name = "RoomLocationMismatchError";
  }
}

export class InstructorUnavailableError extends Error {
  constructor(instructorUserId: string, startAt: Date, endAt: Date) {
    super(
      `Instructor ${instructorUserId} is unavailable between ` +
        `${startAt.toISOString()} and ${endAt.toISOString()}`
    );
    this.name = "InstructorUnavailableError";
  }
}

// Throws if `instructorUserId` already has any non-canceled/non-late_canceled/
// non-no_show appointment overlapping [startAt, endAt), REGARDLESS of that
// other appointment's location — an instructor can't be in two places at
// once, even across two different locations of the same studio (acceptance
// test #4). `excludeAppointmentId` lets a reschedule check for conflicts
// against every OTHER appointment without tripping over itself.
export async function checkInstructorConflict(
  tx: Tx,
  studioId: string,
  instructorUserId: string,
  startAt: Date,
  endAt: Date,
  excludeAppointmentId?: string
): Promise<void> {
  const conditions = [
    eq(appointments.studioId, studioId),
    eq(appointments.instructorUserId, instructorUserId),
    notInArray(appointments.status, [...INACTIVE_STATUSES]),
    lt(appointments.startAt, endAt),
    gt(appointments.endAt, startAt),
  ];
  if (excludeAppointmentId) {
    conditions.push(ne(appointments.id, excludeAppointmentId));
  }

  const [conflicting] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(...conditions))
    .limit(1);

  if (conflicting) {
    throw new InstructorConflictError(instructorUserId, startAt, endAt);
  }
}

// Throws if `roomId` already has any non-canceled/non-late_canceled/
// non-no_show appointment overlapping [startAt, endAt). Same
// excludeAppointmentId rationale as checkInstructorConflict.
export async function checkRoomConflict(
  tx: Tx,
  studioId: string,
  roomId: string,
  startAt: Date,
  endAt: Date,
  excludeAppointmentId?: string
): Promise<void> {
  const conditions = [
    eq(appointments.studioId, studioId),
    eq(appointments.roomId, roomId),
    notInArray(appointments.status, [...INACTIVE_STATUSES]),
    lt(appointments.startAt, endAt),
    gt(appointments.endAt, startAt),
  ];
  if (excludeAppointmentId) {
    conditions.push(ne(appointments.id, excludeAppointmentId));
  }

  const [conflicting] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(...conditions))
    .limit(1);

  if (conflicting) {
    throw new RoomConflictError(roomId, startAt, endAt);
  }
}

// Throws if `roomId`'s own locationId doesn't match the appointment's
// locationId (acceptance test #5) — including when the room can't be found
// at all (e.g. it belongs to a different studio and is invisible under this
// tx's tenant context), which fails closed as a mismatch rather than
// silently permitting the booking.
export async function checkRoomLocationMatch(tx: Tx, roomId: string, locationId: string): Promise<void> {
  const [room] = await tx.select({ locationId: rooms.locationId }).from(rooms).where(eq(rooms.id, roomId));

  if (!room || room.locationId !== locationId) {
    throw new RoomLocationMismatchError(roomId, locationId);
  }
}

// Throws if [startAt, endAt) overlaps either (a) one of this instructor's
// OWN instructorBlocks rows (regular_day_off/personal_time_off — another
// instructor's personal time off never blocks this one, per this phase's
// plan doc), or (b) any studio-wide studio_holiday, which blocks every
// instructor.
//
// `locationId` is the candidate appointment's own location — per this
// task's required signature (carried forward from Task 6's review), it is
// passed through to listBlocksInRange's own locationId argument so
// regular_day_off expansion uses that location's timezone directly, rather
// than listBlocksInRange's instructor-location inference fallback (which
// would be ambiguous for an instructor assigned to multiple locations in
// different timezones).
export async function checkAvailabilityBlock(
  tx: Tx,
  studioId: string,
  instructorUserId: string,
  startAt: Date,
  endAt: Date,
  locationId: string
): Promise<void> {
  // listBlocksInRange's regular_day_off expansion only returns occurrences
  // whose START falls inside the queried [rangeStart, rangeEnd) — it is not
  // itself a full overlap check. A day-off occurrence that began earlier the
  // same local day (before our candidate's startAt) but still extends into
  // our candidate window would be missed if we queried only
  // [startAt, endAt). A regular_day_off occurrence never spans more than one
  // calendar day, so widening the query's lower bound by 24h is sufficient
  // to always capture it; the real overlap predicate below (not this query
  // range) is what actually decides whether it conflicts.
  const queryStart = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
  const blocks = await listBlocksInRange(studioId, queryStart, endAt, locationId, tx);

  const conflicting = blocks.find(
    (block) =>
      (block.instructorUserId === instructorUserId || block.instructorUserId === null) &&
      block.startAt < endAt &&
      block.endAt > startAt
  );

  if (conflicting) {
    throw new InstructorUnavailableError(instructorUserId, startAt, endAt);
  }
}
