// app/api/v1/studios/[studioId]/locations/[locationId]/rooms/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { getActiveMembership, PermissionDeniedError } from "@/lib/auth/authorization";
import { createRoom, listRoomsForLocation, LocationNotFoundError } from "@/lib/locations/rooms";
import { createRoomSchema } from "@/lib/validation/studios";

// No extra permission beyond an active membership — listing rooms isn't
// sensitive, unlike creating one (locations.manage, enforced inside
// createRoom).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string; locationId: string }> }
) {
  const { studioId, locationId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(locationId).success) {
    return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;

  const membership = await getActiveMembership(userId, studioId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rooms = await listRoomsForLocation(studioId, locationId);
  return NextResponse.json(rooms);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string; locationId: string }> }
) {
  const { studioId, locationId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(locationId).success) {
    return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = createRoomSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const room = await createRoom(userId, studioId, locationId, body.data.name);
    return NextResponse.json(room, { status: 201 });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof LocationNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
