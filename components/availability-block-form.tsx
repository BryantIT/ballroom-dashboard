// components/availability-block-form.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localDateTimeToUtc } from "@/lib/scheduling/timezone";

export type AvailabilityBlockFormInstructor = {
  instructorUserId: string;
  name: string | null;
};

type AvailabilityBlockFormProps = {
  studioId: string;
  // The viewer's own user id. Every block this form creates for a viewer
  // who lacks appointments.manage_all is implicitly this id — the
  // self-service rule lib/scheduling/blocks.ts's createBlock enforces
  // server-side (instructorUserId === callerUserId needs only
  // appointments.manage_self); this form's own "courtesy" gating (this
  // task's brief) mirrors that rule rather than inventing a new one.
  currentUserId: string;
  // Full bookable-instructor roster (getInstructorLoad) — only consumed
  // by the target-instructor picker, which only renders when
  // canManageAll.
  instructors: AvailabilityBlockFormInstructor[];
  // Each instructor's effective timezone (resolveInstructorTimezone,
  // resolved server-side in page.tsx — this component must never import
  // lib/scheduling/blocks.ts directly, which would drag its server-only +
  // DB-connecting import chain into the client bundle), keyed by
  // instructorUserId. null means that instructor has no resolvable
  // location (no assignment, and the studio doesn't have exactly one
  // location to fall back to) — used to block personal_time_off
  // submission for that instructor rather than silently falling back to
  // the browser's local offset.
  instructorTimezones: Record<string, string | null>;
  // appointments.manage_all: lets its holder create a block for ANY
  // OTHER instructor or a studio-wide holiday. Absent this, the form is
  // pure self-service: no target-instructor picker, no studio_holiday
  // kind option.
  canManageAll: boolean;
  // appointments.manage_self: required specifically for self-targeting
  // (instructorUserId === callerUserId) on any kind but studio_holiday —
  // lib/scheduling/blocks.ts's createBlock enforces this independently
  // of manage_all (the built-in Admin role holds manage_all but not
  // manage_self; only Owner holds both). When canManageAll is true but
  // this is false, the instructor picker excludes the viewer as a
  // selectable target — that's the one path the server would actually
  // reject with a bare 403.
  canManageSelf: boolean;
};

type BlockKind = "regular_day_off" | "personal_time_off" | "studio_holiday";

const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function parseDateTimeLocal(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  // <input type="datetime-local"> always produces "YYYY-MM-DDTHH:MM"
  // (seconds omitted since this form never sets a `step`) — the same
  // split-on-delimiter parsing components/schedule/booking-form.tsx uses
  // for its separate date/time fields, applied to the combined string.
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return { year, month, day, hour, minute };
}

const MISSING_TIMEZONE_ERROR =
  "This instructor has no assigned location to resolve a timezone from — assign one on the Instructor " +
  "locations panel first.";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

