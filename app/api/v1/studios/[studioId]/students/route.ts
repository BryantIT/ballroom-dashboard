// app/api/v1/studios/[studioId]/students/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { students } from "@/lib/db/schema";
import { createStudentSchema } from "@/lib/validation/studios";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
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

  const rows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx.select().from(students)
  );

  return NextResponse.json({ students: rows });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = createStudentSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    await requirePermission(userId, studioId, "students.create");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  const [student] = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .insert(students)
      .values({
        studioId,
        displayName: body.data.displayName,
        email: body.data.email,
        phone: body.data.phone,
      })
      .returning()
  );

  return NextResponse.json(student, { status: 201 });
}
