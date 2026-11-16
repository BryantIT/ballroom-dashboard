// components/instructor-location-settings.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type InstructorLocationSettingsInstructor = {
  instructorUserId: string;
  name: string | null;
};

export type InstructorLocationSettingsLocation = {
  id: string;
  name: string;
};

export type InstructorLocationAssignment = {
  instructorUserId: string;
  locationId: string;
};

type InstructorLocationSettingsProps = {
  studioId: string;
  locations: InstructorLocationSettingsLocation[];
  // Full bookable-instructor roster (getInstructorLoad) — every studio
  // staff member who could plausibly be assigned to a location, not just
  // ones already assigned.
  instructors: InstructorLocationSettingsInstructor[];
  // Current { instructorUserId, locationId } pairs, fetched by the page
  // via a single direct query scoped to the studio (this task's brief) —
  // never one GET-equivalent round trip per instructor.
  assignments: InstructorLocationAssignment[];
};

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}

// Only supports ASSIGNING an instructor to a location — there is no
// unassign/DELETE route (Task 4's interface, this task's brief), and
// re-assigning the same pair is a harmless no-op server-side
// (onConflictDoNothing on a unique index), so this component never tries
// to reconcile or remove an existing pair.
export function InstructorLocationSettings({
  studioId,
  locations,
  instructors,
  assignments: initialAssignments,
}: InstructorLocationSettingsProps) {
  const router = useRouter();
  // Tracked locally so a successful assignment is reflected immediately
  // in this list, rather than waiting on router.refresh()'s round trip
  // back through the parent Server Component (which this component also
  // triggers, for every other server-rendered consumer of this data).
  const [assignments, setAssignments] = useState(initialAssignments);
  const [selectedByLocation, setSelectedByLocation] = useState<Record<string, string>>({});
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const [errorByLocation, setErrorByLocation] = useState<Record<string, string>>({});

  const instructorsById = new Map(instructors.map((instructor) => [instructor.instructorUserId, instructor]));

  function assignedInstructorIds(locationId: string): string[] {
    return assignments
      .filter((assignment) => assignment.locationId === locationId)
      .map((assignment) => assignment.instructorUserId);
  }

  async function handleAssign(locationId: string) {
    const instructorUserId = selectedByLocation[locationId];
    if (!instructorUserId) {
      return;
    }

    setSavingLocationId(locationId);
    setErrorByLocation((current) => ({ ...current, [locationId]: "" }));

    try {
      const response = await fetch(`/api/v1/studios/${studioId}/instructor-locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorUserId, locationId }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to assign instructor"));
      }

      setAssignments((current) =>
        current.some(
          (assignment) => assignment.instructorUserId === instructorUserId && assignment.locationId === locationId
        )
          ? current
          : [...current, { instructorUserId, locationId }]
      );
      setSelectedByLocation((current) => ({ ...current, [locationId]: "" }));
      router.refresh();
    } catch (err) {
      setErrorByLocation((current) => ({
        ...current,
        [locationId]: err instanceof Error ? err.message : "Something went wrong",
      }));
    } finally {
      setSavingLocationId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {locations.map((location) => {
        const assignedIds = assignedInstructorIds(location.id);
        const assignedIdSet = new Set(assignedIds);
        const unassigned = instructors.filter((instructor) => !assignedIdSet.has(instructor.instructorUserId));
        const selectId = `assign-instructor-${location.id}`;

        return (
          <div key={location.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium">{location.name}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {assignedIds.map((instructorUserId) => (
                <li key={instructorUserId}>
                  {instructorsById.get(instructorUserId)?.name ?? "Unnamed instructor"}
                </li>
              ))}
              {assignedIds.length === 0 ? (
                <li className="text-muted-foreground">No instructors assigned yet.</li>
              ) : null}
            </ul>

            {unassigned.length > 0 ? (
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor={selectId}>Assign an instructor</Label>
                  <select
                    id={selectId}
                    value={selectedByLocation[location.id] ?? ""}
                    onChange={(event) =>
                      setSelectedByLocation((current) => ({ ...current, [location.id]: event.target.value }))
                    }
                    className="flex h-10 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <option value="">Select an instructor</option>
                    {unassigned.map((instructor) => (
                      <option key={instructor.instructorUserId} value={instructor.instructorUserId}>
                        {instructor.name ?? "Unnamed instructor"}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  onClick={() => handleAssign(location.id)}
                  disabled={!selectedByLocation[location.id] || savingLocationId === location.id}
                >
                  {savingLocationId === location.id ? "Assigning..." : "Assign"}
                </Button>
              </div>
            ) : null}

            {errorByLocation[location.id] ? (
              <p className="text-sm text-destructive">{errorByLocation[location.id]}</p>
            ) : null}
          </div>
        );
      })}

      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No locations configured yet.</p>
      ) : null}
    </div>
  );
}
