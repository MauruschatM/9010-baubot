import type { AppLocale } from "@mvp-template/i18n";
import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import { vNullableAppLocale } from "./lib/locales";

const vThemePreference = v.union(v.literal("light"), v.literal("dark"), v.null());

async function getLocalePreferenceByUserId(ctx: QueryCtx | MutationCtx, userId: string) {
  const preference = await ctx.db
    .query("userPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  return preference?.locale ?? null;
}

async function setLocalePreferenceByUserId(
  ctx: MutationCtx,
  userId: string,
  locale: AppLocale | null,
) {
  const existingPreference = await ctx.db
    .query("userPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  if (locale === null) {
    if (existingPreference) {
      await ctx.db.delete(existingPreference._id);
    }
    return null;
  }

  const updatedAt = Date.now();

  if (existingPreference) {
    await ctx.db.patch(existingPreference._id, {
      locale,
      updatedAt,
    });
    return locale;
  }

  await ctx.db.insert("userPreferences", {
    userId,
    locale,
    updatedAt,
  });
  return locale;
}

async function getThemePreferenceByUserId(ctx: QueryCtx | MutationCtx, userId: string) {
  const preference = await ctx.db
    .query("userThemePreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  return preference?.theme ?? null;
}

async function setThemePreferenceByUserId(
  ctx: MutationCtx,
  userId: string,
  theme: "light" | "dark" | null,
) {
  const existingPreference = await ctx.db
    .query("userThemePreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  if (theme === null) {
    if (existingPreference) {
      await ctx.db.delete(existingPreference._id);
    }
    return null;
  }

  const updatedAt = Date.now();

  if (existingPreference) {
    await ctx.db.patch(existingPreference._id, {
      theme,
      updatedAt,
    });
    return theme;
  }

  await ctx.db.insert("userThemePreferences", {
    userId,
    theme,
    updatedAt,
  });
  return theme;
}

export const getMyLocale = query({
  args: {},
  returns: vNullableAppLocale,
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    return await getLocalePreferenceByUserId(ctx, authUser._id);
  },
});

export const setMyLocale = mutation({
  args: {
    locale: vNullableAppLocale,
  },
  returns: vNullableAppLocale,
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }

    return await setLocalePreferenceByUserId(ctx, authUser._id, args.locale);
  },
});

export const getMyTheme = query({
  args: {},
  returns: vThemePreference,
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    return await getThemePreferenceByUserId(ctx, authUser._id);
  },
});

export const setMyTheme = mutation({
  args: {
    theme: vThemePreference,
  },
  returns: vThemePreference,
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Not authenticated");
    }

    return await setThemePreferenceByUserId(ctx, authUser._id, args.theme);
  },
});

export const getLocaleForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: vNullableAppLocale,
  handler: async (ctx, args) => {
    return await getLocalePreferenceByUserId(ctx, args.userId);
  },
});

export const setLocaleForUser = internalMutation({
  args: {
    userId: v.string(),
    locale: vNullableAppLocale,
  },
  returns: vNullableAppLocale,
  handler: async (ctx, args) => {
    return await setLocalePreferenceByUserId(ctx, args.userId, args.locale);
  },
});

export const getThemeForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: vThemePreference,
  handler: async (ctx, args) => {
    return await getThemePreferenceByUserId(ctx, args.userId);
  },
});

export const setThemeForUser = internalMutation({
  args: {
    userId: v.string(),
    theme: vThemePreference,
  },
  returns: vThemePreference,
  handler: async (ctx, args) => {
    return await setThemePreferenceByUserId(ctx, args.userId, args.theme);
  },
});
