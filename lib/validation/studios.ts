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

export const updateStudentSchema = z.object({
  displayName: z.string().min(1).max(200),
});
