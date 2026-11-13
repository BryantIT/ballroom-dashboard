// lib/students/notes.test.ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../db/testing/test-database";
import { users, students, studentAssignments, roles, memberships } from "../db/schema";
import * as schema from "../db/schema";

describe("student notes authorization", () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provisionStudio: typeof import("../studios/provision").provisionStudio;
  let canReadNote: typeof import("./notes").canReadNote;
  let canWriteNote: typeof import("./notes").canWriteNote;
  let createNote: typeof import("./notes").createNote;
  let listVisibleNotes: typeof import("./notes").listVisibleNotes;
  let PermissionDeniedError: typeof import("../auth/authorization").PermissionDeniedError;
  let withTenantContext: typeof import("../db/with-tenant-context").withTenantContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_RUNTIME_URL = testDb.runtimeConnectionUri;
    pool = new Pool({ connectionString: testDb.runtimeConnectionUri });
    ({ provisionStudio } = await import("../studios/provision"));
    ({ canReadNote, canWriteNote, createNote, listVisibleNotes } = await import("./notes"));
    ({ withTenantContext } = await import("../db/with-tenant-context"));
    ({ PermissionDeniedError } = await import("../auth/authorization"));
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await testDb.stop();
  });

  async function setupStudio(emailSuffix: string) {
    const db = drizzle(pool, { schema });
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-notes-${emailSuffix}@example.com` })
      .returning();
    const { studioId } = await provisionStudio(
      { ownerId: owner.id, studioName: "Studio", timezone: "America/Chicago" },
      db
    );
    const [student] = await withTenantContext(
      { userId: owner.id, tenantId: studioId },
      (tx) => tx.insert(students).values({ studioId, displayName: "Alex" }).returning(),
      db
    );
    return { db, owner, studioId, student };
  }

  async function addInstructor(
    db: ReturnType<typeof drizzle<typeof schema>>,
    ownerId: string,
    studioId: string,
    emailSuffix: string
  ) {
    const [instructor] = await db
      .insert(users)
      .values({ email: `instructor-notes-${emailSuffix}@example.com` })
      .returning();
    await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      async (tx) => {
        const [instructorRole] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.studioId, studioId), eq(roles.code, "instructor")));
        await tx.insert(memberships).values({
          studioId,
          userId: instructor.id,
          roleId: instructorRole.id,
          status: "active",
        });
      },
      db
    );
    return instructor;
  }

  async function assignInstructor(
    db: ReturnType<typeof drizzle<typeof schema>>,
    ownerId: string,
    studioId: string,
    studentId: string,
    instructorUserId: string,
    options: { endedAt?: Date; isPrimary?: boolean } = {}
  ) {
    // student_assignments has a partial unique index allowing at most one
    // current (is_primary AND ended_at IS NULL) row per student, so a
    // second active assignment on the same student must pass
    // isPrimary: false.
    await withTenantContext(
      { userId: ownerId, tenantId: studioId },
      (tx) =>
        tx.insert(studentAssignments).values({
          studentId,
          studioId,
          instructorUserId,
          endedAt: options.endedAt,
          isPrimary: options.isPrimary ?? true,
        }),
      db
    );
  }

  test("the author can always read their own note, restricted or not", async () => {
    const { db, owner, studioId, student } = await setupStudio("author");
    const instructorB = await addInstructor(db, owner.id, studioId, "author-b");
    await assignInstructor(db, owner.id, studioId, student.id, instructorB.id);

    const note = await createNote(
      instructorB.id,
      studioId,
      student.id,
      "Private author note",
      true,
      db
    );

    expect(
      await canReadNote(
        { userId: instructorB.id, studioId },
        note,
        student.id,
        db
      )
    ).toBe(true);
  });

  test("an assigned instructor can read a non-restricted note they didn't write", async () => {
    const { db, owner, studioId, student } = await setupStudio("assigned-nonrestricted");
    const author = await addInstructor(db, owner.id, studioId, "assigned-nonrestricted-author");
    const assigned = await addInstructor(db, owner.id, studioId, "assigned-nonrestricted-reader");
    await assignInstructor(db, owner.id, studioId, student.id, author.id);
    await assignInstructor(db, owner.id, studioId, student.id, assigned.id, {
      isPrimary: false,
    });

    const note = await createNote(author.id, studioId, student.id, "Visible note", false, db);

    expect(
      await canReadNote({ userId: assigned.id, studioId }, note, student.id, db)
    ).toBe(true);
  });

  test("an assigned instructor cannot read a restricted note they didn't write", async () => {
    const { db, owner, studioId, student } = await setupStudio("assigned-restricted");
    const author = await addInstructor(db, owner.id, studioId, "assigned-restricted-author");
    const assigned = await addInstructor(db, owner.id, studioId, "assigned-restricted-reader");
    await assignInstructor(db, owner.id, studioId, student.id, author.id);
    await assignInstructor(db, owner.id, studioId, student.id, assigned.id, {
      isPrimary: false,
    });

    const note = await createNote(
      author.id,
      studioId,
      student.id,
      "Restricted note",
      true,
      db
    );

    expect(
      await canReadNote({ userId: assigned.id, studioId }, note, student.id, db)
    ).toBe(false);
  });

  test("an unassigned instructor cannot read any note they didn't write, restricted or not", async () => {
    const { db, owner, studioId, student } = await setupStudio("unassigned");
    const author = await addInstructor(db, owner.id, studioId, "unassigned-author");
    const unassigned = await addInstructor(db, owner.id, studioId, "unassigned-reader");
    await assignInstructor(db, owner.id, studioId, student.id, author.id);

    const nonRestricted = await createNote(
      author.id,
      studioId,
      student.id,
      "Non-restricted",
      false,
      db
    );
    const restricted = await createNote(
      author.id,
      studioId,
      student.id,
      "Restricted",
      true,
      db
    );

    expect(
      await canReadNote({ userId: unassigned.id, studioId }, nonRestricted, student.id, db)
    ).toBe(false);
    expect(
      await canReadNote({ userId: unassigned.id, studioId }, restricted, student.id, db)
    ).toBe(false);
  });

  test("a former instructor (assignment ended) cannot read a restricted note", async () => {
    const { db, owner, studioId, student } = await setupStudio("former");
    const author = await addInstructor(db, owner.id, studioId, "former-author");
    const former = await addInstructor(db, owner.id, studioId, "former-reader");
    await assignInstructor(db, owner.id, studioId, student.id, author.id);
    await assignInstructor(db, owner.id, studioId, student.id, former.id, {
      endedAt: new Date(Date.now() - 1000),
    });

    const note = await createNote(author.id, studioId, student.id, "Restricted", true, db);

    expect(
      await canReadNote({ userId: former.id, studioId }, note, student.id, db)
    ).toBe(false);
  });

  test("Owner/Admin (notes.read_staff) can read every note regardless of restricted/assignment", async () => {
    const { db, owner, studioId, student } = await setupStudio("owner-read");
    const author = await addInstructor(db, owner.id, studioId, "owner-read-author");
    await assignInstructor(db, owner.id, studioId, student.id, author.id);

    const note = await createNote(author.id, studioId, student.id, "Restricted", true, db);

    expect(
      await canReadNote({ userId: owner.id, studioId }, note, student.id, db)
    ).toBe(true);
  });

  test("an assigned instructor can write a note", async () => {
    const { db, owner, studioId, student } = await setupStudio("write-assigned");
    const instructor = await addInstructor(db, owner.id, studioId, "write-assigned");
    await assignInstructor(db, owner.id, studioId, student.id, instructor.id);

    expect(
      await canWriteNote({ userId: instructor.id, studioId }, student.id, db)
    ).toBe(true);
  });

  test("an Owner can write a note for a student they aren't personally assigned to", async () => {
    const { db, owner, studioId, student } = await setupStudio("write-owner");

    expect(await canWriteNote({ userId: owner.id, studioId }, student.id, db)).toBe(true);
  });

  test("an unassigned, non-Owner/Admin staff member cannot write a note", async () => {
    const { db, owner, studioId, student } = await setupStudio("write-unassigned");
    const instructor = await addInstructor(db, owner.id, studioId, "write-unassigned");

    expect(
      await canWriteNote({ userId: instructor.id, studioId }, student.id, db)
    ).toBe(false);
  });

  test("createNote throws PermissionDeniedError when the caller cannot write", async () => {
    const { db, owner, studioId, student } = await setupStudio("create-denied");
    const instructor = await addInstructor(db, owner.id, studioId, "create-denied");

    await expect(
      createNote(instructor.id, studioId, student.id, "Nope", false, db)
    ).rejects.toThrow(PermissionDeniedError);
  });

  test("listVisibleNotes never returns a note the viewer can't see", async () => {
    const { db, owner, studioId, student } = await setupStudio("list-visible");
    const author = await addInstructor(db, owner.id, studioId, "list-visible-author");
    const assigned = await addInstructor(db, owner.id, studioId, "list-visible-reader");
    await assignInstructor(db, owner.id, studioId, student.id, author.id);
    await assignInstructor(db, owner.id, studioId, student.id, assigned.id, {
      isPrimary: false,
    });

    await createNote(author.id, studioId, student.id, "Visible to all assigned", false, db);
    await createNote(author.id, studioId, student.id, "Restricted to author/staff", true, db);

    const visible = await listVisibleNotes({ userId: assigned.id, studioId }, student.id, db);
    expect(visible).toHaveLength(1);
    expect(visible[0].body).toBe("Visible to all assigned");

    const ownerVisible = await listVisibleNotes({ userId: owner.id, studioId }, student.id, db);
    expect(ownerVisible).toHaveLength(2);
  });
});
