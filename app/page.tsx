// app/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { extractSubdomainSlug } from "@/lib/branding/subdomain";
import { getPublicBrandingBySlug, type PublicBranding } from "@/lib/branding/public-branding";
import { ThemeRoot } from "@/lib/branding/theme-root";
import { Button } from "@/components/ui/button";

// The public, pre-auth splash page for a studio's branded subdomain.
// Extracted so it can be rendered directly in tests without a real
// session/DB/host header.
// Studio-level colorMode is a public "front door" decision: when the
// owner has explicitly picked "light" or "dark", the splash page should
// render in that mode regardless of the visitor's OS preference. "system"
// forces nothing, leaving the existing next-themes system-preference
// detection (configured at the root layout) in control.
function forceModeFor(colorMode: PublicBranding["colorMode"]): "light" | "dark" | undefined {
  if (colorMode === "light" || colorMode === "dark") {
    return colorMode;
  }
  return undefined;
}

export function BrandedSplash({ branding }: { branding: PublicBranding }) {
  return (
    <ThemeRoot
      preset={branding.themePreset}
      accentOverride={branding.accentColorOverride}
      forceMode={forceModeFor(branding.colorMode)}
    >
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        {branding.logoUrl ? (
          // Studio logos are user-uploaded (lib/branding/logo.ts), not an
          // optimizable static asset known at build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={branding.studioName}
            className="h-16 w-16 rounded-md object-contain"
          />
        ) : (
          <div
            data-logo-fallback
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-md bg-muted text-2xl font-semibold text-muted-foreground"
          >
            {branding.studioName.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="text-2xl font-semibold">{branding.studioName}</h1>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </ThemeRoot>
  );
}

export default async function Home(props: PageProps<"/">) {
  // `@/auth` statically imports lib/db/client.ts, which throws at module
  // load if DATABASE_RUNTIME_URL isn't set (see that file). This module is
  // reachable from app/page.test.tsx's render of BrandedSplash (the named
  // export colocated in this file) without a real DB configured, so the
  // import is deferred into the function body — same lazy-import pattern
  // as app/dashboard/actions.ts's signOutAction — rather than at the top
  // of this file, so merely importing this module never touches the DB
  // client.
  const { auth } = await import("@/auth");
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const host = (await headers()).get("host") ?? "";
  const params = await props.searchParams;
  const devOverride =
    process.env.NODE_ENV !== "production"
      ? ((params.studio as string | undefined) ?? null)
      : null;
  const slug = devOverride ?? extractSubdomainSlug(host);
  const branding = slug ? await getPublicBrandingBySlug(slug) : null;
  if (!branding) {
    redirect("/login");
  }

  return <BrandedSplash branding={branding} />;
}
