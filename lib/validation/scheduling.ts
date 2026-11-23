// lib/validation/scheduling.ts
import { z } from "zod";

// "HH:MM", 24-hour, zero-padded — matches instructorBlocks.startTime/endTime
// (lib/db/schema.ts).
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected time in HH:MM (24-hour) format");

const labelField = z.string().min(1).max(500).optional();

// Discriminated union on `kind`: each variant lists exactly its own
// fields, and `.strict()` on every variant rejects extra fields — so a
// `regular_day_off` payload that also includes `startAt`/`endAt` (or vice
// versa) fails validation here, before it ever reaches the service.
export const createBlockSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("regular_day_off"),
      instructorUserId: z.uuid(),
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: hhmm,
      endTime: hhmm,
      label: labelField,
    })
    .strict()
    .refine((data) => data.startTime < data.endTime, {
      message: "startTime must be before endTime",
      path: ["endTime"],
    }),
  z
    .object({
      kind: z.literal("personal_time_off"),
      instructorUserId: z.uuid(),
      startAt: z.coerce.date(),
      endAt: z.coerce.date(),
      label: labelField,
    })
    .strict()
    .refine((data) => data.startAt < data.endAt, {
      message: "startAt must be before endAt",
      path: ["endAt"],
    }),
  z
    .object({
      kind: z.literal("studio_holiday"),
      startAt: z.coerce.date(),
      endAt: z.coerce.date(),
      label: labelField,
    })
    .strict()
    .refine((data) => data.startAt < data.endAt, {
      message: "startAt must be before endAt",
      path: ["endAt"],
    }),
]);

export type CreateBlockInput = z.infer<typeof createBlockSchema>;

// --- Phase 3: appointment booking (Task 9) --------------------------

// Required only when an attendee's current primary instructor differs
// from the instructor the appointment is being booked with (see
// lib/scheduling/appointments.ts's CrossInstructorReasonRequiredError).
const crossInstructorReasonSchema = z
  .object({
    code: z.enum(["buddy_lesson", "instructor_unavailable", "considering_switch", "other"]),
    note: z.string().min(1).max(1000).optional(),
  })
  .strict();

export const createAppointmentSchema = z
  .object({
    instructorUserId: z.uuid(),
    locationId: z.uuid(),
    roomId: z.uuid(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    // At least one attendee — a single student for a private lesson, or
    // two for a "buddy"/couple's lesson booked as one appointment with
    // two appointment_attendees rows.
    attendeeStudentIds: z.array(z.uuid()).min(1),
    crossInstructorReason: crossInstructorReasonSchema.optional(),
  })
  .strict()
  .refine((data) => data.startAt < data.endAt, {
    message: "startAt must be before endAt",
    path: ["endAt"],
  });

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const createAppointmentSeriesSchema = z
  .object({
    instructorUserId: z.uuid(),
    locationId: z.uuid(),
    roomId: z.uuid(),
    attendeeStudentIds: z.array(z.uuid()).min(1),
    crossInstructorReason: crossInstructorReasonSchema.optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: hhmm,
    endTime: hhmm,
    seriesStartDate: z.coerce.date(),
    // Open-ended when omitted — bounded by createAppointmentSeries's own
    // 12-week default window regardless (lib/scheduling/appointments.ts).
    seriesEndDate: z.coerce.date().optional(),
  })
  .strict()
  .refine((data) => data.startTime < data.endTime, {
    message: "startTime must be before endTime",
    path: ["endTime"],
  });

export type CreateAppointmentSeriesInput = z.infer<typeof createAppointmentSeriesSchema>;

// --- Phase 3: appointment status transitions (Task 10) ---------------
//
// "scheduled" is deliberately excluded as a valid request body value —
// it's only ever an appointment's initial status (set by
// createAppointment/createAppointmentSeries), never a transition target.
// Matches AppointmentTransitionTarget in lib/scheduling/appointment-status.ts.
export const transitionAppointmentStatusSchema = z
  .object({
    status: z.enum(["checked_in", "completed", "canceled", "late_canceled", "no_show"]),
  })
  .strict();

export type TransitionAppointmentStatusInput = z.infer<typeof transitionAppointmentStatusSchema>;
