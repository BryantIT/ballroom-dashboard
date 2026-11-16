// app/api/v1/studios/[studioId]/students/[studentId]/relationships/route.ts
import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { students } from "@/lib/db/schema";
import { linkStudentsSchema } from "@/lib/validation/studios";
import {
  linkStudents,
  listRelatedStudents,
  SelfRelationshipError,
  DuplicateRelationshipError,
  StudentNotFoundError,
} from "@/lib/students/relationships";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string; studentId: string }> }
) {
  const { studioId, studentId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(studentId).success) {
    return NextResponse.json({ error: "Invalid studentId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;

  try {
    await requirePermission(userId, studioId, "students.read");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  const relatedIds = await listRelatedStudents(studioId, studentId);
  if (relatedIds.length === 0) {
    return NextResponse.json({ relationships: [] });
  }

  const rows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .select({ id: students.id, displayName: students.displayName, email: students.email })
      .from(students)
      .where(inArray(students.id, relatedIds))
  );

  return NextResponse.json({ relationships: rows });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string; studentId: string }> }
) {
  const { studioId, studentId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(studentId).success) {
    return NextResponse.json({ error: "Invalid studentId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = linkStudentsSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const relationship = await linkStudents(
      userId,
      studioId,
      studentId,
      body.data.studentBId
    );
    return NextResponse.json(relationship, { status: 201 });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof SelfRelationshipError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof DuplicateRelationshipError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof StudentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
