// components/notes-list.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { notes } from "@/lib/db/schema";

type Note = typeof notes.$inferSelect;

type NotesListProps = {
  studioId: string;
  studentId: string;
  // Fetched server-side via listVisibleNotes (canReadNote filters each
  // row for the current viewer) and passed down — a note the viewer
  // can't see is never sent to the client at all, not just hidden here.
  notes: Note[];
  // Resolved server-side (canWriteNote) before this component is
  // rendered — the add-note control is absent, not disabled-via-CSS,
  // for a viewer who lacks it.
  canWriteNote: boolean;
};

export function NotesList({ studioId, studentId, notes, canWriteNote }: NotesListProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function readErrorMessage(response: Response, fallback: string): Promise<string> {
    const errBody = await response.json().catch(() => null);
    if (
      errBody &&
      typeof errBody === "object" &&
      typeof (errBody as { error?: unknown }).error === "string"
    ) {
      return (errBody as { error: string }).error;
    }
    return fallback;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const response = await fetch(
        `/api/v1/studios/${studioId}/students/${studentId}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: body.trim(), restricted }),
        }
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to add note"));
      }

      setBody("");
      setRestricted(false);
      setStatus("idle");
      // The detail page's Server Component re-resolves listVisibleNotes
      // on refresh — simplest way to show the new note without
      // duplicating the read-visibility rules client-side.
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-border p-3 text-sm">
            <p>{note.body}</p>
            {note.restricted ? (
              <span className="text-xs text-muted-foreground">Restricted</span>
            ) : null}
          </li>
        ))}
      </ul>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : null}

      {canWriteNote ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Label htmlFor="noteBody">Add a note</Label>
          <textarea
            id="noteBody"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            className="min-h-20 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={restricted}
              onChange={(event) => setRestricted(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Restricted (visible only to you and Owner/Admin)
          </label>

          {status === "error" && error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={status === "saving"} className="self-start">
            {status === "saving" ? "Saving..." : "Add note"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
