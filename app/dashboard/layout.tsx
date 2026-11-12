// app/dashboard/layout.tsx
import type { ReactNode } from "react";
import { and, asc, eq } from "drizzle-orm";
import { verifySession } from "@/lib/dal";
import { withTenantContext } from "@/lib/db/with-tenant-context";
import { memberships } from "@/lib/db/schema";
import { hasPermission } from "@/lib/auth/authorization";
import { getBrandingByStudioId } from "@/lib/branding/branding";
import { ThemeRoot } from "@/lib/branding/theme-root";
import { DashboardNav } from "./dashboard-nav";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { userId } = await verifySession();

  // Which studio to show: the first active membership for this user,
  // ordered by createdAt. Picking a "default" studio among several is
  // explicitly left open by the design doc; this is the simplest correct
  // choice for a single-studio owner, the common case this phase targets.
  //
  // memberships' RLS policy (self_or_tenant_select, drizzle/0009) allows
  // reading your own rows in ANY studio, not just one in tenant context —
  // so this runs with tenantId: null rather than a studio id we don't
  // know yet.
  const [membership] = await withTenantContext({ userId, tenantId: null }, (tx) =>
    tx
      .select({ studioId: memberships.studioId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(memberships.createdAt))
      .limit(1)
  );

  if (!membership) {
    // A real, reachable state for a brand-new user with no studio yet —
    // not a redirect loop.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold">No studio yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You&apos;re not a member of a studio yet. Once you&apos;re added to
          one, your dashboard will appear here.
        </p>
      </div>
    );
  }

  const branding = await getBrandingByStudioId(membership.studioId);
  const canManageBranding = await hasPermission(userId, membership.studioId, "branding.manage");

  return (
    <ThemeRoot preset={branding.themePreset} accentOverride={branding.accentColorOverride}>
      <div className="flex min-h-full flex-1 flex-col">
        <DashboardNav branding={branding} canManageBranding={canManageBranding} />
        <main className="flex flex-1 flex-col p-8">{children}</main>
      </div>
    </ThemeRoot>
  );
}