export function AvailabilityBlockForm({
  studioId,
  currentUserId,
  instructors,
  instructorTimezones,
  canManageAll,
  canManageSelf,
}: AvailabilityBlockFormProps) {
  const router = useRouter();

  // An Admin-shaped viewer (manage_all but not manage_self) cannot target
  // themselves — lib/scheduling/blocks.ts's createBlock requires
  // manage_self specifically for self-targeting. Exclude the viewer from
  // the selectable list and default to the first other instructor
  // instead, so the one path the server would reject is never offered.
  // Both the pure self-service case (!canManageAll) and the full-access
  // case (canManageAll && canManageSelf, e.g. Owner) are unaffected —
  // each still defaults to/only offers the viewer as before.
  const excludeSelfFromPicker = canManageAll && !canManageSelf;
  const pickerInstructors = excludeSelfFromPicker
    ? instructors.filter((instructor) => instructor.instructorUserId !== currentUserId)
    : instructors;

  const [kind, setKind] = useState<BlockKind>("regular_day_off");
  const [targetInstructorUserId, setTargetInstructorUserId] = useState(() => {
    if (excludeSelfFromPicker) {
      const firstOther = pickerInstructors[0];
      return firstOther ? firstOther.instructorUserId : currentUserId;
    }
    return currentUserId;
  });
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Never trust client state alone for who the block is for: a viewer
  // without canManageAll gets the self id regardless of anything else
  // this component's state could hold. The server enforces the same
  // thing independently (createBlock); this is a courtesy, not the real
  // boundary.
  const instructorUserId = canManageAll ? targetInstructorUserId : currentUserId;

  // The target instructor's effective timezone (null when unresolvable).
  // Only meaningful for personal_time_off, which is always anchored to
  // one specific instructor; studio_holiday has no instructorUserId and
  // is handled separately (untouched by this lookup).
  const targetInstructorTimezone = instructorTimezones[instructorUserId] ?? null;
  const personalTimeOffBlockedByTimezone = kind === "personal_time_off" && targetInstructorTimezone === null;

  const canSubmit =
    status !== "saving" &&
    !personalTimeOffBlockedByTimezone &&
    (kind === "regular_day_off"
      ? startTime !== "" && endTime !== "" && startTime < endTime
      : startAt !== "" && endAt !== "");

  function resetAfterSuccess() {
    setLabel("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setStatus("saving");
    setError(null);

    const trimmedLabel = label.trim();
    const labelField = trimmedLabel ? { label: trimmedLabel } : {};

    let body: Record<string, unknown>;
    if (kind === "regular_day_off") {
      body = {
        kind,
        instructorUserId,
        dayOfWeek,
        startTime,
        endTime,
        ...labelField,
      };
    } else if (kind === "personal_time_off") {
      // Unlike studio_holiday (genuinely studio-wide, no single
      // instructor to anchor to — "the time the person filling this in
      // sees on their own clock" is defensible there), personal_time_off
      // always has a specific instructorUserId, and this phase's Global
      // Constraints require resolving a real timezone for any instant
      // like this rather than trusting the browser's local offset.
      // targetInstructorTimezone (instructorTimezones, resolved
      // server-side via resolveInstructorTimezone) is that instructor's
      // effective timezone; canSubmit already blocks submission when
      // it's unresolvable, so this re-check is defense in depth, not the
      // real guard.
      if (!targetInstructorTimezone) {
        setStatus("error");
        setError(MISSING_TIMEZONE_ERROR);
        return;
      }
      const start = parseDateTimeLocal(startAt);
      const end = parseDateTimeLocal(endAt);
      body = {
        kind,
        instructorUserId,
        startAt: localDateTimeToUtc(start.year, start.month, start.day, start.hour, start.minute, targetInstructorTimezone),
        endAt: localDateTimeToUtc(end.year, end.month, end.day, end.hour, end.minute, targetInstructorTimezone),
        ...labelField,
      };
    } else {
      // studio_holiday: genuinely studio-wide, no single location to
      // anchor it to (reviewer-confirmed defensible as-is) — left
      // untouched.
      body = {
        kind,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        ...labelField,
      };
    }

    try {
      const response = await fetch(`/api/v1/studios/${studioId}/instructor-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create block"));
      }

      setStatus("idle");
      resetAfterSuccess();
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const showInstructorPicker = canManageAll && kind !== "studio_holiday";

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blockKind">Kind</Label>
        <select
          id="blockKind"
          value={kind}
          onChange={(event) => setKind(event.target.value as BlockKind)}
          className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="regular_day_off">Weekly day off</option>
          <option value="personal_time_off">Personal time off</option>
          {canManageAll ? <option value="studio_holiday">Studio holiday</option> : null}
        </select>
      </div>

      {showInstructorPicker ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="blockInstructor">Instructor</Label>
          <select
            id="blockInstructor"
            value={targetInstructorUserId}
            onChange={(event) => setTargetInstructorUserId(event.target.value)}
            className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {pickerInstructors.map((instructor) => (
              <option key={instructor.instructorUserId} value={instructor.instructorUserId}>
                {instructor.instructorUserId === currentUserId
                  ? `${instructor.name ?? "Me"} (me)`
                  : instructor.name ?? "Unnamed instructor"}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {personalTimeOffBlockedByTimezone ? (
        <p className="text-sm text-destructive">{MISSING_TIMEZONE_ERROR}</p>
      ) : null}

      {kind === "regular_day_off" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blockDayOfWeek">Day of week</Label>
            <select
              id="blockDayOfWeek"
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
              <Label htmlFor="blockStartTime">Start time</Label>
              <Input
                id="blockStartTime"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="blockEndTime">End time</Label>
              <Input
                id="blockEndTime"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="blockStartAt">Start</Label>
            <Input
              id="blockStartAt"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="blockEndAt">End</Label>
            <Input
              id="blockEndAt"
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blockLabel">Label (optional)</Label>
        <Input id="blockLabel" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={500} />
      </div>

      {status === "error" && error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={!canSubmit}>
        {status === "saving" ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
