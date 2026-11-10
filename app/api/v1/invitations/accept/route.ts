// app/api/v1/invitations/accept/route.ts
import { NextResponse } from "next/server";
import { verifyApiSession } from "@/lib/dal";
import {
  acceptInvitation,
  InvitationNotFoundError,
  InvitationEmailMismatchError,
  InvitationNotPendingError,
  InvitationAlreadyMemberError,
} from "@/lib/invitations/invitations";
import { acceptInvitationSchema } from "@/lib/validation/studios";

export async function POST(request: Request) {
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = acceptInvitationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const result = await acceptInvitation(body.data.token, userId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InvitationNotFoundError) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    if (err instanceof InvitationEmailMismatchError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof InvitationNotPendingError || err instanceof InvitationAlreadyMemberError) {
      return NextResponse.json({ error: "Invitation is no longer valid" }, { status: 409 });
    }
    throw err;
  }
}
