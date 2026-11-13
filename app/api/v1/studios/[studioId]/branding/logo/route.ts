// app/api/v1/studios/[studioId]/branding/logo/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import { updateBrandingLogo, InvalidLogoFileError } from "@/lib/branding/logo";

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

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  try {
    const branding = await updateBrandingLogo(userId, studioId, file);
    return NextResponse.json(branding);
  } catch (err) {
    if (err instanceof InvalidLogoFileError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}
