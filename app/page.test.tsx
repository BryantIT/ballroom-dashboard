// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { BrandedSplash } from "./page";

describe("BrandedSplash", () => {
  test("renders the studio's name and a sign-in link", () => {
    const { getByText, getByRole } = render(
      <BrandedSplash
        branding={{
          studioId: "s1",
          studioName: "Starlight Ballroom",
          slug: "starlight-ballroom",
          themePreset: "ocean",
          accentColorOverride: null,
          colorMode: "system",
          logoUrl: null,
        }}
      />
    );
    expect(getByText("Starlight Ballroom")).toBeTruthy();
    // No @testing-library/jest-dom in this project (see
    // app/dashboard/layout.test.tsx for the same plain-DOM-API pattern),
    // so assert the href directly rather than via a toHaveAttribute matcher.
    expect(getByRole("link", { name: /sign in/i }).getAttribute("href")).toBe(
      "/login"
    );
  });

  test("renders the logo with object-contain so a non-square logo is scaled, not cropped", () => {
    const { getByRole } = render(
      <BrandedSplash
        branding={{
          studioId: "s1",
          studioName: "Starlight Ballroom",
          slug: "starlight-ballroom",
          themePreset: "ocean",
          accentColorOverride: null,
          colorMode: "system",
          logoUrl: "https://example.com/logo.png",
        }}
      />
    );
    const img = getByRole("img", { name: "Starlight Ballroom" });
    expect(img.className).toContain("object-contain");
  });

  test("forces light mode in the rendered CSS when the studio's colorMode is 'light'", () => {
    const { container } = render(
      <BrandedSplash
        branding={{
          studioId: "s1",
          studioName: "Starlight Ballroom",
          slug: "starlight-ballroom",
          themePreset: "ocean",
          accentColorOverride: null,
          colorMode: "light",
          logoUrl: null,
        }}
      />
    );
    const css = container.querySelector("style")?.textContent ?? "";
    // Ocean's light background (#eef5f6) should appear in BOTH the
    // [data-theme-root] rule and the .dark [data-theme-root] rule — i.e.
    // mode-locked to light regardless of the .dark class on <html>.
    expect(css.match(/--background: #eef5f6/g)).toHaveLength(2);
  });

  test("does not force a mode when the studio's colorMode is 'system'", () => {
    const { container } = render(
      <BrandedSplash
        branding={{
          studioId: "s1",
          studioName: "Starlight Ballroom",
          slug: "starlight-ballroom",
          themePreset: "ocean",
          accentColorOverride: null,
          colorMode: "system",
          logoUrl: null,
        }}
      />
    );
    const css = container.querySelector("style")?.textContent ?? "";
    // Unforced: light and dark tokens stay distinct.
    expect(css).toContain("--background: #eef5f6");
    expect(css).toContain("--background: #0e1f24");
  });
});
