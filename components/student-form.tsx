// components/student-form.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { students } from "@/lib/db/schema";

type Student = typeof students.$inferSelect;

type StudentFormProps = {
  studioId: string;
  // When provided, the form edits this student (PATCH /students/[id]).
  // When omitted, the form creates a new one (POST /students) — the same
  // component serves both the list page's "Add student" form and the
  // detail page's profile edit form, since both just collect
  // displayName/email/phone and differ only in HTTP method/URL.
  student?: Pick<Student, "id" | "displayName" | "email" | "phone">;
};

export function StudentForm({ studioId, student }: StudentFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(student?.displayName ?? "");
  const [email, setEmail] = useState(student?.email ?? "");
  const [phone, setPhone] = useState(student?.phone ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function readErrorMessage(response: Response, fallback: string): Promise<string> {
    const body = await response.json().catch(() => null);
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
    return fallback;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const trimmedEmail = email.trim();
      const trimmedPhone = phone.trim();
      const url = student
        ? `/api/v1/studios/${studioId}/students/${student.id}`
        : `/api/v1/studios/${studioId}/students`;
      const method = student ? "PATCH" : "POST";
      // On edit, a blanked field must be sent as an explicit `null` so
      // updateStudentSchema (and the route's `.set()`) actually clears
      // the stored value — omitting the key, like the create path does,
      // would leave it untouched instead. There's nothing to clear on a
      // brand-new student (createStudentSchema doesn't accept `null`),
      // so the create path keeps omitting blank optional fields.
      const body = student
        ? {
            displayName: displayName.trim(),
            email: trimmedEmail === "" ? null : trimmedEmail,
            phone: trimmedPhone === "" ? null : trimmedPhone,
          }
        : {
            displayName: displayName.trim(),
            ...(trimmedEmail ? { email: trimmedEmail } : {}),
            ...(trimmedPhone ? { phone: trimmedPhone } : {}),
          };
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save student"));
      }

      if (!student) {
        // Reset the "add student" form for the next entry. An edit form
        // keeps showing whatever the viewer just typed.
        setDisplayName("");
        setEmail("");
        setPhone("");
      }
      setStatus("idle");
      // The list/detail page's Server Component queried the DB directly
      // for its initial data — refresh so it re-renders with the
      // student we just created/edited, without a full page reload.
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="studentEmail">Email</Label>
        <Input
          id="studentEmail"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="studentPhone">Phone</Label>
        <Input
          id="studentPhone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>

      {status === "error" && error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving..." : student ? "Save" : "Add student"}
      </Button>
    </form>
  );
}
