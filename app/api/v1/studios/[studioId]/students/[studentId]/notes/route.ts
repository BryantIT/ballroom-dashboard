// app/api/v1/studios/[studioId]/students/[studentId]/notes/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import { createNote, listVisibleNotes, StudentNotFoundError } from "@/lib/students/notes";
import { createNoteSchema } from "@/lib/validation/studios";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studioId: string; studentId: string }> }
) {
  const { studioId, studentId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(studentId).success) {
    return NextResponse.json({ error: "Invalid studentId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;

  // listVisibleNotes filters server-side per row (canReadNote), so there's
  // no separate permission gate here: a caller with no visibility at all
  // simply gets back an empty list, never a 403 — notes.read_staff isn't
  // required just to ask the question.
  const notes = await listVisibleNotes({ userId, studioId }, studentId);

  return NextResponse.json({ notes });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studioId: string; studentId: string }> }
) {
  const { studioId, studentId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(studentId).success) {
    return NextResponse.json({ error: "Invalid studentId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = createNoteSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const note = await createNote(
      userId,
      studioId,
      studentId,
      body.data.body,
      body.data.restricted ?? false
    );
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof StudentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
