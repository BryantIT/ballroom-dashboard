// app/login/page.tsx
//
// Deliberately unbranded (no ThemeRoot / studio preset): this is the
// canonical sign-in page, reachable from any subdomain (including the
// apex domain and studios with no branding configured yet), so it always
// renders Ballroom Dash's own generic look rather than a particular
// studio's theme.
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">Ballroom Dash</h1>
      <LoginForm />
    </div>
  );
}
