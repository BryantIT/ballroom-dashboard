// components/schedule/booking-form.tsx
"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InstructorLoadPicker, type InstructorLoadOption } from "./instructor-load-picker";
// Imported from lib/scheduling/timezone.ts, NOT lib/scheduling/blocks.ts —
// blocks.ts is "server-only" and pulls in a Node Postgres client via
// withTenantContext, which would crash this Client Component as soon as
// it ran in the browser. timezone.ts is the pure subset of that same
// helper with no such dependency; blocks.ts re-exports it unchanged for
// every server-side caller (e.g. app/dashboard/schedule/page.tsx).
import { localDateTimeToUtc } from "@/lib/scheduling/timezone";

export type BookingFormStudent = {
  id: string;
  displayName: string;
  // The student's current primary instructor (studentAssignments,
  // isPrimary = true, endedAt IS NULL) resolved server-side by
  // app/dashboard/schedule/page.tsx — null means the student is new or
  // currently unassigned. No shared helper exists for this lookup yet
  // (see this task's brief); the page queries studentAssignments
  // directly, the same shape app/dashboard/students/[studentId]/page.tsx
  // already uses for its own assignment-history section.
  currentInstructorUserId: string | null;
};

export type BookingFormInstructor = {
  instructorUserId: string;
  name: string | null;
};

export type BookingFormLocation = { id: string; name: string; timezone: string };
export type BookingFormRoom = { id: string; name: string; locationId: string };

type CrossInstructorReasonCode = "buddy_lesson" | "instructor_unavailable" | "considering_switch" | "other";

