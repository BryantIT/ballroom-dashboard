// app/api/v1/studios/[studioId]/appointments/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, lt } from "drizzle-orm";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, hasPermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { appointments } from "@/lib/db/schema";
import { createAppointment, CrossInstructorReasonRequiredError } from "@/lib/scheduling/appointments";
import {
  InstructorConflictError,
  RoomConflictError,
  RoomLocationMismatchError,
  InstructorUnavailableError,
} from "@/lib/scheduling/conflicts";
import { listBlocksInRange, getBlockLabel } from "@/lib/scheduling/blocks";
import { createAppointmentSchema } from "@/lib/validation/scheduling";

const rangeQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  // Optional — per this task's brief, the plan's data model doesn't
  // require a single location for a calendar view. When omitted,
  // listBlocksInRange falls back to its own per-block timezone inference.
  locationId: z.uuid().optional(),
});

// Gated on appointments.read_all. Returns both the concrete appointments
// AND the resolved availability blocks for [from, to) — each block's
// label already redacted via getBlockLabel for the calling viewer (never
// send an unresolved label to the client and expect it to filter
// client-side; see lib/scheduling/blocks.ts).
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
  // z.coerce.date() happily coerces null to the Unix epoch rather than
  // failing — so a missing param must become undefined here, not null,
  // for the required-field check below to actually reject it.
  const query = rangeQuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    locationId: url.searchParams.get("locationId") ?? undefined,
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

  const { from, to, locationId } = query.data;

  const conditions = [
    eq(appointments.studioId, studioId),
    lt(appointments.startAt, to),
    gt(appointments.endAt, from),
  ];
  if (locationId) {
    conditions.push(eq(appointments.locationId, locationId));
  }

  const appointmentRows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .select()
      .from(appointments)
      .where(and(...conditions))
      .orderBy(appointments.startAt)
  );

  const viewerCanSeeAllLabels = await hasPermission(userId, studioId, "appointments.manage_all");
  const resolvedBlocks = await listBlocksInRange(studioId, from, to, locationId);
  const blocks = resolvedBlocks.map((block) => ({
    ...block,
    label: getBlockLabel(userId, block, viewerCanSeeAllLabels),
  }));

  return NextResponse.json({ appointments: appointmentRows, blocks });
}

// Permission checks live in createAppointment itself (manage_self for an
// instructor's own slot, manage_all for booking a different instructor's
// slot) — see lib/scheduling/appointments.ts.
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
  const body = createAppointmentSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const appointment = await createAppointment(userId, studioId, body.data);
    return NextResponse.json(appointment, { status: 201 });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof CrossInstructorReasonRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (
      err instanceof InstructorConflictError ||
      err instanceof RoomConflictError ||
      err instanceof RoomLocationMismatchError ||
      err instanceof InstructorUnavailableError
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
