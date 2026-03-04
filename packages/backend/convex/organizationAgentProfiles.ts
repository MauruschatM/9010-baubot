import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
};

const agentStyleValidator = v.union(v.literal("woman"), v.literal("man"));
const agentProfileValidator = v.object({
  organizationId: v.string(),
  name: v.string(),
  styleId: agentStyleValidator,
  updatedByUserId: v.string(),
  updatedAt: v.number(),
});
const MAX_AGENT_NAME_LENGTH = 80;

async function getMemberForOrganization(
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

export const getForOrganization = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(agentProfileValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const membership = await getMemberForOrganization(
      ctx,
      args.organizationId,
      authUser._id,
    );
    if (!membership) {
      return null;
    }

    const profile = await ctx.db
      .query("organizationAgentProfiles")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    if (!profile) {
      return null;
    }

    return {
      organizationId: profile.organizationId,
      name: profile.name,
      styleId: profile.styleId,
      updatedByUserId: profile.updatedByUserId,
      updatedAt: profile.updatedAt,
    };
  },
});

export const saveForOrganization = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    styleId: agentStyleValidator,
  },
  returns: agentProfileValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }

    const membership = await getMemberForOrganization(
      ctx,
      args.organizationId,
      authUser._id,
    );
    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const trimmedName = args.name.trim();
    if (trimmedName.length < 2) {
      throw new Error("AI agent name must be at least 2 characters");
    }
    if (trimmedName.length > MAX_AGENT_NAME_LENGTH) {
      throw new Error(`AI agent name must be at most ${MAX_AGENT_NAME_LENGTH} characters`);
    }

    const existingProfile = await ctx.db
      .query("organizationAgentProfiles")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const updatedAt = Date.now();

    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, {
        name: trimmedName,
        styleId: args.styleId,
        updatedByUserId: authUser._id,
        updatedAt,
      });
    } else {
      await ctx.db.insert("organizationAgentProfiles", {
        organizationId: args.organizationId,
        name: trimmedName,
        styleId: args.styleId,
        updatedByUserId: authUser._id,
        updatedAt,
      });
    }

    return {
      organizationId: args.organizationId,
      name: trimmedName,
      styleId: args.styleId,
      updatedByUserId: authUser._id,
      updatedAt,
    };
  },
});
