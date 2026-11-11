// app/api/v1/studios/route.ts
import { NextResponse } from "next/server";
import { verifyApiSession } from "@/lib/dal";
import { provisionStudio } from "@/lib/studios/provision";
import { createStudioSchema } from "@/lib/validation/studios";

export async function POST(request: Request) {
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = createStudioSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const result = await provisionStudio({
    ownerId: userId,
    studioName: body.data.name,
    timezone: body.data.timezone,
  });

  return NextResponse.json(result, { status: 201 });
}
