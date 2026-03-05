import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { authComponent } from "./auth";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
};

export const generateUploadUrl = mutation({
  args: {
    organizationId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    return await ctx.storage.generateUploadUrl();
  },
});
