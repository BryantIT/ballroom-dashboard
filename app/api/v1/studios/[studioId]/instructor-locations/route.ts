// app/api/v1/studios/[studioId]/instructor-locations/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import {
  assignInstructorToLocation,
  listInstructorLocations,
  listLocationInstructors,
  InstructorNotFoundError,
  LocationNotFoundError,
} from "@/lib/scheduling/instructor-locations";
import { assignInstructorLocationSchema } from "@/lib/validation/studios";

// GET takes exactly one of `locationId` (-> listLocationInstructors) or
// `instructorUserId` (-> listInstructorLocations) — never both, never
// neither. Gated on appointments.read_all (not locations.manage): this
// data feeds the calendar's location filter (Task 14), which every staff
// role that can see appointments needs, not just the Owner who may assign
// the pairs.
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
  const locationId = url.searchParams.get("locationId");
  const instructorUserId = url.searchParams.get("instructorUserId");

  if ((locationId === null) === (instructorUserId === null)) {
    return NextResponse.json(
      { error: "Provide exactly one of locationId or instructorUserId" },
      { status: 400 }
    );
  }

  try {
    await requirePermission(userId, studioId, "appointments.read_all");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  if (locationId !== null) {
    if (!z.uuid().safeParse(locationId).success) {
      return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
    }
    const instructorUserIds = await listLocationInstructors(studioId, locationId);
    return NextResponse.json({ instructorUserIds });
  }

  if (!z.uuid().safeParse(instructorUserId).success) {
    return NextResponse.json({ error: "Invalid instructorUserId" }, { status: 400 });
  }
  const locationIds = await listInstructorLocations(studioId, instructorUserId as string);
  return NextResponse.json({ locationIds });
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
  const body = assignInstructorLocationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    await assignInstructorToLocation(
      userId,
      studioId,
      body.data.instructorUserId,
      body.data.locationId
    );
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof InstructorNotFoundError || err instanceof LocationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
