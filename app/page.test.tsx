// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BrandedSplash } from "./page";

// vitest.config.mts doesn't set `test.globals: true`, so
// @testing-library/react's own auto-cleanup never registers — each of
// this file's 4 tests would otherwise leave its render mounted when the
// next one starts. Left unmounted, React's scheduler can still have
// pending work queued on these orphaned roots when jsdom's `window` is
// torn down at the end of the run, surfacing as an intermittent
// "ReferenceError: window is not defined" from deep inside
// react-dom — not a real assertion failure, so it's easy to miss that
// this file is the cause. Same pattern already applied in
// components/branding-settings-form.test.tsx for the same reason.
afterEach(cleanup);

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
