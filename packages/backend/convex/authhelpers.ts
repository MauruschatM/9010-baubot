import type { GenericCtx } from "@convex-dev/better-auth";
import { ConvexError } from "convex/values";

import type { DataModel } from "./_generated/dataModel";
import { authComponent, createAuth } from "./auth";

export interface ActiveOrganization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
}

export async function requireAuthUserId(ctx: GenericCtx<DataModel>): Promise<string> {
  const user = await authComponent.safeGetAuthUser(ctx);

  if (!user?._id) {
    throw new ConvexError("Unauthenticated");
  }

  return user._id;
}

export async function requireActiveOrganization(
  ctx: GenericCtx<DataModel>,
): Promise<ActiveOrganization> {
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

  try {
    const activeOrganization = await auth.api.getFullOrganization({ headers });

    if (activeOrganization?.id) {
      return {
        id: activeOrganization.id,
        name: activeOrganization.name,
        slug: activeOrganization.slug,
        logo: activeOrganization.logo ?? null,
      };
    }
  } catch {
    // Fall through to the single-org fallback below.
  }

  const organizations = await auth.api.listOrganizations({ headers });

  if (organizations.length === 1) {
    return {
      id: organizations[0].id,
      name: organizations[0].name,
      slug: organizations[0].slug,
      logo: organizations[0].logo ?? null,
    };
  }

  throw new ConvexError("No active organization selected");
}
