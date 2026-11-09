// app/api/v1/studios/[studioId]/invitations/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { requirePermission, PermissionDeniedError } from "@/lib/auth/authorization";
import { createInvitation } from "@/lib/invitations/invitations";
import { createInvitationSchema } from "@/lib/validation/studios";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string }> }
) {
  const { studioId } = await params;
  const { userId } = await verifySession();
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

  const result = await createInvitation({
    studioId,
    email: body.data.email,
    roleId: body.data.roleId,
    invitedByUserId: userId,
  });

  return NextResponse.json(result, { status: 201 });
}
