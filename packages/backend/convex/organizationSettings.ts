import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { requireActiveOrganization } from "./authhelpers";
import { vAppLocale } from "./lib/locales";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
};

const organizationSettingsResultValidator = v.object({
  organizationId: v.string(),
  companyEmail: v.optional(v.string()),
  companyEmailLocale: v.optional(vAppLocale),
  updatedByUserId: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
});

async function getMembership(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
) {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "member",
    where: [
      {
        field: "organizationId",
        operator: "eq",
        value: organizationId,
      },
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
  })) as MemberDoc | null;
}

async function getSettingsByOrganizationId(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
) {
  return await ctx.db
    .query("organizationSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
}

export const getForActiveOrganization = query({
  args: {},
  returns: v.union(organizationSettingsResultValidator, v.null()),
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const organization = await requireActiveOrganization(ctx);
    const settings = await getSettingsByOrganizationId(ctx, organization.id);

    return {
      organizationId: organization.id,
      companyEmail: settings?.companyEmail,
      companyEmailLocale: settings?.companyEmailLocale,
      updatedByUserId: settings?.updatedByUserId,
      updatedAt: settings?.updatedAt,
    };
  },
});

export const saveForActiveOrganization = mutation({
  args: {
    companyEmail: v.union(v.string(), v.null()),
    companyEmailLocale: v.union(vAppLocale, v.null()),
  },
  returns: v.object({
    organizationId: v.string(),
    companyEmail: v.optional(v.string()),
    companyEmailLocale: v.optional(vAppLocale),
    updatedByUserId: v.string(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }

    const organization = await requireActiveOrganization(ctx);
    const membership = await getMembership(ctx, organization.id, authUser._id);
    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const trimmedEmail = args.companyEmail?.trim() ?? "";
    const companyEmail = trimmedEmail.length > 0 ? trimmedEmail.toLowerCase() : undefined;
    if (
      companyEmail &&
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(companyEmail)
    ) {
      throw new Error("Enter a valid company email address");
    }

    const companyEmailLocale = args.companyEmailLocale ?? undefined;
    const updatedAt = Date.now();
    const existing = await getSettingsByOrganizationId(ctx, organization.id);

    if (existing) {
      await ctx.db.patch(existing._id, {
        companyEmail,
        companyEmailLocale,
        updatedByUserId: authUser._id,
        updatedAt,
      });
    } else {
      await ctx.db.insert("organizationSettings", {
        organizationId: organization.id,
        companyEmail,
        companyEmailLocale,
        updatedByUserId: authUser._id,
        updatedAt,
      });
    }

    return {
      organizationId: organization.id,
      companyEmail,
      companyEmailLocale,
      updatedByUserId: authUser._id,
      updatedAt,
    };
  },
});
