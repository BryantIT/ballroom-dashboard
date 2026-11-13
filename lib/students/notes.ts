// lib/students/notes.ts
import "server-only";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { notes } from "../db/schema";
import * as schema from "../db/schema";
import { hasPermission, PermissionDeniedError } from "../auth/authorization";
import { isAssignedInstructor } from "./authorization";

type Db = NodePgDatabase<typeof schema>;

export type Note = typeof notes.$inferSelect;

// Read rule: Owner/Admin (notes.read_staff) see everything. Otherwise the
// author always sees their own note. Beyond that, an assigned instructor
// may read a note only if it is NOT restricted — a restricted note is
// visible solely to its author and to notes.read_staff holders, never to
// other assigned instructors. isAssignedInstructor already excludes ended
// assignments, so a former instructor falls through to `false` with no
// extra logic needed here.
export async function canReadNote(
  context: { userId: string; studioId: string },
  note: { authorUserId: string; restricted: boolean },
  studentId: string,
  database?: Db
): Promise<boolean> {
  if (await hasPermission(context.userId, context.studioId, "notes.read_staff", database)) {
    return true;
  }
  if (note.authorUserId === context.userId) {
    return true;
  }
  if (
    !note.restricted &&
    (await isAssignedInstructor(context.userId, studentId, context.studioId, database))
  ) {
    return true;
  }
  return false;
}

// Write rule: the caller must hold notes.write_assigned, AND either be the
// assigned instructor for this student OR hold students.update_all
// (Owner/Admin may write a note for any student, assigned or not).
export async function canWriteNote(
  context: { userId: string; studioId: string },
  studentId: string,
  database?: Db
): Promise<boolean> {
  if (!(await hasPermission(context.userId, context.studioId, "notes.write_assigned", database))) {
    return false;
  }
  return (
    (await isAssignedInstructor(context.userId, studentId, context.studioId, database)) ||
    (await hasPermission(context.userId, context.studioId, "students.update_all", database))
  );
}

export async function createNote(
  userId: string,
  studioId: string,
  studentId: string,
  body: string,
  restricted: boolean,
  database?: Db
): Promise<Note> {
  if (!(await canWriteNote({ userId, studioId }, studentId, database))) {
    throw new PermissionDeniedError(userId, studioId, "notes.write_assigned");
  }

  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      const [created] = await tx
        .insert(notes)
        .values({ studioId, studentId, authorUserId: userId, body, restricted })
        .returning();
      return created;
    },
    database
  );
}

// Filters server-side using canReadNote per row, so a note the viewer
// can't see is never returned — not even as a redacted placeholder.
// Array.prototype.filter does not await its predicate, so an inline
// `.filter(async ...)` would keep every row (an unresolved Promise is
// truthy); the booleans are resolved up front with Promise.all instead.
export async function listVisibleNotes(
  context: { userId: string; studioId: string },
  studentId: string,
  database?: Db
): Promise<Note[]> {
  const allNotes = await withTenantContext(
    { userId: context.userId, tenantId: context.studioId },
    (tx) => tx.select().from(notes).where(eq(notes.studentId, studentId)),
    database
  );

  const visibility = await Promise.all(
    allNotes.map((note) => canReadNote(context, note, studentId, database))
  );

  return allNotes.filter((_, index) => visibility[index]);
}
