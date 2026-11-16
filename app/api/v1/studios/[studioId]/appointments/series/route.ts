// app/api/v1/studios/[studioId]/appointments/series/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import {
  createAppointmentSeries,
  CrossInstructorReasonRequiredError,
} from "@/lib/scheduling/appointments";
import {
  InstructorConflictError,
  RoomConflictError,
  RoomLocationMismatchError,
  InstructorUnavailableError,
} from "@/lib/scheduling/conflicts";
import { createAppointmentSeriesSchema } from "@/lib/validation/scheduling";

// Permission checks live in createAppointmentSeries itself (same
// manage_self/manage_all split as createAppointment). Per-occurrence
// conflicts (the four Task 8 error classes) are caught INSIDE
// createAppointmentSeries and recorded in the result's `skipped` array —
// they never propagate out of this call — so the conflict-class catches
// below are defensive only, mirroring the single-appointment route's
// error mapping for consistency.
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
  const body = createAppointmentSeriesSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const result = await createAppointmentSeries(userId, studioId, body.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof CrossInstructorReasonRequiredError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (
      err instanceof InstructorConflictError ||
      err instanceof RoomConflictError ||
      err instanceof RoomLocationMismatchError ||
      err instanceof InstructorUnavailableError
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
