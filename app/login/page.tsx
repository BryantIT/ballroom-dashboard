// app/login/page.tsx
//
// Deliberately unbranded (no ThemeRoot / studio preset): this is the
// canonical sign-in page, reachable from any subdomain (including the
// apex domain and studios with no branding configured yet), so it always
// renders Ballroom Dash's own generic look rather than a particular
// studio's theme.
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  // `@/auth` statically imports lib/db/client.ts (see app/page.tsx's
  // identical comment on this same lazy-import pattern), so this import
  // is deferred into the function body rather than hoisted to the top.
  const { auth } = await import("@/auth");
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">Ballroom Dash</h1>
      <LoginForm />
    </div>
  );
}
