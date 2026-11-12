// lib/validation/branding.test.ts
import { describe, expect, test } from "vitest";
import { updateBrandingSchema } from "./branding";

describe("updateBrandingSchema", () => {
  test("accepts a well-formed, non-reserved slug", () => {
    const result = updateBrandingSchema.safeParse({ slug: "starlight-ballroom" });
    expect(result.success).toBe(true);
  });

  test("rejects a reserved slug", () => {
    const result = updateBrandingSchema.safeParse({ slug: "dashboard" });
    expect(result.success).toBe(false);
  });

  test("rejects every reserved slug", () => {
    for (const slug of [
      "app",
      "www",
      "api",
      "admin",
      "auth",
      "mail",
      "login",
      "dashboard",
      "static",
      "assets",
    ]) {
      const result = updateBrandingSchema.safeParse({ slug });
      expect(result.success).toBe(false);
    }
  });
});
