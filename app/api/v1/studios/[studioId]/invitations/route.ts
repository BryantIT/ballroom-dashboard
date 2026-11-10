// app/api/v1/studios/[studioId]/invitations/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { createInvitation, InvalidRoleError } from "@/lib/invitations/invitations";
import { createInvitationSchema } from "@/lib/validation/studios";

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
  const body = createInvitationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    await requirePermission(userId, studioId, "users.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  try {
    const result = await createInvitation({
      studioId,
      email: body.data.email,
      roleId: body.data.roleId,
      invitedByUserId: userId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidRoleError) {
      return NextResponse.json({ error: "Invalid roleId" }, { status: 400 });
    }
    throw err;
  }
}
