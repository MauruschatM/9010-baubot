import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

export const getTimelineTranslationsForItems = internalQuery({
  args: {
    timelineItemIds: v.array(v.id("projectTimelineItems")),
    locale: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("timelineItemTranslations"),
      timelineItemId: v.id("projectTimelineItems"),
      field: v.string(),
      locale: v.string(),
      sourceHash: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const all = await Promise.all(
      args.timelineItemIds.map(async (timelineItemId) => {
        return await ctx.db
          .query("timelineItemTranslations")
          .withIndex("by_timelineItem_locale_field", (q) =>
            q.eq("timelineItemId", timelineItemId).eq("locale", args.locale),
          )
          .collect();
      }),
    );

    return all.flat().map((entry) => ({
      _id: entry._id,
      timelineItemId: entry.timelineItemId,
      field: entry.field,
      locale: entry.locale,
      sourceHash: entry.sourceHash,
      text: entry.text,
    }));
  },
});

export const upsertTimelineTranslation = internalMutation({
  args: {
    organizationId: v.string(),
    timelineItemId: v.id("projectTimelineItems"),
    field: v.string(),
    locale: v.string(),
    sourceHash: v.string(),
    text: v.string(),
  },
  returns: v.id("timelineItemTranslations"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("timelineItemTranslations")
      .withIndex("by_timelineItem_locale_field", (q) =>
        q.eq("timelineItemId", args.timelineItemId)
          .eq("locale", args.locale)
          .eq("field", args.field),
      )
      .first();
    const now = Date.now();
    const patch: Partial<Doc<"timelineItemTranslations">> = {
      sourceHash: args.sourceHash,
      text: args.text,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("timelineItemTranslations", {
      organizationId: args.organizationId,
      timelineItemId: args.timelineItemId,
      field: args.field,
      locale: args.locale,
      sourceHash: args.sourceHash,
      text: args.text,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getMediaTranslationsForAssets = internalQuery({
  args: {
    mediaAssetIds: v.array(v.id("whatsappMediaAssets")),
    locale: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("whatsappMediaAssetTranslations"),
      mediaAssetId: v.id("whatsappMediaAssets"),
      field: v.string(),
      locale: v.string(),
      sourceHash: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const all = await Promise.all(
      args.mediaAssetIds.map(async (mediaAssetId) => {
        return await ctx.db
          .query("whatsappMediaAssetTranslations")
          .withIndex("by_mediaAsset_locale_field", (q) =>
            q.eq("mediaAssetId", mediaAssetId).eq("locale", args.locale),
          )
          .collect();
      }),
    );

    return all.flat().map((entry) => ({
      _id: entry._id,
      mediaAssetId: entry.mediaAssetId,
      field: entry.field,
      locale: entry.locale,
      sourceHash: entry.sourceHash,
      text: entry.text,
    }));
  },
});

export const upsertMediaTranslation = internalMutation({
  args: {
    organizationId: v.string(),
    mediaAssetId: v.id("whatsappMediaAssets"),
    field: v.string(),
    locale: v.string(),
    sourceHash: v.string(),
    text: v.string(),
  },
  returns: v.id("whatsappMediaAssetTranslations"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("whatsappMediaAssetTranslations")
      .withIndex("by_mediaAsset_locale_field", (q) =>
        q.eq("mediaAssetId", args.mediaAssetId)
          .eq("locale", args.locale)
          .eq("field", args.field),
      )
      .first();
    const now = Date.now();
    const patch: Partial<Doc<"whatsappMediaAssetTranslations">> = {
      sourceHash: args.sourceHash,
      text: args.text,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("whatsappMediaAssetTranslations", {
      organizationId: args.organizationId,
      mediaAssetId: args.mediaAssetId,
      field: args.field,
      locale: args.locale,
      sourceHash: args.sourceHash,
      text: args.text,
      createdAt: now,
      updatedAt: now,
    });
  },
});
