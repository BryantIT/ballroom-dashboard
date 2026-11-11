// app/api/v1/studios/[studioId]/students/[studentId]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { getActiveMembership } from "@/lib/auth/authorization";
import { canEditStudent } from "@/lib/students/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { students } from "@/lib/db/schema";
import { updateStudentSchema } from "@/lib/validation/studios";

export async function PATCH(
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
  const body = updateStudentSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const membership = await getActiveMembership(userId, studioId);
  if (!membership || !(await canEditStudent({ userId, studioId }, studentId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [updated] = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .update(students)
      .set({ displayName: body.data.displayName })
      .where(eq(students.id, studentId))
      .returning()
  );

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
