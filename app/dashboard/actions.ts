// app/dashboard/actions.ts
"use server";

// A Server Function can't be defined inline inside a Client Component
// (components/sign-out-button.tsx), so it lives here, in a file marked
// "use server" at the top, and is imported by the client component.
//
// `@/auth` statically imports lib/db/client.ts, which throws at module
// load if DATABASE_RUNTIME_URL isn't set (see that file). This module is
// reachable from app/dashboard/layout.test.tsx's render of DashboardNav
// (-> SignOutButton -> this file) without a real DB configured, so the
// import is deferred into the action body — same lazy-import pattern as
// lib/branding/branding.ts's `db` lookup — rather than at the top of this
// file, so merely importing this module never touches the DB client.
export async function signOutAction() {
  const { signOut } = await import("@/auth");
  await signOut();
}
