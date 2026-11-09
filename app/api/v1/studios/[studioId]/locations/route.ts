// app/api/v1/studios/[studioId]/locations/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { locations } from "@/lib/db/schema";
import { createLocationSchema } from "@/lib/validation/studios";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();
  const body = createLocationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    await requirePermission(userId, studioId, "locations.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  const [location] = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .insert(locations)
      .values({ studioId, name: body.data.name, timezone: body.data.timezone })
      .returning()
  );

  return NextResponse.json(location, { status: 201 });
}
