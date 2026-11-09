// app/api/v1/studios/[studioId]/students/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { students } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();

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