const REASON_OPTIONS: { code: CrossInstructorReasonCode; label: string }[] = [
  { code: "buddy_lesson", label: "Buddy lesson" },
  { code: "instructor_unavailable", label: "Regular instructor unavailable this week" },
  { code: "considering_switch", label: "Student considering switching instructors" },
  { code: "other", label: "Other" },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

type BookingFormProps = {
  studioId: string;
  students: BookingFormStudent[];
  // Full bookable-instructor roster for the plain picker (shown once a
  // selected student already has a known current instructor) — any
  // instructor can be booked for any student (this phase's plan doc,
  // Global Constraints), so this list is never location-filtered.
  instructors: BookingFormInstructor[];
  // getInstructorLoad's result — same people as `instructors`, plus each
  // one's current active-student count, for the new/unassigned-student
  // picker.
  instructorLoad: InstructorLoadOption[];
  locations: BookingFormLocation[];
  rooms: BookingFormRoom[];
};

function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// The subset of POST .../appointments/series's response body this form
// reads (lib/scheduling/appointments.ts's CreateAppointmentSeriesResult,
// JSON-serialized — dates arrive as ISO strings).
type SeriesResponse = {
  created?: unknown[];
  skipped?: { date: string; reason: string }[];
};

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

export function BookingForm({
  studioId,
  students,
  instructors,
  instructorLoad,
  locations,
  rooms,
}: BookingFormProps) {
  const router = useRouter();

  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedInstructorUserId, setSelectedInstructorUserId] = useState("");

  const [mode, setMode] = useState<"one-off" | "recurring">("one-off");
  const [selectedLocationId, setSelectedLocationId] = useState(locations[0]?.id ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(
    () => rooms.find((room) => room.locationId === (locations[0]?.id ?? ""))?.id ?? ""
  );

  // One-off fields.
  const [date, setDate] = useState(todayDateString());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");

  // Recurring-series fields.
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [seriesStartDate, setSeriesStartDate] = useState(todayDateString());
  const [seriesEndDate, setSeriesEndDate] = useState("");

  const [crossInstructorReasonCode, setCrossInstructorReasonCode] = useState<CrossInstructorReasonCode | "">("");
  const [crossInstructorReasonNote, setCrossInstructorReasonNote] = useState("");

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Set after a recurring series is booked with some weeks skipped due to
  // conflicts; each `skipped` entry is a ready-to-display "date — reason".
  const [seriesSkipWarning, setSeriesSkipWarning] = useState<{ bookedCount: number; skipped: string[] } | null>(
    null
  );

  const selectedStudents = useMemo(
    () => students.filter((student) => selectedStudentIds.includes(student.id)),
    [students, selectedStudentIds]
  );

  // Routes to the instructor-load picker whenever every currently
  // selected student is new/unassigned (including "none selected yet") —
  // per this task's brief, the load-based picker is for the
  // new/unassigned case, not a universal replacement for the plain
  // picker.
  const isNewOrUnassigned =
    selectedStudents.length === 0 || selectedStudents.every((student) => student.currentInstructorUserId === null);

  // Only prompt when a selected student actually HAS a current
  // assignment and the chosen instructor differs from it — a
  // new/unassigned student has no prior assignment to differ from, so
  // picking any instructor for them never requires a reason.
  const needsCrossInstructorReason =
    selectedInstructorUserId !== "" &&
    selectedStudents.some(
      (student) =>
        student.currentInstructorUserId !== null && student.currentInstructorUserId !== selectedInstructorUserId
    );

  const roomsForLocation = rooms.filter((room) => room.locationId === selectedLocationId);

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((current) =>
      current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]
    );
  }

  function handleLocationChange(locationId: string) {
    setSelectedLocationId(locationId);
    const firstRoomForLocation = rooms.find((room) => room.locationId === locationId);
    setSelectedRoomId(firstRoomForLocation?.id ?? "");
  }

  const hasRequiredBaseFields =
    selectedStudentIds.length > 0 &&
    selectedInstructorUserId !== "" &&
    selectedLocationId !== "" &&
    selectedRoomId !== "" &&
    (mode === "one-off"
      ? date !== "" && startTime !== "" && endTime !== ""
      : seriesStartDate !== "" && startTime !== "" && endTime !== "");

  const canSubmit =
    hasRequiredBaseFields &&
    (!needsCrossInstructorReason || crossInstructorReasonCode !== "") &&
    status !== "saving";

  function resetAfterSuccess() {
    setSelectedStudentIds([]);
    setSelectedInstructorUserId("");
    setCrossInstructorReasonCode("");
    setCrossInstructorReasonNote("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setStatus("saving");
    setError(null);
    setSeriesSkipWarning(null);

    const crossInstructorReason =
      needsCrossInstructorReason && crossInstructorReasonCode !== ""
        ? {
            code: crossInstructorReasonCode,
            ...(crossInstructorReasonNote.trim() ? { note: crossInstructorReasonNote.trim() } : {}),
          }
        : undefined;

    const shared = {
      instructorUserId: selectedInstructorUserId,
      locationId: selectedLocationId,
      roomId: selectedRoomId,
      attendeeStudentIds: selectedStudentIds,
      ...(crossInstructorReason ? { crossInstructorReason } : {}),
    };

    // Every wall-clock-to-instant conversion here must go through the
    // selected LOCATION's own timezone, never the browser's/server's local
    // offset (this phase's plan doc, Global Constraints) — a staff member's
    // device timezone can differ from the booking location's in a
    // multi-location studio. selectedLocationId is always one of
    // `locations`' own ids by construction, so this lookup can't actually
    // miss; the fallback below only guards the impossible case rather than
    // silently falling back to a wrong timezone.
    const locationTimeZone = locations.find((location) => location.id === selectedLocationId)?.timezone ?? "UTC";

    try {
      let response: Response;
      if (mode === "one-off") {
        const [year, month, day] = date.split("-").map(Number);
        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = endTime.split(":").map(Number);
        response = await fetch(`/api/v1/studios/${studioId}/appointments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...shared,
            startAt: localDateTimeToUtc(year, month, day, startHour, startMinute, locationTimeZone),
            endAt: localDateTimeToUtc(year, month, day, endHour, endMinute, locationTimeZone),
          }),
        });
      } else {
        const [startYear, startMonth, startDay] = seriesStartDate.split("-").map(Number);
        const seriesStartAt = localDateTimeToUtc(startYear, startMonth, startDay, 0, 0, locationTimeZone);
        let seriesEndAt: Date | undefined;
        if (seriesEndDate) {
          const [endYear, endMonth, endDay] = seriesEndDate.split("-").map(Number);
          // windowEnd is EXCLUSIVE server-side, so send the start of the day
          // AFTER the chosen end date — otherwise that date's own lesson is dropped.
          seriesEndAt = localDateTimeToUtc(endYear, endMonth, endDay + 1, 0, 0, locationTimeZone);
        }
        response = await fetch(`/api/v1/studios/${studioId}/appointments/series`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...shared,
            dayOfWeek,
            startTime,
            endTime,
            seriesStartDate: seriesStartAt,
            ...(seriesEndAt ? { seriesEndDate: seriesEndAt } : {}),
          }),
        });
      }

      if (!response.ok) {
        // Covers 403 Forbidden, 422 (a missing crossInstructorReason the
        // client-side check above should already have blocked, handled
        // defensively anyway per this task's brief), and 409 conflicts —
        // all three just carry a message to surface verbatim.
        throw new Error(await readErrorMessage(response, "Failed to book appointment"));
      }

      if (mode === "recurring") {
        // createAppointmentSeries books every non-conflicting week and
        // reports the rest in `skipped` — surface those, or the staff
        // member never learns some weeks weren't booked.
        const result = (await response.json().catch(() => null)) as SeriesResponse | null;
        const skipped = result?.skipped ?? [];
        if (skipped.length > 0) {
          setSeriesSkipWarning({
            bookedCount: result?.created?.length ?? 0,
            skipped: skipped.map(
              (entry) =>
                `${new Date(entry.date).toLocaleDateString(undefined, {
                  weekday: "short",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  timeZone: locationTimeZone,
                })} — ${entry.reason}`
            ),
          });
        }
      }

      setStatus("idle");
      resetAfterSuccess();
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-lg flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Students</legend>
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {students.map((student) => (
            <label key={student.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedStudentIds.includes(student.id)}
                onChange={() => toggleStudent(student.id)}
                className="h-4 w-4 accent-primary"
              />
              {student.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      {isNewOrUnassigned ? (
        <InstructorLoadPicker
          instructors={instructorLoad}
          value={selectedInstructorUserId || null}
          onChange={setSelectedInstructorUserId}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="instructorSelect">Instructor</Label>
          <select
            id="instructorSelect"
            value={selectedInstructorUserId}
            onChange={(event) => setSelectedInstructorUserId(event.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Select an instructor</option>
            {instructors.map((instructor) => (
              <option key={instructor.instructorUserId} value={instructor.instructorUserId}>
                {instructor.name ?? "Unnamed instructor"}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsCrossInstructorReason ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="text-sm font-medium">
            This instructor differs from the student&apos;s current assigned instructor
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="crossInstructorReasonCode">Reason</Label>
            <select
              id="crossInstructorReasonCode"
              value={crossInstructorReasonCode}
              onChange={(event) =>
                setCrossInstructorReasonCode(event.target.value as CrossInstructorReasonCode | "")
              }
              className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Select a reason</option>
              {REASON_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="crossInstructorReasonNote">Note (optional)</Label>
            <textarea
              id="crossInstructorReasonNote"
              value={crossInstructorReasonNote}
              onChange={(event) => setCrossInstructorReasonNote(event.target.value)}
              maxLength={1000}
              className="min-h-16 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="locationSelect">Location</Label>
        <select
          id="locationSelect"
          value={selectedLocationId}
          onChange={(event) => handleLocationChange(event.target.value)}
          className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="">Select a location</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="roomSelect">Room</Label>
        <select
          id="roomSelect"
          value={selectedRoomId}
          onChange={(event) => setSelectedRoomId(event.target.value)}
          className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="">Select a room</option>
          {roomsForLocation.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Recurrence</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={mode === "one-off"}
              onChange={() => setMode("one-off")}
              className="h-4 w-4 accent-primary"
            />
            One-off
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={mode === "recurring"}
              onChange={() => setMode("recurring")}
              className="h-4 w-4 accent-primary"
            />
            Recurring weekly
          </label>
        </div>
      </fieldset>

      {mode === "one-off" ? (
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="bookingDate">Date</Label>
            <Input id="bookingDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="startTime">Start time</Label>
            <Input
              id="startTime"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="endTime">End time</Label>
            <Input id="endTime" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dayOfWeek">Day of week</Label>
            <select
              id="dayOfWeek"
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(Number(event.target.value))}
              className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {DAY_OF_WEEK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="recurringStartTime">Start time</Label>
              <Input
                id="recurringStartTime"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="recurringEndTime">End time</Label>
              <Input
                id="recurringEndTime"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="seriesStartDate">Series start date</Label>
              <Input
                id="seriesStartDate"
                type="date"
                value={seriesStartDate}
                onChange={(event) => setSeriesStartDate(event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="seriesEndDate">Series end date (optional)</Label>
              <Input
                id="seriesEndDate"
                type="date"
                value={seriesEndDate}
                onChange={(event) => setSeriesEndDate(event.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {status === "error" && error ? <p className="text-sm text-destructive">{error}</p> : null}

      {seriesSkipWarning ? (
        <div
          role="status"
          data-testid="series-skip-warning"
          className="flex flex-col gap-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          <p>
            Booked {seriesSkipWarning.bookedCount} weekly{" "}
            {seriesSkipWarning.bookedCount === 1 ? "lesson" : "lessons"}.{" "}
            {seriesSkipWarning.skipped.length}{" "}
            {seriesSkipWarning.skipped.length === 1 ? "week was" : "weeks were"} skipped because of a scheduling
            conflict:
          </p>
          <ul className="list-disc pl-5">
            {seriesSkipWarning.skipped.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button type="submit" disabled={!canSubmit}>
        {status === "saving" ? "Booking..." : "Book lesson"}
      </Button>
    </form>
  );
}
