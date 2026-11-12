// app/dashboard/layout.test.tsx
// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardNav } from "./dashboard-nav";
import type { PublicBranding } from "@/lib/branding/public-branding";

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
    render(<DashboardNav branding={makeBranding()} />);
    expect(screen.getByText("Starlight Ballroom")).not.toBeNull();
  });

  test("renders the logo image when logoUrl is set", () => {
    render(
      <DashboardNav
        branding={makeBranding({ logoUrl: "https://example.com/logo.png" })}
      />
    );
    const img = screen.getByRole("img", { name: "Starlight Ballroom" });
    expect(img.getAttribute("src")).toBe("https://example.com/logo.png");
  });

  test("renders a generic fallback mark when logoUrl is null", () => {
    const { container } = render(<DashboardNav branding={makeBranding({ logoUrl: null })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-logo-fallback]")).not.toBeNull();
  });
});
