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
});
