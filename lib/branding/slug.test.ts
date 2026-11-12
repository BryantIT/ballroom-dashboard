// lib/branding/slug.test.ts
import { describe, expect, test } from "vitest";
import { slugify, generateUniqueSlug, RESERVED_SLUGS } from "./slug";

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

  test("skips a reserved slug even when isTaken reports it free", async () => {
    // A studio literally named "App" would otherwise slugify to the
    // reserved "app" — it must never be auto-assigned that slug.
    const result = await generateUniqueSlug("App", async () => false);
    expect(result).toBe("app-2");
  });

  test("keeps incrementing past a reserved numeric-suffixed candidate", async () => {
    const taken = new Set(["dashboard-2"]);
    const result = await generateUniqueSlug(
      "Dashboard",
      async (candidate) => taken.has(candidate)
    );
    expect(result).toBe("dashboard-3");
  });
});

describe("RESERVED_SLUGS", () => {
  test("contains the known infrastructure-colliding slugs", () => {
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
      expect(RESERVED_SLUGS.has(slug)).toBe(true);
    }
  });
});
