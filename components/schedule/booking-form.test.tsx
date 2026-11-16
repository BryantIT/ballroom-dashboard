// components/schedule/booking-form.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { BookingForm } from "./booking-form";
import { localDateTimeToUtc } from "@/lib/scheduling/timezone";

// Same reason as components/student-form.test.tsx: this component calls
// next/navigation's useRouter() to refresh the parent Server Component
// after a successful booking.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
  vi.unstubAllGlobals();
});

const locations = [{ id: "loc-1", name: "Main Studio", timezone: "UTC" }];
const rooms = [{ id: "room-1", name: "Studio A", locationId: "loc-1" }];
const instructors = [
  { instructorUserId: "instr-a", name: "Instructor A" },
  { instructorUserId: "instr-b", name: "Instructor B" },
];
const instructorLoad = [
  { instructorUserId: "instr-a", name: "Instructor A", activeStudentCount: 5 },
  { instructorUserId: "instr-b", name: "Instructor B", activeStudentCount: 1 },
];

function baseProps() {
  return {
    studioId: "studio-1",
    students: [
      { id: "s1", displayName: "Alex Example", currentInstructorUserId: "instr-a" },
      { id: "s2", displayName: "Nina New", currentInstructorUserId: null },
    ],
    instructors,
    instructorLoad,
    locations,
    rooms,
  };
}

describe("BookingForm", () => {
  test("does not show the cross-instructor-reason prompt when the selected instructor matches the student's current assignment", () => {
    render(<BookingForm {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-a" } });

    expect(screen.queryByLabelText(/reason/i)).toBeNull();
  });

  test("shows the cross-instructor-reason prompt (preset reasons + note field) when the selected instructor differs from the student's current assignment", () => {
    render(<BookingForm {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-b" } });

    const reasonSelect = screen.getByLabelText(/reason/i) as HTMLSelectElement;
    expect(reasonSelect).not.toBeNull();
    expect(screen.getByText(/buddy lesson/i)).not.toBeNull();
    expect(screen.getByLabelText(/note/i)).not.toBeNull();
  });

  test("never shows the reason prompt for a new/unassigned student, even when picking a specific instructor via the load picker", () => {
    render(<BookingForm {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /nina new/i }));
    // New/unassigned student routes to the instructor-load picker, not the
    // plain instructor <select>.
    expect(screen.getByText(/instructor \(by current load\)/i)).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /instructor b/i }));

    expect(screen.queryByLabelText(/reason/i)).toBeNull();
  });

  test("blocks submission until a reason is chosen, then allows it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "appt-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingForm {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-b" } });

    const submitButton = screen.getByRole("button", { name: /book lesson/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(submitButton);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "buddy_lesson" } });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submitButton);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/studios/studio-1/appointments",
      expect.objectContaining({ method: "POST" })
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.attendeeStudentIds).toEqual(["s1"]);
    expect(body.instructorUserId).toBe("instr-b");
    expect(body.locationId).toBe("loc-1");
    expect(body.roomId).toBe("room-1");
    expect(body.crossInstructorReason).toEqual({ code: "buddy_lesson" });
  });

  test("submits a one-off booking immediately when no cross-instructor reason is required", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "appt-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingForm {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-a" } });

    const submitButton = screen.getByRole("button", { name: /book lesson/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submitButton);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/studios/studio-1/appointments",
      expect.objectContaining({ method: "POST" })
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.attendeeStudentIds).toEqual(["s1"]);
    expect(body.instructorUserId).toBe("instr-a");
    expect(body.crossInstructorReason).toBeUndefined();
  });

  test("builds the one-off startAt/endAt instants in the selected location's timezone, not the browser's local offset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "appt-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    // vitest's jsdom environment runs in UTC by default, so a location
    // offset from UTC (here, Pacific/Auckland) is what would actually catch
    // the bug this test guards against: `new Date(`${date}T${startTime}:00`)`
    // parses as browser-local time (UTC here) rather than resolving through
    // the location's own timezone.
    const aucklandLocations = [{ id: "loc-nz", name: "Auckland Studio", timezone: "Pacific/Auckland" }];
    const aucklandRooms = [{ id: "room-nz", name: "Studio NZ", locationId: "loc-nz" }];

    render(<BookingForm {...baseProps()} locations={aucklandLocations} rooms={aucklandRooms} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-a" } });
    fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^start time$/i), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText(/^end time$/i), { target: { value: "11:00" } });

    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/studios/studio-1/appointments",
      expect.objectContaining({ method: "POST" })
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);

    const expectedStartAt = localDateTimeToUtc(2026, 6, 15, 10, 0, "Pacific/Auckland");
    const expectedEndAt = localDateTimeToUtc(2026, 6, 15, 11, 0, "Pacific/Auckland");

    expect(body.startAt).toBe(expectedStartAt.toISOString());
    expect(body.endAt).toBe(expectedEndAt.toISOString());
    // Sanity check that the bug this test guards against would actually be
    // caught: Pacific/Auckland is offset from UTC, so the naive
    // `new Date(`${date}T${startTime}:00`)` (parsed as UTC in this test
    // environment) must differ from the correct, timezone-resolved instant.
    expect(body.startAt).not.toBe(new Date("2026-06-15T10:00:00").toISOString());
  });

  test("shows the server's error message when the booking request is rejected with a conflict", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Instructor already has an appointment at this time" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingForm {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-a" } });
    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));

    await screen.findByText("Instructor already has an appointment at this time");
  });
});
