// components/student-list.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StudentForm } from "@/components/student-form";
import type { students } from "@/lib/db/schema";

type Student = typeof students.$inferSelect;

type StudentListProps = {
  studioId: string;
  // Fetched server-side (direct DB query, same pattern as the branding
  // page's `initial` prop) rather than via the Task 1 GET route — the
  // search below filters this list client-side, it never re-fetches.
  students: Student[];
  // Resolved server-side (hasPermission(..., "students.create")) before
  // this component is rendered — the add-student form is simply absent
  // for a viewer who lacks it, not hidden via CSS.
  canCreateStudent: boolean;
};

export function StudentList({ studioId, students, canCreateStudent }: StudentListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return students;
    }
    return students.filter((student) => student.displayName.toLowerCase().includes(normalized));
  }, [students, query]);

  return (
    <div className="flex flex-col gap-6">
      {canCreateStudent ? <StudentForm studioId={studioId} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="studentSearch">Search</Label>
        <Input
          id="studentSearch"
          placeholder="Search by name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <ul className="flex flex-col gap-2">
        {filtered.map((student) => (
          <li key={student.id}>
            <Link
              href={`/dashboard/students/${student.id}`}
              className="flex flex-col rounded-lg border border-border px-4 py-3 text-sm hover:bg-muted"
            >
              <span className="font-medium">{student.displayName}</span>
              {student.email ? (
                <span className="text-muted-foreground">{student.email}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students found.</p>
      ) : null}
    </div>
  );
}
