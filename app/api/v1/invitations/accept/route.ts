// app/api/v1/invitations/accept/route.ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { acceptInvitation } from "@/lib/invitations/invitations";
import { acceptInvitationSchema } from "@/lib/validation/studios";

export async function POST(request: Request) {
  const { userId } = await verifySession();
  const body = acceptInvitationSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const result = await acceptInvitation(body.data.token, userId);
  return NextResponse.json(result, { status: 200 });
}
