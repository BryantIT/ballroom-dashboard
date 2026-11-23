// app/dashboard/settings/scheduling/page.tsx
import { and, asc, eq } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { instructorLocations, locations, memberships } from "@/lib/db/schema";
import { hasPermission } from "@/lib/auth/authorization";
import { getInstructorLoad } from "@/lib/scheduling/instructor-load";
import { resolveInstructorTimezone, MissingLocationTimezoneError } from "@/lib/scheduling/blocks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InstructorLocationSettings } from "@/components/instructor-location-settings";
import { AvailabilityBlockForm } from "@/components/availability-block-form";

export default async function SchedulingSettingsPage() {
  const { userId } = await verifySession();

  // Same "first active membership, ordered by createdAt" resolution the
  // dashboard layout and every other dashboard page use — see
  // app/dashboard/layout.tsx for why this query shape and tenant context
  // (tenantId: null, relying on memberships' self_or_tenant_select RLS
  // policy) are correct.
  const [membership] = await withTenantContext({ userId, tenantId: null }, (tx) =>
    tx
      .select({ studioId: memberships.studioId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(memberships.createdAt))
      .limit(1)
  );

  if (!membership) {
    // The dashboard layout already renders its own "No studio yet" state
    // and does not render this page's children in that case, but this is
    // a cheap, harmless guard against the same real, reachable state.
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

  // Unlike the branding settings page (Owner-only, full-page deny), this
  // page must NEVER fully deny an active member: an instructor without
  // locations.manage still needs to manage their own personal-time-off
  // availability right here. Each section below is gated independently,
  // by exactly the permission its underlying route/service enforces
  // (this task's brief) — never a single page-wide check.
  //
  // - locations.manage: the instructor-location assignment section
  //   (assignInstructorToLocation, Owner-only today).
  // - appointments.manage_all: studio-wide holiday creation, and managing
  //   any OTHER instructor's blocks (createBlock's non-self-service
  //   branch).
  // - appointments.manage_self: managing the viewer's OWN blocks
  //   (createBlock's self-service branch).
  //
  // appointments.manage_all lets its holder manage any OTHER instructor's
  // blocks and create studio-wide holidays, but createBlock still treats
  // self-targeting (instructorUserId === callerUserId, for any kind but
  // studio_holiday) as requiring appointments.manage_self specifically —
  // manage_all alone does NOT cover it (the built-in Admin role holds
  // manage_all but not manage_self; only Owner holds both). The
  // availability section is still shown to anyone holding either
  // appointments permission (manage_all can always manage others'
  // blocks/holidays even with no self-service rights of their own), but
  // AvailabilityBlockForm's instructor picker (canManageSelf prop) must
  // exclude the viewer as a selectable target when they lack
  // manage_self, since that path would otherwise 403 server-side.
  const [canManageLocations, canManageAll, canManageSelf] = await Promise.all([
    hasPermission(userId, studioId, "locations.manage"),
    hasPermission(userId, studioId, "appointments.manage_all"),
    hasPermission(userId, studioId, "appointments.manage_self"),
  ]);
  const canManageOwnBlocks = canManageSelf || canManageAll;

  if (!canManageLocations && !canManageOwnBlocks) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Scheduling settings</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don&apos;t have access to this page.
        </CardContent>
      </Card>
    );
  }

  // Every bookable instructor in the studio (getInstructorLoad, Task
  // 11) — used both as the location-assignment roster and as the
  // target-instructor picker inside AvailabilityBlockForm when the
  // viewer holds appointments.manage_all.
  const instructorLoad = await getInstructorLoad(studioId);
  const instructorOptions = instructorLoad.map((instructor) => ({
    instructorUserId: instructor.instructorUserId,
    name: instructor.name,
  }));

  let locationSection = null;
  if (canManageLocations) {
    const [allLocations, assignments] = await Promise.all([
      withTenantContext({ userId, tenantId: studioId }, (tx) =>
        tx
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.studioId, studioId))
          .orderBy(asc(locations.name))
      ),
      // A single direct query scoped to the studio, not one
      // GET-equivalent round trip per instructor (this task's brief) —
      // same direct-table-query convention every other dashboard page
      // follows.
      withTenantContext({ userId, tenantId: studioId }, (tx) =>
        tx
          .select({
            instructorUserId: instructorLocations.instructorUserId,
            locationId: instructorLocations.locationId,
          })
          .from(instructorLocations)
          .where(eq(instructorLocations.studioId, studioId))
      ),
    ]);

    locationSection = (
      <Card>
        <CardHeader>
          <CardTitle>Instructor locations</CardTitle>
        </CardHeader>
        <CardContent>
          <InstructorLocationSettings
            studioId={studioId}
            locations={allLocations}
            instructors={instructorOptions}
            assignments={assignments}
          />
        </CardContent>
      </Card>
    );
  }

  let blockSection = null;
  if (canManageOwnBlocks) {
    // Resolved once here (a Server Component, so this is safe — unlike
    // AvailabilityBlockForm, a Client Component, which must never import
    // lib/scheduling/blocks.ts's server-only + DB-connecting chain) so
    // the personal_time_off path can build startAt/endAt in the TARGET
    // instructor's own effective timezone instead of the browser's
    // local offset. An instructor with no resolvable location (no
    // assignment and either zero or more than one studio location) maps
    // to null rather than crashing the whole page — the form surfaces
    // that as a blocking inline error only if that instructor is
    // actually selected for a personal_time_off block, never silently
    // falling back to UTC/local (this phase's Global Constraints).
    const instructorTimezones: Record<string, string | null> = {};
    await Promise.all(
      instructorOptions.map(async (instructor) => {
        try {
          instructorTimezones[instructor.instructorUserId] = await resolveInstructorTimezone(
            studioId,
            instructor.instructorUserId
          );
        } catch (error) {
          if (error instanceof MissingLocationTimezoneError) {
            instructorTimezones[instructor.instructorUserId] = null;
            return;
          }
          throw error;
        }
      })
    );

    blockSection = (
      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
        </CardHeader>
        <CardContent>
          <AvailabilityBlockForm
            studioId={studioId}
            currentUserId={userId}
            instructors={instructorOptions}
            instructorTimezones={instructorTimezones}
            canManageAll={canManageAll}
            canManageSelf={canManageSelf}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      {locationSection}
      {blockSection}
    </div>
  );
}
