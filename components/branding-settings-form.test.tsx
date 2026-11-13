// components/branding-settings-form.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrandingSettingsForm } from "./branding-settings-form";

// This component calls next/navigation's useRouter(), which throws
// ("invariant expected app router to be mounted") when rendered outside a
// real Next.js app-router tree — which every test in this file does. Mock
// it so router.refresh() is just a spy we can assert on.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// vitest.config.mts doesn't set `test.globals: true`, so
// @testing-library/react's own auto-cleanup (which detects a global
// `afterEach`) never registers — each test's render would otherwise
// stay mounted into the next, duplicating any shared markup (like the
// logo guidance text, present on every render) across tests in this file.
afterEach(() => {
  cleanup();
  refreshMock.mockClear();
});

describe("BrandingSettingsForm", () => {
  test("submits the chosen preset to the PATCH branding endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(
      <BrandingSettingsForm
        studioId="studio-1"
        initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "starlight-ballroom", logoUrl: null }}
      />
    );
    fireEvent.click(getByLabelText(/ocean/i));
    fireEvent.click(getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/branding",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  test("refreshes the router after a successful save so the parent layout re-renders with fresh data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole } = render(
      <BrandingSettingsForm
        studioId="studio-1"
        initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "starlight-ballroom", logoUrl: null }}
      />
    );
    fireEvent.click(getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  test("shows the logo upload guidance text", () => {
    const { getByText } = render(
      <BrandingSettingsForm studioId="studio-1" initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "s", logoUrl: null }} />
    );
    expect(getByText(/512.?x.?512/i)).toBeTruthy();
    expect(getByText(/resized/i)).toBeTruthy();
  });

  test("previews the selected preset's accent color live, before saving", () => {
    const { getByLabelText, container } = render(
      <BrandingSettingsForm
        studioId="studio-1"
        initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "s", logoUrl: null }}
      />
    );
    // Midnight's own accent, before any selection change.
    expect(container.querySelector("style[data-branding-preview]")?.textContent).toContain(
      "--primary: #c9a24b"
    );

    fireEvent.click(getByLabelText(/ocean/i));

    // Ocean's accent, live — no save/fetch happened.
    expect(container.querySelector("style[data-branding-preview]")?.textContent).toContain(
      "--primary: #2c7a8c"
    );
  });

  test("previews a typed accent color override live", () => {
    const { getByPlaceholderText, container } = render(
      <BrandingSettingsForm
        studioId="studio-1"
        initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "s", logoUrl: null }}
      />
    );
    fireEvent.change(getByPlaceholderText("#c9a24b"), { target: { value: "#ff00ff" } });
    expect(container.querySelector("style[data-branding-preview]")?.textContent).toContain(
      "--primary: #ff00ff"
    );
  });

  test("offers a color picker bound to the same accent value as the hex input", () => {
    const { getByLabelText, getByPlaceholderText } = render(
      <BrandingSettingsForm
        studioId="studio-1"
        initial={{ themePreset: "midnight", accentColorOverride: null, colorMode: "system", slug: "s", logoUrl: null }}
      />
    );
    const picker = getByLabelText(/pick accent color/i) as HTMLInputElement;
    expect(picker.type).toBe("color");
    // No override set yet — the picker shows the current preset's own accent.
    expect(picker.value).toBe("#c9a24b");

    fireEvent.change(picker, { target: { value: "#00ff00" } });
    expect((getByPlaceholderText("#c9a24b") as HTMLInputElement).value).toBe("#00ff00");
  });
});
