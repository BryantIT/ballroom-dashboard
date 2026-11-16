// app/api/v1/studios/[studioId]/appointments/[appointmentId]/status/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiSession } from "@/lib/dal";
import { PermissionDeniedError } from "@/lib/auth/authorization";
import {
  transitionAppointmentStatus,
  IllegalStatusTransitionError,
  AppointmentNotFoundError,
} from "@/lib/scheduling/appointment-status";
import { transitionAppointmentStatusSchema } from "@/lib/validation/scheduling";

// Permission check lives in transitionAppointmentStatus itself (same
// manage_self/manage_all split as createAppointment, applied against the
// TARGET appointment's own instructorUserId — see
// lib/scheduling/appointment-status.ts).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ studioId: string; appointmentId: string }> }
) {
  const { studioId, appointmentId } = await params;
  if (!z.uuid().safeParse(studioId).success) {
    return NextResponse.json({ error: "Invalid studioId" }, { status: 400 });
  }
  if (!z.uuid().safeParse(appointmentId).success) {
    return NextResponse.json({ error: "Invalid appointmentId" }, { status: 400 });
  }
  const session = await verifyApiSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = session;
  const body = transitionAppointmentStatusSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    const appointment = await transitionAppointmentStatus(
      userId,
      studioId,
      appointmentId,
      body.data.status
    );
    return NextResponse.json(appointment);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof IllegalStatusTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof AppointmentNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
