// app/api/v1/studios/[studioId]/branding/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import {
  getBrandingByStudioId,
  updateBranding,
  SlugTakenError,
  StudioBrandingNotFoundError,
} from "@/lib/branding/branding";
import { updateBrandingSchema } from "@/lib/validation/branding";

export async function GET(
  _request: Request,
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

  try {
    const branding = await getBrandingByStudioId(studioId);
    return NextResponse.json(branding);
  } catch (err) {
    if (err instanceof StudioBrandingNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(
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

  const body = updateBrandingSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const branding = await updateBranding(userId, studioId, body.data);
    return NextResponse.json(branding);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof SlugTakenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
