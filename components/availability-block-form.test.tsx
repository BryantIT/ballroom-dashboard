// components/availability-block-form.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { AvailabilityBlockForm } from "./availability-block-form";

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

describe("AvailabilityBlockForm", () => {
  test("an instructor without appointments.manage_all sees only their own personal-time-off management — no studio-holiday kind, no target-instructor picker", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        canManageAll={false}
      />
    );

    const kindSelect = screen.getByLabelText(/^kind$/i) as HTMLSelectElement;
    const kindValues = Array.from(kindSelect.options).map((option) => option.value);
    expect(kindValues).toContain("regular_day_off");
    expect(kindValues).toContain("personal_time_off");
    expect(kindValues).not.toContain("studio_holiday");

    expect(screen.queryByLabelText(/^instructor$/i)).toBeNull();
  });

  test("an Owner/Admin (appointments.manage_all) sees the studio-holiday kind and a target-instructor picker", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        canManageAll={true}
      />
    );

    const kindSelect = screen.getByLabelText(/^kind$/i) as HTMLSelectElement;
    const kindValues = Array.from(kindSelect.options).map((option) => option.value);
    expect(kindValues).toContain("studio_holiday");

    expect(screen.getByLabelText(/^instructor$/i)).not.toBeNull();
  });

  test("hides the target-instructor picker once studio holiday is selected, since a holiday has no single instructor", () => {
    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        canManageAll={true}
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
        canManageAll={false}
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
        canManageAll={true}
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

  test("surfaces the error message from a failed submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AvailabilityBlockForm
        studioId="studio-1"
        currentUserId="me"
        instructors={instructors}
        canManageAll={false}
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
