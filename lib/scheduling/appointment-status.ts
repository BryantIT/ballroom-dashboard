// lib/scheduling/appointment-status.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { appointments } from "../db/schema";
import * as schema from "../db/schema";
import { requireAppointmentPermission } from "./appointments";

type Db = NodePgDatabase<typeof schema>;

export type Appointment = typeof appointments.$inferSelect;

// The statuses a caller may ever ask to transition an appointment INTO.
// "scheduled" is deliberately excluded — it's only ever the row's initial
// value (set by createAppointment/createAppointmentSeries), never a
// destination of a transition.
export type AppointmentTransitionTarget =
  | "checked_in"
  | "completed"
  | "canceled"
  | "late_canceled"
  | "no_show";

export class IllegalStatusTransitionError extends Error {
  constructor(appointmentId: string, fromStatus: string, toStatus: string) {
    super(`Appointment ${appointmentId} cannot transition from "${fromStatus}" to "${toStatus}"`);
    this.name = "IllegalStatusTransitionError";
  }
}

// Legal transition map, per BR-04 (references/ballroom_dash_spec_v0_3.md):
// "scheduled -> checked_in -> completed (check-in optional); alternative
// terminal outcomes canceled, late_canceled, no_show." Read literally:
//   - scheduled is the only status any of the five outcomes below can be
//     reached FROM. canceled/late_canceled/no_show are alternatives to
//     living out the scheduled -> checked_in -> completed pipeline, not
//     recoveries from partway through it — once an instructor has checked
//     the appointment in, the student demonstrably showed up, so "no_show"
//     and "late_canceled"/"canceled" no longer describe reality.
//   - checked_in's only legal next step is completed (check-in is a
//     midpoint on the one pipeline, not a branch point of its own).
//   - completed, canceled, late_canceled, and no_show are all terminal:
//     nothing may be transitioned out of them (this is also what makes
//     "completed -> scheduled" illegal, and more generally guarantees a
//     terminal appointment's status never changes again).
const LEGAL_TRANSITIONS: Readonly<Record<string, readonly AppointmentTransitionTarget[]>> = {
  scheduled: ["checked_in", "completed", "canceled", "late_canceled", "no_show"],
  checked_in: ["completed"],
  completed: [],
  canceled: [],
  late_canceled: [],
  no_show: [],
};

// Transitions one appointment occurrence's status. Every occurrence
// (whether booked one-off or materialized from a series by
// createAppointmentSeries) is its own independent row with its own
// `status` column — there is no series-level status to keep in sync — so
// this always updates exactly the one row named by `appointmentId`, scoped
// by both id and studioId, and never touches any other row. In particular,
// canceling one occurrence of a recurring series can never alter any
// sibling occurrence's status (see
// lib/scheduling/appointment-status.test.ts's series test, the Review
// Focus item this task owns).
//
// The permission check (same manage_all/manage_self split as
// createAppointment, reused via requireAppointmentPermission from
// lib/scheduling/appointments.ts) is against the TARGET appointment's own
// instructorUserId — which we don't know until we've read the row — so the
// read happens first, same as how createAppointment already knows its
// instructorUserId from its input before checking permission.
export async function transitionAppointmentStatus(
  userId: string,
  studioId: string,
  appointmentId: string,
  newStatus: AppointmentTransitionTarget,
  database?: Db
): Promise<Appointment> {
  const [appointment] = await withTenantContext(
    { userId, tenantId: studioId },
    (tx) =>
      tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.studioId, studioId)))
        .limit(1),
    database
  );

  if (!appointment) {
    throw new Error(`Appointment ${appointmentId} not found in studio ${studioId}`);
  }

  await requireAppointmentPermission(userId, studioId, appointment.instructorUserId, database);

  const legalNextStatuses = LEGAL_TRANSITIONS[appointment.status] ?? [];
  if (!legalNextStatuses.includes(newStatus)) {
    throw new IllegalStatusTransitionError(appointmentId, appointment.status, newStatus);
  }

  // The WHERE clause re-asserts the status read above, as a cheap
  // optimistic-concurrency guard against a second transition racing in
  // between the read and this update: if the row's status already moved
  // on, this matches zero rows rather than silently overwriting whatever
  // the concurrent caller just set.
  const [updated] = await withTenantContext(
    { userId, tenantId: studioId },
    (tx) =>
      tx
        .update(appointments)
        .set({ status: newStatus })
        .where(
          and(
            eq(appointments.id, appointmentId),
            eq(appointments.studioId, studioId),
            eq(appointments.status, appointment.status)
          )
        )
        .returning(),
    database
  );

  if (!updated) {
    throw new IllegalStatusTransitionError(appointmentId, appointment.status, newStatus);
  }

  return updated;
}
