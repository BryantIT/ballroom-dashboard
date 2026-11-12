// lib/studios/provision.ts
import "server-only";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { withTenantContext } from "../db/with-tenant-context";
import { studios, locations, roles, rolePermissions, memberships, studioBranding } from "../db/schema";
import * as schema from "../db/schema";
import { BUILTIN_ROLES, BUILTIN_ROLE_PERMISSIONS } from "../auth/permissions";
import { generateUniqueSlug } from "../branding/slug";

type Db = NodePgDatabase<typeof schema>;

export type ProvisionStudioInput = {
  ownerId: string;
  studioName: string;
  timezone: string;
};

export type ProvisionStudioResult = {
  studioId: string;
  locationId: string;
  ownerMembershipId: string;
  slug: string;
};

const BUILTIN_ROLE_NAMES: Record<(typeof BUILTIN_ROLES)[number], string> = {
  owner: "Owner",
  admin: "Admin",
  instructor: "Instructor",
};

export async function provisionStudio(
  input: ProvisionStudioInput,
  database?: Db
): Promise<ProvisionStudioResult> {
  const studioId = crypto.randomUUID();

  return withTenantContext(
    { userId: input.ownerId, tenantId: studioId },
    async (tx) => {
      await tx.insert(studios).values({ id: studioId, name: input.studioName });

      const [location] = await tx
        .insert(locations)
        .values({ studioId, name: "Main Location", timezone: input.timezone })
        .returning();

      const slug = await generateUniqueSlug(input.studioName, async (candidate) => {
        const [existing] = await tx
          .select({ s: studioBranding.slug })
          .from(studioBranding)
          .where(eq(studioBranding.slug, candidate))
          .limit(1);
        return existing !== undefined;
      });

      await tx.insert(studioBranding).values({ studioId, slug });

      let ownerRoleId: string | undefined;
      for (const code of BUILTIN_ROLES) {
        const [role] = await tx
          .insert(roles)
          .values({ studioId, code, name: BUILTIN_ROLE_NAMES[code] })
          .returning();

        const grants = BUILTIN_ROLE_PERMISSIONS[code];
        if (grants.length > 0) {
          await tx.insert(rolePermissions).values(
            grants.map((permissionCode) => ({
              roleId: role.id,
              permissionCode,
              studioId,
            }))
          );
        }

        if (code === "owner") {
          ownerRoleId = role.id;
        }
      }

      const [ownerMembership] = await tx
        .insert(memberships)
        .values({
          studioId,
          userId: input.ownerId,
          roleId: ownerRoleId!,
          status: "active",
        })
        .returning();

      return {
        studioId,
        locationId: location.id,
        ownerMembershipId: ownerMembership.id,
        slug,
      };
    },
    database
  );
}
