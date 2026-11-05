import { NextResponse } from "next/server";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { tenantProbe } from "@/lib/db/schema";

// THROWAWAY (Phase 0 only): proves RLS end-to-end before any real
// studio/membership table exists. Delete this file and its test once
// Phase 1 lands. Deliberately calls withTenantContext with tenantId:
// null to simulate "authenticated request, no tenant context" — this is
// spec acceptance test #15.
export async function GET() {
  const rows = await withTenantContext(
    { userId: "internal-probe", tenantId: null },
    (tx) => tx.select().from(tenantProbe)
  );
  return NextResponse.json({ rows });
}
