// app/api/v1/studios/[studioId]/instructor-blocks/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, hasPermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { createBlock, getBlockLabel, listBlocksInRange } from "@/lib/scheduling/blocks";
import { createBlockSchema } from "@/lib/validation/scheduling";

const rangeQuerySchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
});

// Gated on appointments.read_all — the same code every staff role that
// can see appointments already holds (not a block-specific permission).
// Each returned block's label is redacted per getBlockLabel: visible only
// to the block's own instructor, or to a viewer holding
// appointments.manage_all (this phase's plan doc, Global Constraints).
export async function GET(
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

  const url = new URL(request.url);
  // URLSearchParams.get() returns null for a missing param, and
  // z.coerce.date() happily coerces null to the Unix epoch (Date's own
  // ToNumber(null) === 0) rather than failing — so a missing param must
  // become undefined here, not null, for the required-field check below
  // to actually reject it.
  const query = rangeQuerySchema.safeParse({
    startAt: url.searchParams.get("startAt") ?? undefined,
    endAt: url.searchParams.get("endAt") ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: query.error.flatten() }, { status: 400 });
  }

  try {
    await requirePermission(userId, studioId, "appointments.read_all");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  const viewerCanSeeAllLabels = await hasPermission(userId, studioId, "appointments.manage_all");
  const resolved = await listBlocksInRange(studioId, query.data.startAt, query.data.endAt);

  const blocks = resolved.map((block) => ({
    ...block,
    label: getBlockLabel(userId, block, viewerCanSeeAllLabels),
  }));

  return NextResponse.json({ blocks });
}

// Permission checks live in createBlock itself (self-service for an
// instructor's own regular_day_off/personal_time_off, appointments.manage_all
// for everything else) — see lib/scheduling/blocks.ts.
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
  const body = createBlockSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const block = await createBlock(userId, studioId, body.data);
    return NextResponse.json(block, { status: 201 });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}
