// components/availability-block-form.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { AvailabilityBlockForm } from "./availability-block-form";
import { localDateTimeToUtc } from "@/lib/scheduling/timezone";

// Same reason as components/branding-settings-form.test.tsx: this
// component calls next/navigation's useRouter() to refresh the parent
// Server Component after a successful save.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
  vi.unstubAllGlobals();
});

const instructors = [
  { instructorUserId: "me", name: "Me Myself" },
  { instructorUserId: "instr-b", name: "Instructor B" },
];

// Every instructor resolves to UTC unless a test overrides it — matches
// the shape app/dashboard/settings/scheduling/page.tsx actually passes
// (instructorUserId -> timezone or null).
const defaultTimezones: Record<string, string | null> = { me: "UTC", "instr-b": "UTC" };

describe("AvailabilityBlockForm", () => {
  test("an instructor without appointments.manage_all sees only their own personal-time-off management — no studio-holiday kind, no target-instructor picker", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={false}
        canManageSelf={true}
      />
    );

    const kindSelect = screen.getByLabelText(/^kind$/i) as HTMLSelectElement;
    const kindValues = Array.from(kindSelect.options).map((option) => option.value);
    expect(kindValues).toContain("regular_day_off");
    expect(kindValues).toContain("personal_time_off");
    expect(kindValues).not.toContain("studio_holiday");

    expect(screen.queryByLabelText(/^instructor$/i)).toBeNull();
  });

  test("an Owner (appointments.manage_all and manage_self) sees the studio-holiday kind and a target-instructor picker that still includes themselves", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={true}
        canManageSelf={true}
      />
    );

    const kindSelect = screen.getByLabelText(/^kind$/i) as HTMLSelectElement;
    const kindValues = Array.from(kindSelect.options).map((option) => option.value);
    expect(kindValues).toContain("studio_holiday");

    const instructorSelect = screen.getByLabelText(/^instructor$/i) as HTMLSelectElement;
    const optionValues = Array.from(instructorSelect.options).map((option) => option.value);
    expect(optionValues).toContain("me");
    expect(instructorSelect.value).toBe("me");
  });

  test("excludes the viewer from the target-instructor picker when they hold manage_all but not manage_self (Admin) — they'd otherwise hit a dead-end 403", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={true}
        canManageSelf={false}
      />
    );

    const instructorSelect = screen.getByLabelText(/^instructor$/i) as HTMLSelectElement;
    const optionValues = Array.from(instructorSelect.options).map((option) => option.value);
    expect(optionValues).not.toContain("me");
    expect(optionValues).toContain("instr-b");
    // Defaults to the first non-self instructor rather than the viewer.
    expect(instructorSelect.value).toBe("instr-b");
  });

  test("still offers the viewer as a selectable instructor when they hold manage_self alone (pure self-service picker is not shown, but canManageSelf doesn't wrongly exclude a full-access viewer)", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={true}
        canManageSelf={true}
      />
    );

    const instructorSelect = screen.getByLabelText(/^instructor$/i) as HTMLSelectElement;
    const optionValues = Array.from(instructorSelect.options).map((option) => option.value);
    expect(optionValues).toContain("me");
  });

  test("hides the target-instructor picker once studio holiday is selected, since a holiday has no single instructor", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={true}
        canManageSelf={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/^kind$/i), { target: { value: "studio_holiday" } });
    expect(screen.queryByLabelText(/^instructor$/i)).toBeNull();
  });

  test("submits a regular_day_off block for the viewer themselves when they lack appointments.manage_all", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={false}
        canManageSelf={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/day of week/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/studios/studio-1/instructor-blocks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            kind: "regular_day_off",
            instructorUserId: "me",
            dayOfWeek: 2,
            startTime: "09:00",
            endTime: "12:00",
          }),
        })
      );
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  test("submits a studio_holiday block with no instructorUserId field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={true}
        canManageSelf={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/^kind$/i), { target: { value: "studio_holiday" } });
    fireEvent.change(screen.getByLabelText(/^start$/i), { target: { value: "2026-12-25T00:00" } });
    fireEvent.change(screen.getByLabelText(/^end$/i), { target: { value: "2026-12-26T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, options] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(options.body as string);
    expect(sentBody).toEqual(
      expect.objectContaining({ kind: "studio_holiday" })
    );
    expect(sentBody.instructorUserId).toBeUndefined();
  });

  test("builds personal_time_off startAt/endAt in the target instructor's resolved timezone, not the browser's local offset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    // vitest's jsdom environment runs in UTC by default, so a timezone
    // offset from UTC (here, Pacific/Auckland) is what would actually
    // catch the bug this test guards against: `new Date(startAt)` parses
    // the datetime-local string as browser-local time (UTC here) rather
    // than resolving through the target instructor's own timezone.
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={{ me: "Pacific/Auckland", "instr-b": "UTC" }}
        canManageAll={false}
        canManageSelf={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/^kind$/i), { target: { value: "personal_time_off" } });
    fireEvent.change(screen.getByLabelText(/^start$/i), { target: { value: "2026-06-15T10:00" } });
    fireEvent.change(screen.getByLabelText(/^end$/i), { target: { value: "2026-06-15T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);

    const expectedStartAt = localDateTimeToUtc(2026, 6, 15, 10, 0, "Pacific/Auckland");
    const expectedEndAt = localDateTimeToUtc(2026, 6, 15, 11, 0, "Pacific/Auckland");

    expect(body.startAt).toBe(expectedStartAt.toISOString());
    expect(body.endAt).toBe(expectedEndAt.toISOString());
    // Sanity check that the bug this test guards against would actually be
    // caught: Pacific/Auckland is offset from UTC, so the naive
    // `new Date("2026-06-15T10:00")` (parsed as UTC in this test
    // environment) must differ from the correct, timezone-resolved instant.
    expect(body.startAt).not.toBe(new Date("2026-06-15T10:00").toISOString());
  });

  test("blocks personal_time_off submission and shows an inline error when the target instructor's timezone can't be resolved", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={{ me: null, "instr-b": "UTC" }}
        canManageAll={false}
        canManageSelf={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/^kind$/i), { target: { value: "personal_time_off" } });
    fireEvent.change(screen.getByLabelText(/^start$/i), { target: { value: "2026-06-15T10:00" } });
    fireEvent.change(screen.getByLabelText(/^end$/i), { target: { value: "2026-06-15T11:00" } });

    expect(screen.getByText(/no assigned location/i)).not.toBeNull();
    expect((screen.getByRole("button", { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("surfaces the error message from a failed submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        instructorTimezones={defaultTimezones}
        canManageAll={false}
        canManageSelf={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("Forbidden")).not.toBeNull();
    });
  });
});
