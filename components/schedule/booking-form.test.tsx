// components/schedule/booking-form.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
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

  function fillRecurringSeries(seriesEnd: string, dayOfWeek: string) {
    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-a" } });
    fireEvent.click(screen.getByRole("radio", { name: /recurring weekly/i }));
    fireEvent.change(screen.getByLabelText(/day of week/i), { target: { value: dayOfWeek } });
    fireEvent.change(screen.getByLabelText(/series start date/i), { target: { value: "2026-11-16" } });
    fireEvent.change(screen.getByLabelText(/series end date/i), { target: { value: seriesEnd } });
  }

  // Final-review Finding 4: the server treats seriesEndDate as an EXCLUSIVE
  // bound, so the client must send the start of the day AFTER the chosen
  // end date, or the end date's own lesson is silently dropped.
  test("sends the start of the NEXT local day as seriesEndDate, so a lesson on the chosen end date is included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ seriesId: "series-1", created: [], skipped: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const aucklandLocations = [{ id: "loc-nz", name: "Auckland Studio", timezone: "Pacific/Auckland" }];
    const aucklandRooms = [{ id: "room-nz", name: "Studio NZ", locationId: "loc-nz" }];
    render(<BookingForm {...baseProps()} locations={aucklandLocations} rooms={aucklandRooms} />);

    // 2026-12-14 is itself a Monday — the series' own dayOfWeek.
    fillRecurringSeries("2026-12-14", "1");
    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/studios/studio-1/appointments/series",
      expect.objectContaining({ method: "POST" })
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.seriesEndDate).toBe(localDateTimeToUtc(2026, 12, 15, 0, 0, "Pacific/Auckland").toISOString());
    expect(body.seriesEndDate).not.toBe(localDateTimeToUtc(2026, 12, 14, 0, 0, "Pacific/Auckland").toISOString());
  });

  test("rolls the exclusive series end boundary over a month/year end", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ seriesId: "series-1", created: [], skipped: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingForm {...baseProps()} />);
    // 2026-12-31 is a Thursday.
    fillRecurringSeries("2026-12-31", "4");
    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.seriesEndDate).toBe(new Date("2027-01-01T00:00:00.000Z").toISOString());
  });

  // Final-review Finding 5: skipped weeks must be surfaced to the user.
  test("shows which occurrences were skipped after a recurring series is booked with conflicts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        seriesId: "series-1",
        created: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
        skipped: [
          {
            date: "2026-11-23T10:00:00.000Z",
            reason: "Instructor instr-a already has an overlapping appointment",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingForm {...baseProps()} />);
    fillRecurringSeries("2026-12-14", "1");
    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));

    const warning = await screen.findByTestId("series-skip-warning");
    const text = warning.textContent ?? "";
    expect(text).toMatch(/booked 3 weekly lessons/i);
    expect(text).toMatch(/1 week was skipped/i);
    expect(text).toContain(
      new Date("2026-11-23T10:00:00.000Z").toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    );
    expect(text).toContain("Instructor instr-a already has an overlapping appointment");
    // Informational, not styled as an error.
    expect(warning.className).not.toContain("text-destructive");
    expect(refreshMock).toHaveBeenCalled();
  });

  test("clears the skipped-occurrences message on the next submit attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          seriesId: "series-1",
          created: [],
          skipped: [{ date: "2026-11-23T10:00:00.000Z", reason: "Room conflict" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ seriesId: "series-2", created: [{ id: "a1" }], skipped: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingForm {...baseProps()} />);
    fillRecurringSeries("2026-12-14", "1");
    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));
    await screen.findByTestId("series-skip-warning");

    // The form resets students/instructor after success; re-select them.
    fireEvent.click(screen.getByRole("checkbox", { name: /alex example/i }));
    fireEvent.change(screen.getByLabelText(/^instructor$/i), { target: { value: "instr-a" } });
    fireEvent.click(screen.getByRole("button", { name: /book lesson/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("series-skip-warning")).toBeNull());
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
