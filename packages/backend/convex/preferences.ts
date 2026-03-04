import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const getMyLocale = query({
  args: {},
  returns: v.union(v.literal("en"), v.literal("de"), v.null()),
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const preference = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", authUser._id))
      .unique();

    return preference?.locale ?? null;
  },
});

export const setMyLocale = mutation({
  args: {
    locale: v.union(v.literal("en"), v.literal("de"), v.null()),
  },
  returns: v.union(v.literal("en"), v.literal("de"), v.null()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }

    const existingPreference = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", authUser._id))
      .unique();

    if (args.locale === null) {
      if (existingPreference) {
        await ctx.db.delete(existingPreference._id);
      }

      return null;
    }

    const updatedAt = Date.now();

    if (existingPreference) {
      await ctx.db.patch(existingPreference._id, {
        locale: args.locale,
        updatedAt,
      });

      return args.locale;
    }

    await ctx.db.insert("userPreferences", {
      userId: authUser._id,
      locale: args.locale,
      updatedAt,
    });

    return args.locale;
  },
});
