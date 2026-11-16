// components/schedule/day-view.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DayView } from "./day-view";

afterEach(cleanup);

const instructors = [
  { instructorUserId: "instr-a", name: "Instructor A" },
  { instructorUserId: "instr-b", name: "Instructor B" },
];

describe("DayView", () => {
  test("renders one column per instructor returned for the selected location", () => {
    render(<DayView instructors={instructors} appointments={[]} blocks={[]} />);
    expect(screen.getByTestId("instructor-column-instr-a")).not.toBeNull();
    expect(screen.getByTestId("instructor-column-instr-b")).not.toBeNull();
    expect(screen.getByText("Instructor A")).not.toBeNull();
    expect(screen.getByText("Instructor B")).not.toBeNull();
  });

  test("renders an accent-colored lesson block with student + room, in its own instructor's column", () => {
    render(
      <DayView
        instructors={instructors}
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
        instructors={instructors}
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
        instructors={instructors}
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
        instructors={instructors}
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
        instructors={instructors}
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
});
