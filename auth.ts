import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "./lib/db/client";
import * as schema from "./lib/db/schema";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
  }
}

type Db = NodePgDatabase<typeof schema>;

export async function authorizeCredentials(
  credentials: { email: string; password: string },
  database: Db = defaultDb
) {
  const [user] = await database
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, credentials.email))
    .limit(1);

  if (!user || !user.passwordHash) {
    return null;
  }

  const valid = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return { id: user.id, email: user.email, name: user.name };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(defaultDb, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (
          typeof credentials?.email !== "string" ||
          typeof credentials?.password !== "string"
        ) {
          return null;
        }
        return authorizeCredentials({
          email: credentials.email,
          password: credentials.password,
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
