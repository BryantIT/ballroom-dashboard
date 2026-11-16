// components/instructor-location-settings.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, waitFor, within, cleanup } from "@testing-library/react";
import { InstructorLocationSettings } from "./instructor-location-settings";

// Same reason as components/branding-settings-form.test.tsx: this
// component calls next/navigation's useRouter() to refresh the parent
// Server Component after a successful assignment.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
  vi.unstubAllGlobals();
});

const locations = [
  { id: "loc-1", name: "Main Studio" },
  { id: "loc-2", name: "Annex" },
];
const instructors = [
  { instructorUserId: "instr-a", name: "Instructor A" },
  { instructorUserId: "instr-b", name: "Instructor B" },
];

describe("InstructorLocationSettings", () => {
  test("an Owner/Admin can assign an instructor to a location and sees it reflected immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InstructorLocationSettings
        studioId="studio-1"
        locations={locations}
        instructors={instructors}
        assignments={[]}
      />
    );

    // Not yet assigned anywhere.
    expect(screen.getAllByText(/no instructors assigned yet/i)).toHaveLength(2);

    const mainStudioSection = screen.getByText("Main Studio").closest("div") as HTMLElement;
    fireEvent.change(
      mainStudioSection.querySelector('select[id^="assign-instructor-"]') as HTMLSelectElement,
      { target: { value: "instr-a" } }
    );
    fireEvent.click(
      mainStudioSection.querySelector('button') as HTMLButtonElement
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/instructor-locations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ instructorUserId: "instr-a", locationId: "loc-1" }),
        })
      );
    });

    // Reflected immediately in the Main Studio section, without waiting
    // for router.refresh()'s round trip.
    await waitFor(() => {
      expect(within(mainStudioSection).getByText("Instructor A")).not.toBeNull();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  test("renders already-assigned instructors for each location from the initial assignments prop", () => {
    render(
      <InstructorLocationSettings
        studioId="studio-1"
        locations={locations}
        instructors={instructors}
        assignments={[{ instructorUserId: "instr-b", locationId: "loc-2" }]}
      />
    );

    const annexSection = screen.getByText("Annex").closest("div") as HTMLElement;
    expect(within(annexSection).getByText("Instructor B")).not.toBeNull();
  });

  test("surfaces the error message from a failed assignment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InstructorLocationSettings
        studioId="studio-1"
        locations={locations}
        instructors={instructors}
        assignments={[]}
      />
    );

    const mainStudioSection = screen.getByText("Main Studio").closest("div") as HTMLElement;
    fireEvent.change(
      mainStudioSection.querySelector('select[id^="assign-instructor-"]') as HTMLSelectElement,
      { target: { value: "instr-a" } }
    );
    fireEvent.click(mainStudioSection.querySelector("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(within(mainStudioSection).getByText("Forbidden")).not.toBeNull();
    });
  });
});
