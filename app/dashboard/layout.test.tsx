// app/dashboard/layout.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DashboardNav } from "./dashboard-nav";
import type { PublicBranding } from "@/lib/branding/public-branding";

// vitest.config.mts doesn't set `test.globals: true`, so
// @testing-library/react's own auto-cleanup never registers — without
// this, the "shows a branding settings link" test's render stays mounted
// into the next test, so the global `screen` query below would still find
// its link. See components/branding-settings-form.test.tsx for the same
// note.
afterEach(cleanup);

function makeBranding(overrides: Partial<PublicBranding> = {}): PublicBranding {
  return {
    studioId: "studio-1",
    studioName: "Starlight Ballroom",
    slug: "starlight-ballroom",
    themePreset: "ocean",
    accentColorOverride: null,
    colorMode: "system",
    logoUrl: null,
    ...overrides,
  };
}

describe("DashboardNav", () => {
  test("renders the studio name", () => {
    render(<DashboardNav branding={makeBranding()} canManageBranding={false} />);
    expect(screen.getByText("Starlight Ballroom")).not.toBeNull();
  });

  test("renders the logo image when logoUrl is set", () => {
    render(
      <DashboardNav
        branding={makeBranding({ logoUrl: "https://example.com/logo.png" })}
        canManageBranding={false}
      />
    );
    const img = screen.getByRole("img", { name: "Starlight Ballroom" });
    expect(img.getAttribute("src")).toBe("https://example.com/logo.png");
    // object-contain (not object-cover) so a non-square logo is scaled to
    // fit rather than cropped.
    expect(img.className).toContain("object-contain");
  });

  test("renders a generic fallback mark when logoUrl is null", () => {
    const { container } = render(
      <DashboardNav branding={makeBranding({ logoUrl: null })} canManageBranding={false} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-logo-fallback]")).not.toBeNull();
  });

  test("shows a branding settings link when the user can manage branding", () => {
    render(<DashboardNav branding={makeBranding()} canManageBranding={true} />);
    const link = screen.getByRole("link", { name: /branding settings/i });
    expect(link.getAttribute("href")).toBe("/dashboard/settings/branding");
  });

  test("hides the branding settings link when the user cannot manage branding", () => {
    render(<DashboardNav branding={makeBranding()} canManageBranding={false} />);
    expect(screen.queryByRole("link", { name: /branding settings/i })).toBeNull();
  });
});
