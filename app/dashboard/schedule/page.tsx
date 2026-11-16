// app/dashboard/schedule/page.tsx
import type { ReactNode } from "react";
import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import {
  appointments,
  appointmentAttendees,
  locations,
  memberships,
  rooms,
  students,
  studentAssignments,
} from "@/lib/db/schema";
import { hasPermission } from "@/lib/auth/authorization";
import { listLocationInstructors } from "@/lib/scheduling/instructor-locations";
import { getInstructorLoad } from "@/lib/scheduling/instructor-load";
import { listBlocksInRange, getBlockLabel, localDateTimeToUtc, getLocalDateInTimezone } from "@/lib/scheduling/blocks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DayView, type DayViewAppointment, type DayViewBlock } from "@/components/schedule/day-view";
import { BookingForm } from "@/components/schedule/booking-form";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export default async function SchedulePage(props: PageProps<"/dashboard/schedule">) {
  const { userId } = await verifySession();
  const searchParams = await props.searchParams;

  // Same "first active membership, ordered by createdAt" resolution the
  // dashboard layout and the students list page use.
  const [membership] = await withTenantContext({ userId, tenantId: null }, (tx) =>
    tx
      .select({ studioId: memberships.studioId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(memberships.createdAt))
      .limit(1)
  );

  if (!membership) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>No studio yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You&apos;re not a member of a studio yet.
        </CardContent>
      </Card>
    );
  }

  const studioId = membership.studioId;

  // appointments.read_all is granted to all three built-in roles today
  // (this task's brief), but roles/rolePermissions are DB-driven — a
  // future custom role could omit it. Resolve it server-side like every
  // API route does, rather than relying on tenant RLS alone to decide
  // what this page renders.
  const canReadAppointments = await hasPermission(userId, studioId, "appointments.read_all");

  if (!canReadAppointments) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don&apos;t have access to this page.
        </CardContent>
      </Card>
    );
  }

  const [canManageAll, canManageSelf] = await Promise.all([
    hasPermission(userId, studioId, "appointments.manage_all"),
    hasPermission(userId, studioId, "appointments.manage_self"),
  ]);
  const canBook = canManageAll || canManageSelf;

  const allLocations = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .select({ id: locations.id, name: locations.name, timezone: locations.timezone })
      .from(locations)
      .where(eq(locations.studioId, studioId))
      .orderBy(asc(locations.name))
  );

  if (allLocations.length === 0) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No locations are configured for this studio yet.
        </CardContent>
      </Card>
    );
  }

  const requestedLocationId = firstValue(searchParams.locationId);
  const selectedLocation = allLocations.find((location) => location.id === requestedLocationId) ?? allLocations[0];
  const selectedLocationId = selectedLocation.id;

  // The viewed day's [from, to) boundary, resolved in the SELECTED
  // LOCATION's own timezone — never server-local/UTC (this phase's plan
  // doc, Global Constraints) — reusing the same local-date helpers
  // lib/scheduling/blocks.ts's regular_day_off expansion relies on.
  const requestedDate = firstValue(searchParams.date);
  let { year, month, day } = getLocalDateInTimezone(new Date(), selectedLocation.timezone);
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    const [y, m, d] = requestedDate.split("-").map(Number);
    year = y;
    month = m;
    day = d;
  }
  const from = localDateTimeToUtc(year, month, day, 0, 0, selectedLocation.timezone);
  const nextCalendarDay = new Date(Date.UTC(year, month - 1, day + 1));
  const to = localDateTimeToUtc(
    nextCalendarDay.getUTCFullYear(),
    nextCalendarDay.getUTCMonth() + 1,
    nextCalendarDay.getUTCDate(),
    0,
    0,
    selectedLocation.timezone
  );
  const dateParamValue = `${year}-${pad2(month)}-${pad2(day)}`;

  // Every bookable instructor in the studio, with their current
  // active-student load — getInstructorLoad (Task 11). Filtered down to
  // the selected location's assigned instructors (listLocationInstructors,
  // Task 4) for the day view's columns; passed through unfiltered to
  // BookingForm, since any instructor can be booked for any student
  // regardless of location assignment (this phase's plan doc, Global
  // Constraints).
  const [locationInstructorIds, instructorLoad] = await Promise.all([
    listLocationInstructors(studioId, selectedLocationId),
    getInstructorLoad(studioId),
  ]);
  const locationInstructorIdSet = new Set(locationInstructorIds);
  const instructorColumns = instructorLoad
    .filter((instructor) => locationInstructorIdSet.has(instructor.instructorUserId))
    .map((instructor) => ({ instructorUserId: instructor.instructorUserId, name: instructor.name }));

  // Duplicates the query shape in app/api/v1/studios/[studioId]/appointments/
  // route.ts's GET handler (that route itself duplicates locations/route.ts's
  // pattern) rather than fetching this page's own API route over HTTP — see
  // this task's brief. Joins rooms/students here too, which that route has
  // no need for (it returns raw rows to an API consumer), to get display
  // names for the day view.
  const appointmentRows = await withTenantContext({ userId, tenantId: studioId }, (tx) =>
    tx
      .select({
        id: appointments.id,
        instructorUserId: appointments.instructorUserId,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        roomName: rooms.name,
      })
      .from(appointments)
      .innerJoin(rooms, eq(rooms.id, appointments.roomId))
      .where(
        and(
          eq(appointments.studioId, studioId),
          eq(appointments.locationId, selectedLocationId),
          lt(appointments.startAt, to),
          gt(appointments.endAt, from)
        )
      )
      .orderBy(appointments.startAt)
  );

  const appointmentIds = appointmentRows.map((row) => row.id);
  const attendeeRows =
    appointmentIds.length > 0
      ? await withTenantContext({ userId, tenantId: studioId }, (tx) =>
          tx
            .select({
              appointmentId: appointmentAttendees.appointmentId,
              studentName: students.displayName,
            })
            .from(appointmentAttendees)
            .innerJoin(students, eq(students.id, appointmentAttendees.studentId))
            .where(inArray(appointmentAttendees.appointmentId, appointmentIds))
        )
      : [];

  const studentNamesByAppointment = new Map<string, string[]>();
  for (const row of attendeeRows) {
    const names = studentNamesByAppointment.get(row.appointmentId) ?? [];
    names.push(row.studentName);
    studentNamesByAppointment.set(row.appointmentId, names);
  }

  const dayViewAppointments: DayViewAppointment[] = appointmentRows.map((row) => ({
    id: row.id,
    instructorUserId: row.instructorUserId,
    roomName: row.roomName,
    studentNames: studentNamesByAppointment.get(row.id) ?? [],
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
  }));

  // Resolved exactly like the GET route: listBlocksInRange, then
  // getBlockLabel per-block for THIS viewer — never send an unresolved
  // label to the client and filter client-side.
  const resolvedBlocks = await listBlocksInRange(studioId, from, to, selectedLocationId);
  const dayViewBlocks: DayViewBlock[] = resolvedBlocks.map((block) => ({
    id: block.id,
    instructorUserId: block.instructorUserId,
    // instructorBlocks.kind is a `text` column (app-level validated, not
    // a DB enum — see lib/db/schema.ts), so ResolvedBlock.kind widens to
    // `string`; narrowed back here since createBlockSchema's
    // discriminated union already guarantees only these three values are
    // ever written.
    kind: block.kind as DayViewBlock["kind"],
    label: getBlockLabel(userId, block, canManageAll),
    startAt: block.startAt,
    endAt: block.endAt,
  }));

  let bookingSection: ReactNode = null;
  if (canBook) {
    const [allStudents, primaryAssignments, studioRooms] = await Promise.all([
      withTenantContext({ userId, tenantId: studioId }, (tx) =>
        tx
          .select({ id: students.id, displayName: students.displayName })
          .from(students)
          .where(eq(students.studioId, studioId))
          .orderBy(asc(students.displayName))
      ),
      // No shared helper exists for "this student's current primary
      // instructor" (this task's brief) — query studentAssignments
      // directly, the same shape
      // app/dashboard/students/[studentId]/page.tsx already uses for its
      // own assignment-history section.
      withTenantContext({ userId, tenantId: studioId }, (tx) =>
        tx
          .select({
            studentId: studentAssignments.studentId,
            instructorUserId: studentAssignments.instructorUserId,
          })
          .from(studentAssignments)
          .where(
            and(
              eq(studentAssignments.studioId, studioId),
              eq(studentAssignments.isPrimary, true),
              isNull(studentAssignments.endedAt)
            )
          )
      ),
      withTenantContext({ userId, tenantId: studioId }, (tx) =>
        tx
          .select({ id: rooms.id, name: rooms.name, locationId: rooms.locationId })
          .from(rooms)
          .where(eq(rooms.studioId, studioId))
      ),
    ]);

    const primaryInstructorByStudent = new Map(
      primaryAssignments.map((assignment) => [assignment.studentId, assignment.instructorUserId])
    );
    const bookingStudents = allStudents.map((student) => ({
      id: student.id,
      displayName: student.displayName,
      currentInstructorUserId: primaryInstructorByStudent.get(student.id) ?? null,
    }));
    const bookingInstructors = instructorLoad.map((instructor) => ({
      instructorUserId: instructor.instructorUserId,
      name: instructor.name,
    }));
    const bookingLocations = allLocations.map((location) => ({
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    }));

    bookingSection = (
      <Card>
        <CardHeader>
          <CardTitle>Book a lesson</CardTitle>
        </CardHeader>
        <CardContent>
          <BookingForm
            studioId={studioId}
            students={bookingStudents}
            instructors={bookingInstructors}
            instructorLoad={instructorLoad}
            locations={bookingLocations}
            rooms={studioRooms}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="scheduleDate" className="text-sm font-medium">
                Date
              </label>
              <input
                id="scheduleDate"
                name="date"
                type="date"
                defaultValue={dateParamValue}
                className="h-10 rounded-lg border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            {allLocations.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="scheduleLocationId" className="text-sm font-medium">
                  Location
                </label>
                <select
                  id="scheduleLocationId"
                  name="locationId"
                  defaultValue={selectedLocationId}
                  className="h-10 rounded-lg border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {allLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Button type="submit">View</Button>
          </form>

          <DayView instructors={instructorColumns} appointments={dayViewAppointments} blocks={dayViewBlocks} />
        </CardContent>
      </Card>

      {bookingSection}
    </div>
  );
}
