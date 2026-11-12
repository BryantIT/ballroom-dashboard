// lib/validation/branding.ts
import { z } from "zod";
import { THEME_PRESET_KEYS } from "../branding/presets";

export const updateBrandingSchema = z.object({
  themePreset: z.enum(THEME_PRESET_KEYS).optional(),
  accentColorOverride: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  colorMode: z.enum(["light", "dark", "system"]).optional(),
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
});
