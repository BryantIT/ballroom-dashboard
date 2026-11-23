// components/room-settings.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, waitFor, within, cleanup } from "@testing-library/react";
import { RoomSettings } from "./room-settings";

// Same reason as components/instructor-location-settings.test.tsx: this
// component calls next/navigation's useRouter() to refresh the parent
// Server Component after a successful creation.
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

describe("RoomSettings", () => {
  test("an Owner/Admin can add a room to a location and sees it reflected immediately", async () => {
    const created = { id: "room-1", name: "Ballroom A", locationId: "loc-1" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.stubGlobal("fetch", fetchMock);

    render(<RoomSettings studioId="studio-1" locations={locations} rooms={[]} />);

    // No rooms yet anywhere.
    expect(screen.getAllByText(/no rooms configured yet/i)).toHaveLength(2);

    const mainStudioSection = screen.getByText("Main Studio").closest("div") as HTMLElement;
    fireEvent.change(within(mainStudioSection).getByLabelText(/add a room/i), {
      target: { value: "Ballroom A" },
    });
    fireEvent.click(within(mainStudioSection).getByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/locations/loc-1/rooms",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Ballroom A" }),
        })
      );
    });

    // Reflected immediately in the Main Studio section, without waiting
    // for router.refresh()'s round trip.
    await waitFor(() => {
      expect(within(mainStudioSection).getByText("Ballroom A")).not.toBeNull();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  test("renders existing rooms for each location from the initial rooms prop", () => {
    render(
      <RoomSettings
        studioId="studio-1"
        locations={locations}
        rooms={[{ id: "room-1", name: "Annex Floor", locationId: "loc-2" }]}
      />
    );

    const annexSection = screen.getByText("Annex").closest("div") as HTMLElement;
    expect(within(annexSection).getByText("Annex Floor")).not.toBeNull();
  });

  test("surfaces the error message from a failed creation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<RoomSettings studioId="studio-1" locations={locations} rooms={[]} />);

    const mainStudioSection = screen.getByText("Main Studio").closest("div") as HTMLElement;
    fireEvent.change(within(mainStudioSection).getByLabelText(/add a room/i), {
      target: { value: "Ballroom A" },
    });
    fireEvent.click(within(mainStudioSection).getByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(within(mainStudioSection).getByText("Forbidden")).not.toBeNull();
    });
  });

  test("the Add button stays disabled until a non-blank name is entered", () => {
    render(<RoomSettings studioId="studio-1" locations={locations} rooms={[]} />);

    const mainStudioSection = screen.getByText("Main Studio").closest("div") as HTMLElement;
    const addButton = within(mainStudioSection).getByRole("button", { name: /add/i }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    fireEvent.change(within(mainStudioSection).getByLabelText(/add a room/i), {
      target: { value: "   " },
    });
    expect(addButton.disabled).toBe(true);

    fireEvent.change(within(mainStudioSection).getByLabelText(/add a room/i), {
      target: { value: "Ballroom A" },
    });
    expect(addButton.disabled).toBe(false);
  });
});
