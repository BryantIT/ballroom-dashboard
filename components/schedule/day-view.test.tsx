// components/schedule/day-view.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DayView, buildInstructorColumns } from "./day-view";

afterEach(cleanup);

const instructors = [
  { instructorUserId: "instr-a", name: "Instructor A" },
  { instructorUserId: "instr-b", name: "Instructor B" },
];

describe("DayView", () => {
  test("renders one column per instructor returned for the selected location", () => {
    render(<DayView instructors={instructors} timeZone="UTC" appointments={[]} blocks={[]} />);
    expect(screen.getByTestId("instructor-column-instr-a")).not.toBeNull();
    expect(screen.getByTestId("instructor-column-instr-b")).not.toBeNull();
    expect(screen.getByText("Instructor A")).not.toBeNull();
    expect(screen.getByText("Instructor B")).not.toBeNull();
  });

  test("renders an accent-colored lesson block with student + room, in its own instructor's column", () => {
    render(
      <DayView
        instructors={instructors} timeZone="UTC"
        appointments={[
          {
            id: "appt-1",
            instructorUserId: "instr-a",
            roomName: "Studio A",
            studentNames: ["Alex Example"],
            startAt: new Date("2026-11-16T15:00:00Z"),
            endAt: new Date("2026-11-16T16:00:00Z"),
            status: "scheduled",
          },
        ]}
        blocks={[]}
      />
    );

    const block = screen.getByTestId("appointment-appt-1");
    expect(screen.getByTestId("instructor-column-instr-a").contains(block)).toBe(true);
    expect(block.textContent).toContain("Alex Example");
    expect(block.textContent).toContain("Studio A");
    // Accent coloring reuses ThemeRoot's existing `bg-primary` token class
    // rather than a hardcoded hex value.
    expect(block.className).toContain("bg-primary");
  });

  test("renders a striped block for a regular day off", () => {
    render(
      <DayView
        instructors={instructors} timeZone="UTC"
        appointments={[]}
        blocks={[
          {
            id: "block-1",
            instructorUserId: "instr-b",
            kind: "regular_day_off",
            label: null,
            startAt: new Date("2026-11-16T00:00:00Z"),
            endAt: new Date("2026-11-17T00:00:00Z"),
          },
        ]}
      />
    );

    const block = screen.getByTestId("day-off-block-block-1");
    expect(screen.getByTestId("instructor-column-instr-b").contains(block)).toBe(true);
    expect(block.textContent).toContain("Day off");
    expect(block.style.backgroundImage).toContain("repeating-linear-gradient");
  });

  test("renders a studio-holiday banner spanning all columns, not inside any one instructor's column", () => {
    render(
      <DayView
        instructors={instructors} timeZone="UTC"
        appointments={[]}
        blocks={[
          {
            id: "holiday-1",
            instructorUserId: null,
            kind: "studio_holiday",
            label: "Thanksgiving",
            startAt: new Date("2026-11-16T00:00:00Z"),
            endAt: new Date("2026-11-17T00:00:00Z"),
          },
        ]}
      />
    );

    const banner = screen.getByTestId("holiday-banner-holiday-1");
    expect(banner.textContent).toContain("Thanksgiving");
    expect(screen.getByTestId("instructor-column-instr-a").contains(banner)).toBe(false);
    expect(screen.getByTestId("instructor-column-instr-b").contains(banner)).toBe(false);
  });

  test("renders a muted unavailable block for personal time off, showing its label when resolved for the viewer", () => {
    render(
      <DayView
        instructors={instructors} timeZone="UTC"
        appointments={[]}
        blocks={[
          {
            id: "pto-1",
            instructorUserId: "instr-a",
            kind: "personal_time_off",
            // The page already resolved this label via getBlockLabel for
            // a viewer who IS this block's own instructor — the component
            // must render it verbatim, not re-derive visibility itself.
            label: "Dentist appointment",
            startAt: new Date("2026-11-16T18:00:00Z"),
            endAt: new Date("2026-11-16T19:00:00Z"),
          },
        ]}
      />
    );

    const block = screen.getByTestId("unavailable-block-pto-1");
    expect(block.textContent).toContain("Dentist appointment");
  });

  test("renders a generic Unavailable label for personal time off when the viewer is not its own instructor (label already redacted server-side)", () => {
    render(
      <DayView
        instructors={instructors} timeZone="UTC"
        appointments={[]}
        blocks={[
          {
            id: "pto-2",
            instructorUserId: "instr-a",
            kind: "personal_time_off",
            // getBlockLabel already returned null for this viewer
            // server-side — the component must never show an empty block.
            label: null,
            startAt: new Date("2026-11-16T18:00:00Z"),
            endAt: new Date("2026-11-16T19:00:00Z"),
          },
        ]}
      />
    );

    const block = screen.getByTestId("unavailable-block-pto-2");
    expect(block.textContent).toContain("Unavailable");
  });

  // Final-review Finding 2: times must render in the viewed location's
  // timezone, not the process's. vitest's jsdom runs in UTC, so an
  // offset zone is what makes this a real regression test.
  test("renders appointment times in the given location timezone, not the runtime's local zone", () => {
    // 2026-11-16T15:00Z is 07:00 PST (UTC-8) in America/Los_Angeles; the
    // UTC rendering would be 3:00 PM.
    const startAt = new Date("2026-11-16T15:00:00Z");
    const endAt = new Date("2026-11-16T16:30:00Z");
    render(
      <DayView
        instructors={instructors}
        timeZone="America/Los_Angeles"
        appointments={[
          {
            id: "appt-tz",
            instructorUserId: "instr-a",
            roomName: "Studio A",
            studentNames: ["Alex Example"],
            startAt,
            endAt,
            status: "scheduled",
          },
        ]}
        blocks={[]}
      />
    );

    const fmt = (date: Date, timeZone: string) =>
      date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
    const text = screen.getByTestId("appointment-appt-tz").textContent ?? "";
    expect(text).toContain(`${fmt(startAt, "America/Los_Angeles")} - ${fmt(endAt, "America/Los_Angeles")}`);
    // Independent of locale formatting: the LA hour is 7, not 15/3.
    expect(text).toMatch(/(^|\D)7:00(\D|$)/);
    expect(text).toMatch(/(^|\D)8:30(\D|$)/);
    expect(text).not.toContain(fmt(startAt, "UTC"));
  });

  // Final-review Finding 3: an appointment for an instructor NOT assigned
  // to the viewed location must still get its own column.
  test("buildInstructorColumns adds a column for an instructor with an appointment here but no location assignment", () => {
    const roster = [
      { instructorUserId: "instr-a", name: "Instructor A" },
      { instructorUserId: "instr-b", name: "Instructor B" },
      { instructorUserId: "instr-c", name: "Instructor C" },
    ];
    const appointments = [
      {
        id: "appt-unassigned",
        instructorUserId: "instr-b",
        roomName: "Studio A",
        studentNames: ["Alex Example"],
        startAt: new Date("2026-11-16T15:00:00Z"),
        endAt: new Date("2026-11-16T16:00:00Z"),
        status: "scheduled",
      },
    ];
    const blocks = [
      {
        id: "pto-c",
        instructorUserId: "instr-c",
        kind: "personal_time_off" as const,
        label: null,
        startAt: new Date("2026-11-16T18:00:00Z"),
        endAt: new Date("2026-11-16T19:00:00Z"),
      },
      {
        id: "holiday",
        instructorUserId: null,
        kind: "studio_holiday" as const,
        label: "Holiday",
        startAt: new Date("2026-11-16T00:00:00Z"),
        endAt: new Date("2026-11-17T00:00:00Z"),
      },
    ];

    // Only instr-a is assigned to this location.
    const columns = buildInstructorColumns(["instr-a"], roster, appointments, blocks);
    expect(columns).toEqual([
      { instructorUserId: "instr-a", name: "Instructor A" },
      { instructorUserId: "instr-b", name: "Instructor B" },
      { instructorUserId: "instr-c", name: "Instructor C" },
    ]);

    render(<DayView instructors={columns} timeZone="UTC" appointments={appointments} blocks={blocks} />);
    const appointment = screen.getByTestId("appointment-appt-unassigned");
    expect(screen.getByTestId("instructor-column-instr-b").contains(appointment)).toBe(true);
  });

  test("buildInstructorColumns with no location assignments still shows every instructor with an appointment", () => {
    const columns = buildInstructorColumns(
      [],
      [{ instructorUserId: "instr-a", name: "Instructor A" }],
      [{ instructorUserId: "instr-a" }, { instructorUserId: "instr-gone" }],
      []
    );
    // instr-gone isn't on the roster (e.g. deactivated) but has an
    // appointment in view, so it still gets a column, unnamed.
    expect(columns).toEqual([
      { instructorUserId: "instr-a", name: "Instructor A" },
      { instructorUserId: "instr-gone", name: null },
    ]);
  });

  test("buildInstructorColumns does not add a column for a studio holiday", () => {
    const columns = buildInstructorColumns(
      [],
      [{ instructorUserId: "instr-a", name: "Instructor A" }],
      [],
      [{ instructorUserId: null, kind: "studio_holiday" }]
    );
    expect(columns).toEqual([]);
  });

  test("shows an explanatory empty state when there are no instructor columns", () => {
    render(<DayView instructors={[]} timeZone="UTC" appointments={[]} blocks={[]} />);
    expect(screen.getByTestId("day-view-empty").textContent).toMatch(/no instructors assigned to this location/i);
  });

  test("does not show the empty state when there are instructor columns", () => {
    render(<DayView instructors={instructors} timeZone="UTC" appointments={[]} blocks={[]} />);
    expect(screen.queryByTestId("day-view-empty")).toBeNull();
  });
});
