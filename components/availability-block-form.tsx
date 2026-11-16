// components/availability-block-form.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  // appointments.manage_all: lets its holder create a block for ANY
  // instructor (including themselves) or a studio-wide holiday. Absent
  // this, the form is pure self-service: no target-instructor picker, no
  // studio_holiday kind option.
  canManageAll: boolean;
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
  canManageAll,
}: AvailabilityBlockFormProps) {
  const router = useRouter();

  const [kind, setKind] = useState<BlockKind>("regular_day_off");
  const [targetInstructorUserId, setTargetInstructorUserId] = useState(currentUserId);
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

  const canSubmit =
    status !== "saving" &&
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

    const body =
      kind === "regular_day_off"
        ? {
            kind,
            instructorUserId,
            dayOfWeek,
            startTime,
            endTime,
            ...labelField,
          }
        : kind === "personal_time_off"
          ? {
              kind,
              instructorUserId,
              // startAt/endAt come from <input type="datetime-local">
              // fields with no timezone of their own — `new Date(...)`
              // parses that string in the browser's own local timezone.
              // That's the right interpretation here: unlike appointment
              // booking (always anchored to one specific location's
              // timezone, this phase's plan doc's Global Constraints), a
              // personal day off or studio holiday has no single location
              // to anchor it to, so "the time the person filling this in
              // sees on their own clock" is the only timezone available.
              startAt: new Date(startAt),
              endAt: new Date(endAt),
              ...labelField,
            }
          : {
              kind,
              startAt: new Date(startAt),
              endAt: new Date(endAt),
              ...labelField,
            };

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
            {instructors.map((instructor) => (
              <option key={instructor.instructorUserId} value={instructor.instructorUserId}>
                {instructor.instructorUserId === currentUserId
                  ? `${instructor.name ?? "Me"} (me)`
                  : instructor.name ?? "Unnamed instructor"}
              </option>
            ))}
          </select>
        </div>
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
