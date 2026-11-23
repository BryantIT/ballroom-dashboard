// app/dashboard/dashboard-nav.tsx
import Link from "next/link";
import type { PublicBranding } from "@/lib/branding/public-branding";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

// Extracted from the dashboard layout so it can be rendered in isolation
// (no real session/DB) in app/dashboard/layout.test.tsx.
export function DashboardNav({
  branding,
  canManageBranding,
  canAccessSchedulingSettings,
}: {
  branding: PublicBranding;
  // Whether the current user holds branding.manage for this studio
  // (resolved by the layout, which already has userId/studioId) — gates
  // whether the settings link below is shown at all.
  canManageBranding: boolean;
  // Whether the current user holds ANY of locations.manage,
  // appointments.manage_all, or appointments.manage_self (resolved by
  // the layout) — the scheduling settings page itself never fully denies
  // an active member (it always shows at least a self-service
  // personal-time-off section to anyone with one of the two appointments
  // permissions), so this link is shown whenever any section of that
  // page would actually render something.
  canAccessSchedulingSettings: boolean;
}) {
  return (
    <nav className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
      <div className="flex items-center gap-3">
        {branding.logoUrl ? (
          // Studio logos are user-uploaded (lib/branding/logo.ts), not an
          // optimizable static asset known at build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={branding.studioName}
            className="h-9 w-9 rounded-md object-contain"
          />
        ) : (
          <div
            data-logo-fallback
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground"
          >
            {branding.studioName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-semibold">{branding.studioName}</span>
      </div>
      <div className="flex items-center gap-2">
        {/* students.read is granted to all three built-in roles, so
            unlike the branding link below, this one needs no permission
            gate — every user who reaches the dashboard can see it. */}
        <Link
          href="/dashboard/students"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Students
        </Link>
        {/* appointments.read_all is likewise granted to all three
            built-in roles (Task 14's brief) — same no-gate rationale as
            the Students link above. */}
        <Link
          href="/dashboard/schedule"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Schedule
        </Link>
        {canAccessSchedulingSettings ? (
          <Link
            href="/dashboard/settings/scheduling"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Scheduling settings
          </Link>
        ) : null}
        {canManageBranding ? (
          <Link
            href="/dashboard/settings/branding"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Branding settings
          </Link>
        ) : null}
        <ThemeToggle />
        <SignOutButton />
      </div>
    </nav>
  );
}
