// lib/students/relationships.ts
import "server-only";
import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { withTenantContext } from "../db/with-tenant-context";
import { studentRelationships } from "../db/schema";
import * as schema from "../db/schema";
import { requirePermission } from "../auth/authorization";

type Db = NodePgDatabase<typeof schema>;

export class SelfRelationshipError extends Error {
  constructor(studentId: string) {
    super(`Cannot link student ${studentId} to themselves`);
    this.name = "SelfRelationshipError";
  }
}

export class DuplicateRelationshipError extends Error {
  constructor(studentAId: string, studentBId: string) {
    super(`Students ${studentAId} and ${studentBId} are already linked`);
    this.name = "DuplicateRelationshipError";
  }
}

// Display/booking convenience only — linking two students as a couple never
// merges notes, progress, or billing between them (see the schema.ts
// comment on studentRelationships). Gated on students.update_all: linking
// is an Owner/Admin action (the base spec's permission table has no
// dedicated code for this — a builder's-call addition, like
// locations.manage/branding.manage before it).
export async function linkStudents(
  userId: string,
  studioId: string,
  studentAId: string,
  studentBId: string,
  database?: Db
): Promise<{ id: string }> {
  await requirePermission(userId, studioId, "students.update_all", database);

  if (studentAId === studentBId) {
    throw new SelfRelationshipError(studentAId);
  }

  return withTenantContext(
    { userId, tenantId: studioId },
    async (tx) => {
      // Check-then-insert: undirected pairs are stored once in whichever
      // order the caller supplied, so both orderings must be checked. Same
      // low-concurrency admin-action TOCTOU category already accepted for
      // studio-slug generation elsewhere in this codebase — not a new
      // concern to solve here.
      const [existing] = await tx
        .select({ id: studentRelationships.id })
        .from(studentRelationships)
        .where(
          and(
            eq(studentRelationships.studioId, studioId),
            or(
              and(
                eq(studentRelationships.studentAId, studentAId),
                eq(studentRelationships.studentBId, studentBId)
              ),
              and(
                eq(studentRelationships.studentAId, studentBId),
                eq(studentRelationships.studentBId, studentAId)
              )
            )
          )
        )
        .limit(1);

      if (existing) {
        throw new DuplicateRelationshipError(studentAId, studentBId);
      }

      const [created] = await tx
        .insert(studentRelationships)
        .values({ studioId, studentAId, studentBId })
        .returning({ id: studentRelationships.id });

      return created;
    },
    database
  );
}

// Returns the *other* student id in each pair studentId appears in.
export async function listRelatedStudents(
  studioId: string,
  studentId: string,
  database?: Db
): Promise<string[]> {
  // This read-only lookup has no caller userId in its signature (brief's
  // interface), and tenant_isolation on student_relationships keys only on
  // studio_id, never app.user_id — so there's no policy for a real userId
  // to satisfy here, unlike the writes in linkStudents.
  return withTenantContext(
    { userId: "", tenantId: studioId },
    async (tx) => {
      const rows = await tx
        .select({
          studentAId: studentRelationships.studentAId,
          studentBId: studentRelationships.studentBId,
        })
        .from(studentRelationships)
        .where(
          and(
            eq(studentRelationships.studioId, studioId),
            or(
              eq(studentRelationships.studentAId, studentId),
              eq(studentRelationships.studentBId, studentId)
            )
          )
        );

      return rows.map((row) =>
        row.studentAId === studentId ? row.studentBId : row.studentAId
      );
    },
    database
  );
}
