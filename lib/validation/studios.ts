// lib/validation/studios.ts
import { z } from "zod";

export const createStudioSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1),
});

export const createLocationSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1),
});

export const createInvitationSchema = z.object({
  email: z.email(),
  roleId: z.uuid(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export const createStudentSchema = z.object({
  displayName: z.string().min(1).max(200),
  email: z.email().optional(),
  phone: z.string().max(40).optional(),
});

export const updateStudentSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    email: z.email().optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
  })
  // All fields are optional (partial update), so an empty body would
  // otherwise parse successfully and reach the route's `.set({})` with no
  // columns. Drizzle's `.set()` throws ("No values to set") rather than
  // emitting a no-op SQL statement, which surfaces as an unhandled 500
  // instead of a 400. Reject it here instead.
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const linkStudentsSchema = z.object({
  studentBId: z.uuid(),
});

export const createNoteSchema = z.object({
  body: z.string().min(1),
  restricted: z.boolean().optional(),
});

export const assignInstructorLocationSchema = z.object({
  instructorUserId: z.uuid(),
  locationId: z.uuid(),
});

export const createRoomSchema = z.object({
  name: z.string().min(1).max(200),
});
