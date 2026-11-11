import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return { userId: session.user.id };
});

// API-route variant: returns null instead of redirecting, so route
// handlers can respond with a clean 401 for non-browser clients.
export const verifyApiSession = cache(async (): Promise<{ userId: string } | null> => {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  return { userId: session.user.id };
});
