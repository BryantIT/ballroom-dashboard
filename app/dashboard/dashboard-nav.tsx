// app/dashboard/dashboard-nav.tsx
import type { PublicBranding } from "@/lib/branding/public-branding";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

// Extracted from the dashboard layout so it can be rendered in isolation
// (no real session/DB) in app/dashboard/layout.test.tsx.
export function DashboardNav({ branding }: { branding: PublicBranding }) {
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
            className="h-9 w-9 rounded-md object-cover"
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
        <ThemeToggle />
        <SignOutButton />
      </div>
    </nav>
  );
}
