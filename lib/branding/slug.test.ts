// lib/branding/slug.test.ts
import { describe, expect, test } from "vitest";
import { slugify, generateUniqueSlug } from "./slug";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Gold Coast Dance Studio")).toBe("gold-coast-dance-studio");
  });
  test("collapses non-alphanumeric runs and trims edges", () => {
    expect(slugify("  Rock & Roll!! Dance_Co.  ")).toBe("rock-roll-dance-co");
  });
  test("falls back to a generic value when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("studio");
  });
  test("truncates to 63 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(63);
  });
});

describe("generateUniqueSlug", () => {
  test("returns the base slug when it's free", async () => {
    const result = await generateUniqueSlug("Starlight Ballroom", async () => false);
    expect(result).toBe("starlight-ballroom");
  });
  test("appends -2, -3, ... until a free slug is found", async () => {
    const taken = new Set(["starlight-ballroom", "starlight-ballroom-2"]);
    const result = await generateUniqueSlug(
      "Starlight Ballroom",
      async (candidate) => taken.has(candidate)
    );
    expect(result).toBe("starlight-ballroom-3");
  });
});
