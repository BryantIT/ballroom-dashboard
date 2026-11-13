import { describe, expect, test } from "vitest";
import { studioBranding } from "./schema";

describe("studioBranding table", () => {
  test("has the expected columns with defaults", () => {
    expect(Object.keys(studioBranding)).toEqual(
      expect.arrayContaining([
        "studioId", "slug", "themePreset", "accentColorOverride",
        "colorMode", "logoUrl", "createdAt", "updatedAt",
      ])
    );
  });
});
