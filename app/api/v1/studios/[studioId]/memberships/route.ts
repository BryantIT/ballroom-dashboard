// app/api/v1/studios/[studioId]/memberships/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { memberships } from "@/lib/db/schema";

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
    await requirePermission(userId, studioId, "users.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  // RLS's self_or_tenant_select also admits the caller's own memberships
  // in other studios, so the studio filter here is required, not redundant.
  const rows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx.select().from(memberships).where(eq(memberships.studioId, studioId))
  );

  return NextResponse.json({ memberships: rows });
}
