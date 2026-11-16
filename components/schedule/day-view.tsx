// components/schedule/day-view.tsx
//
// Pure presentational component: everything it renders has already been
// resolved server-side (app/dashboard/schedule/page.tsx) — instructor
// columns already computed via buildInstructorColumns below (location-
// assigned instructors plus anyone with activity in the view), appointment
// attendee/room names already
// joined, and block labels already redacted per-viewer via
// lib/scheduling/blocks.ts's getBlockLabel. This component never applies
// its own visibility rule on top of that; a null `label` here always
// means "render the generic fallback", never "go look up who can see it".

export type DayViewInstructor = {
  instructorUserId: string;
  name: string | null;
};

export type DayViewAppointment = {
  id: string;
  instructorUserId: string;
  roomName: string;
  studentNames: string[];
  startAt: Date;
  endAt: Date;
  status: string;
};

export type DayViewBlockKind = "regular_day_off" | "personal_time_off" | "studio_holiday";

export type DayViewBlock = {
  id: string;
  instructorUserId: string | null;
  kind: DayViewBlockKind;
  label: string | null;
  startAt: Date;
  endAt: Date;
};

type DayViewProps = {
  instructors: DayViewInstructor[];
  appointments: DayViewAppointment[];
  blocks: DayViewBlock[];
  // IANA timezone of the location being viewed — every displayed time is
  // rendered in it, never the server's/browser's own local zone.
  timeZone: string;
};

// The day view's instructor columns: the UNION of instructors explicitly
// assigned to the viewed location AND every instructor who actually has
// an appointment or a (non-holiday) block in the view. Location assignment
// is informational only — any instructor can be booked at any location —
// so filtering columns to assigned instructors alone would silently hide
// real appointments. Display names come from `roster` (getInstructorLoad's
// studio-wide bookable-instructor list), in its order; an instructor with
// an appointment but no roster entry (e.g. since-deactivated) still gets a
// column, appended at the end with a null name.
export function buildInstructorColumns(
  locationInstructorIds: Iterable<string>,
  roster: { instructorUserId: string; name: string | null }[],
  appointments: { instructorUserId: string }[],
  blocks: { instructorUserId: string | null; kind: DayViewBlockKind }[]
): DayViewInstructor[] {
  const activityIds = new Set<string>(appointments.map((appointment) => appointment.instructorUserId));
  for (const block of blocks) {
    if (block.kind !== "studio_holiday" && block.instructorUserId !== null) {
      activityIds.add(block.instructorUserId);
    }
  }
  const wanted = new Set<string>([...locationInstructorIds, ...activityIds]);

  const columns: DayViewInstructor[] = roster
    .filter((instructor) => wanted.has(instructor.instructorUserId))
    .map((instructor) => ({ instructorUserId: instructor.instructorUserId, name: instructor.name }));

  // Activity from someone not on the roster still gets a column. (A
  // location-assigned id with no roster entry AND no activity is dropped,
  // exactly as before.)
  const rosterIds = new Set(roster.map((instructor) => instructor.instructorUserId));
  for (const instructorUserId of activityIds) {
    if (!rosterIds.has(instructorUserId)) {
      columns.push({ instructorUserId, name: null });
    }
  }
  return columns;
}

function formatRange(startAt: Date, endAt: Date, timeZone: string): string {
  const fmt = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  return `${fmt(startAt)} - ${fmt(endAt)}`;
}

function byStartAt<T extends { startAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export function DayView({ instructors, appointments, blocks, timeZone }: DayViewProps) {
  const holidayBlocks = byStartAt(blocks.filter((block) => block.kind === "studio_holiday"));

  return (
    <div className="flex flex-col gap-3">
      {holidayBlocks.map((holiday) => (
        <div
          key={holiday.id}
          data-testid={`holiday-banner-${holiday.id}`}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {holiday.label ?? "Studio holiday"}
        </div>
      ))}

      {instructors.length === 0 ? (
        <p data-testid="day-view-empty" className="text-sm text-muted-foreground">
          No instructors assigned to this location yet — assign one in Scheduling settings, or book an
          appointment to see it here.
        </p>
      ) : null}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(instructors.length, 1)}, minmax(0, 1fr))` }}
      >
        {instructors.map((instructor) => {
          const columnAppointments = appointments.filter(
            (appointment) => appointment.instructorUserId === instructor.instructorUserId
          );
          const columnBlocks = blocks.filter(
            (block) =>
              block.kind !== "studio_holiday" && block.instructorUserId === instructor.instructorUserId
          );

          type ColumnItem =
            | { type: "appointment"; startAt: Date; data: DayViewAppointment }
            | { type: "block"; startAt: Date; data: DayViewBlock };

          const items = byStartAt<ColumnItem>([
            ...columnAppointments.map(
              (appointment): ColumnItem => ({ type: "appointment", startAt: appointment.startAt, data: appointment })
            ),
            ...columnBlocks.map((block): ColumnItem => ({ type: "block", startAt: block.startAt, data: block })),
          ]);

          return (
            <div
              key={instructor.instructorUserId}
              data-testid={`instructor-column-${instructor.instructorUserId}`}
              className="flex flex-col gap-2 rounded-lg border border-border p-2"
            >
              <h3 className="text-sm font-semibold">{instructor.name ?? "Unnamed instructor"}</h3>

              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">No appointments.</p>
              ) : null}

              {items.map((item) => {
                if (item.type === "appointment") {
                  const appointment = item.data;
                  return (
                    <div
                      key={`appointment-${appointment.id}`}
                      data-testid={`appointment-${appointment.id}`}
                      className="rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground"
                    >
                      <p className="font-medium">{appointment.studentNames.join(", ")}</p>
                      <p>{appointment.roomName}</p>
                      <p className="opacity-80">{formatRange(appointment.startAt, appointment.endAt, timeZone)}</p>
                    </div>
                  );
                }

                const block = item.data;
                if (block.kind === "regular_day_off") {
                  return (
                    <div
                      key={`block-${block.id}`}
                      data-testid={`day-off-block-${block.id}`}
                      data-block-kind="regular_day_off"
                      className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(45deg, var(--color-muted) 0px, var(--color-muted) 6px, transparent 6px, transparent 12px)",
                      }}
                    >
                      Day off
                    </div>
                  );
                }

                // personal_time_off: muted "unavailable" block. `label` is
                // already null here unless the server resolved it for
                // this exact viewer (getBlockLabel) — never re-derive
                // visibility client-side.
                return (
                  <div
                    key={`block-${block.id}`}
                    data-testid={`unavailable-block-${block.id}`}
                    data-block-kind="personal_time_off"
                    className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
                  >
                    {block.label ?? "Unavailable"}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
