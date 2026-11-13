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
