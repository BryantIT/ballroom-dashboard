// app/dashboard/settings/branding/page.tsx
import { and, asc, eq } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { memberships } from "@/lib/db/schema";
import { hasPermission } from "@/lib/auth/authorization";
import { getBrandingByStudioId } from "@/lib/branding/branding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandingSettingsForm } from "@/components/branding-settings-form";

export default async function BrandingSettingsPage() {
  const { userId } = await verifySession();

  // Same "first active membership, ordered by createdAt" resolution the
  // dashboard layout (Task 9) uses to pick which studio to show — see
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

  // The dashboard layout only checks for *some* active membership before
  // rendering this page at all — this page additionally needs the
  // specific branding.manage permission before it lets anyone see or
  // change theme/logo/slug settings.
  const canManageBranding = await hasPermission(userId, studioId, "branding.manage");

  if (!canManageBranding) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You don&apos;t have access to this page.
        </CardContent>
      </Card>
    );
  }

  const branding = await getBrandingByStudioId(studioId);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Branding</CardTitle>
      </CardHeader>
      <CardContent>
        <BrandingSettingsForm studioId={studioId} initial={branding} />
      </CardContent>
    </Card>
  );
}
