// components/schedule/instructor-load-picker.tsx
"use client";

export type InstructorLoadOption = {
  instructorUserId: string;
  name: string | null;
  activeStudentCount: number;
};

type InstructorLoadPickerProps = {
  instructors: InstructorLoadOption[];
  value: string | null;
  onChange: (instructorUserId: string) => void;
  // Distinguishes the radio group's `name` attribute — a page with more
  // than one of these pickers mounted at once would otherwise have their
  // native radio-button groups collide.
  name?: string;
};

// Shown by BookingForm specifically when the selected student is
// new/unassigned (no current primary instructor) — surfaces each
// bookable instructor's current active-student count (lib/scheduling/
// instructor-load.ts's getInstructorLoad) so staff can balance load
// instead of picking blind, per this phase's design doc.
export function InstructorLoadPicker({
  instructors,
  value,
  onChange,
  name = "instructorLoad",
}: InstructorLoadPickerProps) {
  const sorted = [...instructors].sort((a, b) => a.activeStudentCount - b.activeStudentCount);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Instructor (by current load)</legend>
      {sorted.map((instructor) => (
        <label key={instructor.instructorUserId} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={instructor.instructorUserId}
            checked={value === instructor.instructorUserId}
            onChange={() => onChange(instructor.instructorUserId)}
            className="h-4 w-4 accent-primary"
          />
          <span>
            {instructor.name ?? "Unnamed instructor"}{" "}
            <span className="text-muted-foreground">
              ({instructor.activeStudentCount} active student{instructor.activeStudentCount === 1 ? "" : "s"})
            </span>
          </span>
        </label>
      ))}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bookable instructors.</p>
      ) : null}
    </fieldset>
  );
}
