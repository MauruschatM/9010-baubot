"use node";

import type { AppLocale } from "@mvp-template/i18n";
import type { FunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { requireActiveOrganization } from "./authhelpers";
import { authComponent } from "./auth";
import { hashText, translateTextsWithAi } from "./i18nCore";
import { normalizeAppLocale, vAppLocale } from "./lib/locales";

type TimelineLocalizedMedia = {
  mediaAssetId: Id<"whatsappMediaAssets">;
  mimeType: string;
  kind: "image" | "audio" | "video" | "file";
  url?: string;
  summary?: string;
  transcript?: string;
  extractedText?: string;
  fieldLocales?: {
    transcript?: string;
    extractedText?: string;
    summary?: string;
  };
};

type TimelineLocalizedRow = {
  _id: Id<"projectTimelineItems">;
  batchId: Id<"whatsappSendBatches">;
  sourceType: "whatsapp_message" | "whatsapp_batch_summary";
  messageId?: Id<"whatsappMessages">;
  addedAt: number;
  dayBucketUtc: string;
  addedByMemberId: string;
  addedByUserId: string;
  addedByName?: string;
  sourceText?: string;
  text?: string;
  transcript?: string;
  extractedText?: string;
  summary?: string;
  batchTitle?: string;
  batchOverview?: string;
  hasNachtrag?: boolean;
  nachtragNeedsClarification?: boolean;
  nachtragItems?: string[];
  nachtragDetails?: string;
  nachtragLanguage?: AppLocale;
  keywords?: string[];
  fieldLocales?: {
    sourceText?: string;
    text?: string;
    transcript?: string;
    extractedText?: string;
    summary?: string;
    batchTitle?: string;
    batchOverview?: string;
    nachtragDetails?: string;
    nachtragItems?: string[];
  };
  media: TimelineLocalizedMedia[];
};

const timelineRef = api.projects.timeline as FunctionReference<
  "query",
  "public",
  { projectId: Id<"projects">; limit?: number },
  TimelineLocalizedRow[]
>;

const getLocaleByUserIdRef = internal.preferences.getLocaleForUser as FunctionReference<
  "query",
  "internal",
  { userId: string },
  AppLocale | null
>;

const getTimelineTranslationsForItemsRef =
  internal.projectTranslationsData.getTimelineTranslationsForItems as FunctionReference<
    "query",
    "internal",
    { timelineItemIds: Id<"projectTimelineItems">[]; locale: string },
    Array<{
      _id: Id<"timelineItemTranslations">;
      timelineItemId: Id<"projectTimelineItems">;
      field: string;
      locale: string;
      sourceHash: string;
      text: string;
    }>
  >;

const upsertTimelineTranslationRef =
  internal.projectTranslationsData.upsertTimelineTranslation as FunctionReference<
    "mutation",
    "internal",
    {
      organizationId: string;
      timelineItemId: Id<"projectTimelineItems">;
      field: string;
      locale: string;
      sourceHash: string;
      text: string;
    },
    Id<"timelineItemTranslations">
  >;

const getMediaTranslationsForAssetsRef =
  internal.projectTranslationsData.getMediaTranslationsForAssets as FunctionReference<
    "query",
    "internal",
    { mediaAssetIds: Id<"whatsappMediaAssets">[]; locale: string },
    Array<{
      _id: Id<"whatsappMediaAssetTranslations">;
      mediaAssetId: Id<"whatsappMediaAssets">;
      field: string;
      locale: string;
      sourceHash: string;
      text: string;
    }>
  >;

const upsertMediaTranslationRef =
  internal.projectTranslationsData.upsertMediaTranslation as FunctionReference<
    "mutation",
    "internal",
    {
      organizationId: string;
      mediaAssetId: Id<"whatsappMediaAssets">;
      field: string;
      locale: string;
      sourceHash: string;
      text: string;
    },
    Id<"whatsappMediaAssetTranslations">
  >;

const TIMELINE_FIELDS = [
  "text",
  "transcript",
  "extractedText",
  "summary",
  "batchTitle",
  "batchOverview",
  "nachtragDetails",
] as const;

const MEDIA_FIELDS = ["summary", "transcript", "extractedText"] as const;

type TimelineTranslatableField = (typeof TIMELINE_FIELDS)[number];
type MediaTranslatableField = (typeof MEDIA_FIELDS)[number];
type TranslationQueueEntry = {
  id: string;
  text: string;
  kind: "timeline" | "media";
  entityId: Id<"projectTimelineItems"> | Id<"whatsappMediaAssets">;
  field: string;
  sourceHash: string;
};
type TimelineTranslationCacheEntry = {
  _id: Id<"timelineItemTranslations">;
  timelineItemId: Id<"projectTimelineItems">;
  field: string;
  locale: string;
  sourceHash: string;
  text: string;
};
type MediaTranslationCacheEntry = {
  _id: Id<"whatsappMediaAssetTranslations">;
  mediaAssetId: Id<"whatsappMediaAssets">;
  field: string;
  locale: string;
  sourceHash: string;
  text: string;
};

function resolveStoredLocale(value: string | undefined): AppLocale | null {
  return normalizeAppLocale(value);
}

function timelineTranslationKey(
  timelineItemId: Id<"projectTimelineItems">,
  field: string,
) {
  return `timeline:${timelineItemId}:${field}`;
}

function mediaTranslationKey(
  mediaAssetId: Id<"whatsappMediaAssets">,
  field: string,
) {
  return `media:${mediaAssetId}:${field}`;
}

export function resolveTimelineTranslationLocale(
  preferredLocale: AppLocale | null | undefined,
  viewerLocale: AppLocale | null | undefined,
): AppLocale {
  return preferredLocale ?? viewerLocale ?? "en";
}

export function shouldTranslateStoredValue(
  sourceLocale: AppLocale | null,
  targetLocale: AppLocale,
) {
  return sourceLocale !== null && sourceLocale !== targetLocale;
}

export function resolveStoredTranslationDecision(options: {
  currentValue: string;
  sourceLocale: AppLocale | null;
  targetLocale: AppLocale;
  sourceHash: string;
  cached?: {
    sourceHash: string;
    text: string;
  } | null;
}) {
  if (options.cached?.sourceHash === options.sourceHash) {
    return {
      localizedValue: options.cached.text,
      shouldQueueTranslation: false,
    };
  }

  return {
    localizedValue: options.currentValue,
    shouldQueueTranslation: shouldTranslateStoredValue(options.sourceLocale, options.targetLocale),
  };
}

function assignTimelineField(
  row: {
    text?: string;
    transcript?: string;
    extractedText?: string;
    summary?: string;
    batchTitle?: string;
    batchOverview?: string;
    nachtragDetails?: string;
  },
  field: TimelineTranslatableField,
  value: string,
) {
  if (field === "text") {
    row.text = value;
    return;
  }

  if (field === "transcript") {
    row.transcript = value;
    return;
  }

  if (field === "extractedText") {
    row.extractedText = value;
    return;
  }

  if (field === "summary") {
    row.summary = value;
    return;
  }

  if (field === "batchTitle") {
    row.batchTitle = value;
    return;
  }

  if (field === "batchOverview") {
    row.batchOverview = value;
    return;
  }

  row.nachtragDetails = value;
}

function assignMediaField(
  row: {
    summary?: string;
    transcript?: string;
    extractedText?: string;
  },
  field: MediaTranslatableField,
  value: string,
) {
  if (field === "summary") {
    row.summary = value;
    return;
  }

  if (field === "transcript") {
    row.transcript = value;
    return;
  }

  row.extractedText = value;
}

async function localizeTimelineRows(options: {
  ctx: any;
  organizationId: string;
  userId: string;
  locale: AppLocale;
  rows: TimelineLocalizedRow[];
}) {
  if (options.rows.length === 0) {
    return options.rows;
  }

  const timelineItemIds = options.rows.map((row) => row._id);
  const mediaAssetIds = Array.from(
    new Set(
      options.rows.flatMap((row) =>
        row.media.map((media) => String(media.mediaAssetId)),
      ),
    ),
  ).map((value) => value as Id<"whatsappMediaAssets">);
  const [timelineCache, mediaCache] = await Promise.all([
    options.ctx.runQuery(getTimelineTranslationsForItemsRef, {
      timelineItemIds,
      locale: options.locale,
    }),
    options.ctx.runQuery(getMediaTranslationsForAssetsRef, {
      mediaAssetIds,
      locale: options.locale,
    }),
  ]);
  const timelineCacheByKey = new Map(
    (timelineCache as TimelineTranslationCacheEntry[]).map((entry) => [
      `${entry.timelineItemId}:${entry.field}`,
      entry,
    ]),
  );
  const mediaCacheByKey = new Map(
    (mediaCache as MediaTranslationCacheEntry[]).map((entry) => [
      `${entry.mediaAssetId}:${entry.field}`,
      entry,
    ]),
  );
  const translationQueue: TranslationQueueEntry[] = [];
  const localizedRows = await Promise.all(
    options.rows.map(async (row) => {
      const localizedRow: TimelineLocalizedRow = {
        ...row,
        media: row.media.map((media) => ({ ...media })),
      };

      for (const field of TIMELINE_FIELDS) {
        const currentValue = localizedRow[field];

        if (typeof currentValue !== "string" || currentValue.trim().length === 0) {
          continue;
        }

        const translationKey = timelineTranslationKey(localizedRow._id, field);
        const sourceHash = await hashText(currentValue);
        const cacheKey = `${localizedRow._id}:${field}`;
        const cached = timelineCacheByKey.get(cacheKey);
        const sourceLocale = resolveStoredLocale(localizedRow.fieldLocales?.[field]);
        const translationDecision = resolveStoredTranslationDecision({
          currentValue,
          sourceLocale,
          targetLocale: options.locale,
          sourceHash,
          cached,
        });

        if (translationDecision.localizedValue !== currentValue) {
          assignTimelineField(localizedRow, field, translationDecision.localizedValue);
          continue;
        }

        if (!translationDecision.shouldQueueTranslation) {
          continue;
        }

        translationQueue.push({
          id: translationKey,
          text: currentValue,
          kind: "timeline",
          entityId: localizedRow._id,
          field,
          sourceHash,
        });
      }

      const currentNachtragItems = Array.isArray(localizedRow.nachtragItems)
        ? localizedRow.nachtragItems
        : [];
      const localizedNachtragItems = [...currentNachtragItems];

      for (const [itemIndex, item] of currentNachtragItems.entries()) {
        if (typeof item !== "string" || item.trim().length === 0) {
          continue;
        }

        const field = `nachtragItems.${itemIndex}`;
        const translationKey = timelineTranslationKey(localizedRow._id, field);
        const sourceHash = await hashText(item);
        const cacheKey = `${localizedRow._id}:${field}`;
        const cached = timelineCacheByKey.get(cacheKey);
        const sourceLocale = resolveStoredLocale(localizedRow.fieldLocales?.nachtragItems?.[itemIndex]);
        const translationDecision = resolveStoredTranslationDecision({
          currentValue: item,
          sourceLocale,
          targetLocale: options.locale,
          sourceHash,
          cached,
        });

        if (translationDecision.localizedValue !== item) {
          localizedNachtragItems[itemIndex] = translationDecision.localizedValue;
          continue;
        }

        if (!translationDecision.shouldQueueTranslation) {
          continue;
        }

        translationQueue.push({
          id: translationKey,
          text: item,
          kind: "timeline",
          entityId: localizedRow._id,
          field,
          sourceHash,
        });
      }

      if (localizedNachtragItems.length > 0) {
        localizedRow.nachtragItems = localizedNachtragItems;
      }

      for (const media of localizedRow.media) {
        for (const field of MEDIA_FIELDS) {
          const currentValue = media[field];

          if (typeof currentValue !== "string" || currentValue.trim().length === 0) {
            continue;
          }

          const translationKey = mediaTranslationKey(media.mediaAssetId, field);
          const sourceHash = await hashText(currentValue);
          const cacheKey = `${media.mediaAssetId}:${field}`;
          const cached = mediaCacheByKey.get(cacheKey);
          const sourceLocale = resolveStoredLocale(media.fieldLocales?.[field]);
          const translationDecision = resolveStoredTranslationDecision({
            currentValue,
            sourceLocale,
            targetLocale: options.locale,
            sourceHash,
            cached,
          });

          if (translationDecision.localizedValue !== currentValue) {
            assignMediaField(media, field, translationDecision.localizedValue);
            continue;
          }

          if (!translationDecision.shouldQueueTranslation) {
            continue;
          }

          translationQueue.push({
            id: translationKey,
            text: currentValue,
            kind: "media",
            entityId: media.mediaAssetId,
            field,
            sourceHash,
          });
        }
      }

      return localizedRow;
    }),
  );

  if (translationQueue.length === 0) {
    return localizedRows;
  }

  const translations = await translateTextsWithAi(options.ctx, {
    organizationId: options.organizationId,
    targetLocale: options.locale,
    items: translationQueue.map((entry) => ({ id: entry.id, text: entry.text })),
    userId: options.userId,
  });

  for (const row of localizedRows) {
    for (const field of TIMELINE_FIELDS) {
      const translated = translations[timelineTranslationKey(row._id, field)];

      if (translated) {
        assignTimelineField(row, field, translated);
      }
    }

    if (Array.isArray(row.nachtragItems)) {
      row.nachtragItems = row.nachtragItems.map((item: string, itemIndex: number) => {
        const translated = translations[timelineTranslationKey(row._id, `nachtragItems.${itemIndex}`)];
        return translated ?? item;
      });
    }

    for (const media of row.media) {
      for (const field of MEDIA_FIELDS) {
        const translated = translations[mediaTranslationKey(media.mediaAssetId, field)];

        if (translated) {
          assignMediaField(media, field, translated);
        }
      }
    }
  }

  for (const entry of translationQueue) {
    const translatedText = translations[entry.id] ?? entry.text;

    if (entry.kind === "timeline") {
      await options.ctx.runMutation(upsertTimelineTranslationRef, {
        organizationId: options.organizationId,
        timelineItemId: entry.entityId as Id<"projectTimelineItems">,
        field: entry.field,
        locale: options.locale,
        sourceHash: entry.sourceHash,
        text: translatedText,
      });
      continue;
    }

    await options.ctx.runMutation(upsertMediaTranslationRef, {
      organizationId: options.organizationId,
      mediaAssetId: entry.entityId as Id<"whatsappMediaAssets">,
      field: entry.field,
      locale: options.locale,
      sourceHash: entry.sourceHash,
      text: translatedText,
    });
  }

  return localizedRows;
}

export const timelineLocalized = action({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
    viewerLocale: v.optional(vAppLocale),
  },
  returns: v.object({
    locale: vAppLocale,
    rows: v.array(
      v.object({
        _id: v.id("projectTimelineItems"),
        batchId: v.id("whatsappSendBatches"),
        sourceType: v.union(v.literal("whatsapp_message"), v.literal("whatsapp_batch_summary")),
        messageId: v.optional(v.id("whatsappMessages")),
        addedAt: v.number(),
        dayBucketUtc: v.string(),
        addedByMemberId: v.string(),
        addedByUserId: v.string(),
        addedByName: v.optional(v.string()),
        sourceText: v.optional(v.string()),
        text: v.optional(v.string()),
        transcript: v.optional(v.string()),
        extractedText: v.optional(v.string()),
        summary: v.optional(v.string()),
        batchTitle: v.optional(v.string()),
        batchOverview: v.optional(v.string()),
        hasNachtrag: v.optional(v.boolean()),
        nachtragNeedsClarification: v.optional(v.boolean()),
        nachtragItems: v.optional(v.array(v.string())),
        nachtragDetails: v.optional(v.string()),
        nachtragLanguage: v.optional(vAppLocale),
        keywords: v.optional(v.array(v.string())),
        fieldLocales: v.optional(
          v.object({
            sourceText: v.optional(v.string()),
            text: v.optional(v.string()),
            transcript: v.optional(v.string()),
            extractedText: v.optional(v.string()),
            summary: v.optional(v.string()),
            batchTitle: v.optional(v.string()),
            batchOverview: v.optional(v.string()),
            nachtragDetails: v.optional(v.string()),
            nachtragItems: v.optional(v.array(v.string())),
          }),
        ),
        media: v.array(
          v.object({
            mediaAssetId: v.id("whatsappMediaAssets"),
            mimeType: v.string(),
            kind: v.union(
              v.literal("image"),
              v.literal("audio"),
              v.literal("video"),
              v.literal("file"),
            ),
            url: v.optional(v.string()),
            summary: v.optional(v.string()),
            transcript: v.optional(v.string()),
            extractedText: v.optional(v.string()),
            fieldLocales: v.optional(
              v.object({
                transcript: v.optional(v.string()),
                extractedText: v.optional(v.string()),
                summary: v.optional(v.string()),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const user = (await authComponent.safeGetAuthUser(ctx)) as { _id?: string } | null;

    if (!user?._id) {
      throw new ConvexError("Unauthenticated");
    }

    const organization = await requireActiveOrganization(ctx);
    const preferredLocale = await ctx.runQuery(getLocaleByUserIdRef, {
      userId: user._id,
    });
    const locale = resolveTimelineTranslationLocale(preferredLocale, args.viewerLocale);
    const rows = await ctx.runQuery(timelineRef, {
      projectId: args.projectId,
      limit: Math.min(Math.max(args.limit ?? 500, 1), 500),
    });

    if (rows.length === 0) {
      return {
        locale,
        rows,
      };
    }

    return {
      locale,
      rows: await localizeTimelineRows({
        ctx,
        organizationId: organization.id,
        userId: user._id,
        locale,
        rows,
      }),
    };
  },
});

export const timelineLocalizedForOrganizationUser = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
    viewerLocale: v.optional(vAppLocale),
  },
  handler: async (ctx, args) => {
    const preferredLocale = await ctx.runQuery(getLocaleByUserIdRef, {
      userId: args.userId,
    });
    const locale = resolveTimelineTranslationLocale(preferredLocale, args.viewerLocale);
    const rows = (await ctx.runQuery((internal as any).projects.timelineForOrganization, {
      organizationId: args.organizationId,
      userId: args.userId,
      projectId: args.projectId,
      limit: Math.min(Math.max(args.limit ?? 500, 1), 500),
    })) as Awaited<ReturnType<typeof ctx.runQuery>>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        locale,
        rows: Array.isArray(rows) ? rows : [],
      };
    }

    return {
      locale,
      rows: await localizeTimelineRows({
        ctx,
        organizationId: args.organizationId,
        userId: args.userId,
        locale,
        rows: rows as TimelineLocalizedRow[],
      }),
    };
  },
});
