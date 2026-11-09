// app/api/v1/studios/[studioId]/students/[studentId]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
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
  const { userId } = await verifySession();
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

  return NextResponse.json(updated);
}
