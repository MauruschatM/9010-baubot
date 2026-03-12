"use node";

import type { AppLocale } from "@mvp-template/i18n";
import type { FunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { requireActiveOrganization } from "./authhelpers";
import { authComponent } from "./auth";
import { hashText, translateTextsWithGemini } from "./i18nCore";
import { normalizeAppLocale, vAppLocale } from "./lib/locales";

const timelineRef = api.projects.timeline as FunctionReference<
  "query",
  "public",
  { projectId: Id<"projects">; limit?: number },
  Array<{
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
    media: Array<{
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
    }>;
  }>
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

function resolveStoredLocale(value: string | undefined): AppLocale | null {
  return normalizeAppLocale(value);
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

export const timelineLocalized = action({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
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
    const locale = (await ctx.runQuery(getLocaleByUserIdRef, {
      userId: user._id,
    })) ?? "en";
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

    const timelineItemIds = rows.map((row) => row._id);
    const mediaAssetIds = Array.from(
      new Set(
        rows.flatMap((row) =>
          row.media.map((media: { mediaAssetId: Id<"whatsappMediaAssets"> }) =>
            String(media.mediaAssetId),
          ),
        ),
      ),
    ).map((value) => value as Id<"whatsappMediaAssets">);
    const [timelineCache, mediaCache] = await Promise.all([
      ctx.runQuery(getTimelineTranslationsForItemsRef, {
        timelineItemIds,
        locale,
      }),
      ctx.runQuery(getMediaTranslationsForAssetsRef, {
        mediaAssetIds,
        locale,
      }),
    ]);
    const timelineCacheByKey = new Map(
      timelineCache.map((entry) => [`${entry.timelineItemId}:${entry.field}`, entry]),
    );
    const mediaCacheByKey = new Map(
      mediaCache.map((entry) => [`${entry.mediaAssetId}:${entry.field}`, entry]),
    );
    const translationQueue: Array<{
      id: string;
      text: string;
      kind: "timeline" | "media";
      entityId: Id<"projectTimelineItems"> | Id<"whatsappMediaAssets">;
      field: string;
      sourceHash: string;
    }> = [];
    const localizedRows = await Promise.all(
      rows.map(async (row) => {
        const localizedRow = { ...row };

        for (const field of TIMELINE_FIELDS) {
          const currentValue = localizedRow[field];

          if (typeof currentValue !== "string" || currentValue.trim().length === 0) {
            continue;
          }

          const sourceLocale = resolveStoredLocale(localizedRow.fieldLocales?.[field]);
          const shouldTranslateTranscript = field === "transcript";

          if (sourceLocale === locale && !shouldTranslateTranscript) {
            continue;
          }

          const sourceHash = await hashText(currentValue);
          const cacheKey = `${localizedRow._id}:${field}`;
          const cached = timelineCacheByKey.get(cacheKey);

          if (cached?.sourceHash === sourceHash) {
            const cachedLooksUntranslated =
              sourceLocale !== null &&
              sourceLocale !== locale &&
              cached.text.trim() === currentValue.trim();

            if (cachedLooksUntranslated) {
              translationQueue.push({
                id: `timeline:${localizedRow._id}:${field}`,
                text: currentValue,
                kind: "timeline",
                entityId: localizedRow._id,
                field,
                sourceHash,
              });
              continue;
            }

            assignTimelineField(localizedRow, field, cached.text);
            continue;
          }

          translationQueue.push({
            id: `timeline:${localizedRow._id}:${field}`,
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

          const sourceLocale = resolveStoredLocale(localizedRow.fieldLocales?.nachtragItems?.[itemIndex]);

          if (sourceLocale === locale) {
            continue;
          }

          const field = `nachtragItems.${itemIndex}`;
          const sourceHash = await hashText(item);
          const cacheKey = `${localizedRow._id}:${field}`;
          const cached = timelineCacheByKey.get(cacheKey);

          if (cached?.sourceHash === sourceHash) {
            localizedNachtragItems[itemIndex] = cached.text;
            continue;
          }

          translationQueue.push({
            id: `timeline:${localizedRow._id}:${field}`,
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

        localizedRow.media = await Promise.all(
          localizedRow.media.map(async (media: any) => {
            const localizedMedia = { ...media };

            for (const field of MEDIA_FIELDS) {
              const currentValue = localizedMedia[field];

              if (typeof currentValue !== "string" || currentValue.trim().length === 0) {
                continue;
              }

              const sourceLocale = resolveStoredLocale(localizedMedia.fieldLocales?.[field]);
              const shouldTranslateTranscript = field === "transcript";

              if (sourceLocale === locale && !shouldTranslateTranscript) {
                continue;
              }

              const sourceHash = await hashText(currentValue);
              const cacheKey = `${localizedMedia.mediaAssetId}:${field}`;
              const cached = mediaCacheByKey.get(cacheKey);

              if (cached?.sourceHash === sourceHash) {
                const cachedLooksUntranslated =
                  sourceLocale !== null &&
                  sourceLocale !== locale &&
                  cached.text.trim() === currentValue.trim();

                if (cachedLooksUntranslated) {
                  translationQueue.push({
                    id: `media:${localizedMedia.mediaAssetId}:${field}`,
                    text: currentValue,
                    kind: "media",
                    entityId: localizedMedia.mediaAssetId,
                    field,
                    sourceHash,
                  });
                  continue;
                }

                assignMediaField(localizedMedia, field, cached.text);
                continue;
              }

              translationQueue.push({
                id: `media:${localizedMedia.mediaAssetId}:${field}`,
                text: currentValue,
                kind: "media",
                entityId: localizedMedia.mediaAssetId,
                field,
                sourceHash,
              });
            }

            return localizedMedia;
          }),
        );

        return localizedRow;
      }),
    );

    if (translationQueue.length === 0) {
      return {
        locale,
        rows: localizedRows,
      };
    }

    const translations = await translateTextsWithGemini(ctx, {
      organizationId: organization.id,
      targetLocale: locale,
      items: translationQueue.map((entry) => ({ id: entry.id, text: entry.text })),
      userId: user._id,
    });

    for (const row of localizedRows) {
      for (const field of TIMELINE_FIELDS) {
        const id = `timeline:${row._id}:${field}`;
        const translated = translations[id];

        if (translated) {
          assignTimelineField(row, field, translated);
        }
      }

      if (Array.isArray(row.nachtragItems)) {
        row.nachtragItems = row.nachtragItems.map((item: string, itemIndex: number) => {
          const translated = translations[`timeline:${row._id}:nachtragItems.${itemIndex}`];
          return translated ?? item;
        });
      }

      for (const media of row.media) {
        for (const field of MEDIA_FIELDS) {
          const id = `media:${media.mediaAssetId}:${field}`;
          const translated = translations[id];

          if (translated) {
            assignMediaField(media, field, translated);
          }
        }
      }
    }

    for (const entry of translationQueue) {
      const translatedText = translations[entry.id] ?? entry.text;

      if (entry.kind === "timeline") {
        await ctx.runMutation(upsertTimelineTranslationRef, {
          organizationId: organization.id,
          timelineItemId: entry.entityId as Id<"projectTimelineItems">,
          field: entry.field,
          locale,
          sourceHash: entry.sourceHash,
          text: translatedText,
        });
        continue;
      }

      await ctx.runMutation(upsertMediaTranslationRef, {
        organizationId: organization.id,
        mediaAssetId: entry.entityId as Id<"whatsappMediaAssets">,
        field: entry.field,
        locale,
        sourceHash: entry.sourceHash,
        text: translatedText,
      });
    }

    return {
      locale,
      rows: localizedRows,
    };
  },
});

export const timelineLocalizedForOrganizationUser = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const locale = (await ctx.runQuery(getLocaleByUserIdRef, {
      userId: args.userId,
    })) ?? "en";
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

    const timelineItemIds = rows.map((row) => row._id);
    const mediaAssetIds = Array.from(
      new Set(
        rows.flatMap((row) =>
          row.media.map((media: any) => String(media.mediaAssetId)),
        ),
      ),
    ).map((value) => value as Id<"whatsappMediaAssets">);
    const [timelineCache, mediaCache] = await Promise.all([
      ctx.runQuery(getTimelineTranslationsForItemsRef, {
        timelineItemIds,
        locale,
      }),
      ctx.runQuery(getMediaTranslationsForAssetsRef, {
        mediaAssetIds,
        locale,
      }),
    ]);
    const timelineCacheByKey = new Map(
      timelineCache.map((entry) => [`${entry.timelineItemId}:${entry.field}`, entry]),
    );
    const mediaCacheByKey = new Map(
      mediaCache.map((entry) => [`${entry.mediaAssetId}:${entry.field}`, entry]),
    );
    const translationQueue: Array<{
      id: string;
      text: string;
      kind: "timeline" | "media";
      entityId: Id<"projectTimelineItems"> | Id<"whatsappMediaAssets">;
      field: string;
      sourceHash: string;
    }> = [];
    const localizedRows = await Promise.all(
      rows.map(async (row) => {
        const localizedRow = { ...row };

        for (const field of TIMELINE_FIELDS) {
          const currentValue = localizedRow[field];

          if (typeof currentValue !== "string" || currentValue.trim().length === 0) {
            continue;
          }

          const sourceLocale = resolveStoredLocale(localizedRow.fieldLocales?.[field]);
          const shouldTranslateTranscript = field === "transcript";

          if (sourceLocale === locale && !shouldTranslateTranscript) {
            continue;
          }

          const sourceHash = await hashText(currentValue);
          const cacheKey = `${localizedRow._id}:${field}`;
          const cached = timelineCacheByKey.get(cacheKey);

          if (cached?.sourceHash === sourceHash) {
            const cachedLooksUntranslated =
              sourceLocale !== null &&
              sourceLocale !== locale &&
              cached.text.trim() === currentValue.trim();

            if (cachedLooksUntranslated) {
              translationQueue.push({
                id: `timeline:${localizedRow._id}:${field}`,
                text: currentValue,
                kind: "timeline",
                entityId: localizedRow._id,
                field,
                sourceHash,
              });
              continue;
            }

            assignTimelineField(localizedRow, field, cached.text);
            continue;
          }

          translationQueue.push({
            id: `timeline:${localizedRow._id}:${field}`,
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

          const sourceLocale = resolveStoredLocale(localizedRow.fieldLocales?.nachtragItems?.[itemIndex]);

          if (sourceLocale === locale) {
            continue;
          }

          const field = `nachtragItems.${itemIndex}`;
          const sourceHash = await hashText(item);
          const cacheKey = `${localizedRow._id}:${field}`;
          const cached = timelineCacheByKey.get(cacheKey);

          if (cached?.sourceHash === sourceHash) {
            localizedNachtragItems[itemIndex] = cached.text;
            continue;
          }

          translationQueue.push({
            id: `timeline:${localizedRow._id}:${field}`,
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

        localizedRow.media = await Promise.all(
          localizedRow.media.map(async (media: any) => {
            const localizedMedia = { ...media };

            for (const field of MEDIA_FIELDS) {
              const currentValue = localizedMedia[field];

              if (typeof currentValue !== "string" || currentValue.trim().length === 0) {
                continue;
              }

              const sourceLocale = resolveStoredLocale(localizedMedia.fieldLocales?.[field]);
              const shouldTranslateTranscript = field === "transcript";

              if (sourceLocale === locale && !shouldTranslateTranscript) {
                continue;
              }

              const sourceHash = await hashText(currentValue);
              const cacheKey = `${localizedMedia.mediaAssetId}:${field}`;
              const cached = mediaCacheByKey.get(cacheKey);

              if (cached?.sourceHash === sourceHash) {
                const cachedLooksUntranslated =
                  sourceLocale !== null &&
                  sourceLocale !== locale &&
                  cached.text.trim() === currentValue.trim();

                if (cachedLooksUntranslated) {
                  translationQueue.push({
                    id: `media:${localizedMedia.mediaAssetId}:${field}`,
                    text: currentValue,
                    kind: "media",
                    entityId: localizedMedia.mediaAssetId,
                    field,
                    sourceHash,
                  });
                  continue;
                }

                assignMediaField(localizedMedia, field, cached.text);
                continue;
              }

              translationQueue.push({
                id: `media:${localizedMedia.mediaAssetId}:${field}`,
                text: currentValue,
                kind: "media",
                entityId: localizedMedia.mediaAssetId,
                field,
                sourceHash,
              });
            }

            return localizedMedia;
          }),
        );

        return localizedRow;
      }),
    );

    if (translationQueue.length === 0) {
      return {
        locale,
        rows: localizedRows,
      };
    }

    const translations = await translateTextsWithGemini(ctx, {
      organizationId: args.organizationId,
      targetLocale: locale,
      items: translationQueue.map((entry) => ({ id: entry.id, text: entry.text })),
      userId: args.userId,
    });

    for (const row of localizedRows) {
      for (const field of TIMELINE_FIELDS) {
        const id = `timeline:${row._id}:${field}`;
        const translated = translations[id];

        if (translated) {
          assignTimelineField(row, field, translated);
        }
      }

      if (Array.isArray(row.nachtragItems)) {
        row.nachtragItems = row.nachtragItems.map((item: string, itemIndex: number) => {
          const translated = translations[`timeline:${row._id}:nachtragItems.${itemIndex}`];
          return translated ?? item;
        });
      }

      for (const media of row.media) {
        for (const field of MEDIA_FIELDS) {
          const id = `media:${media.mediaAssetId}:${field}`;
          const translated = translations[id];

          if (translated) {
            assignMediaField(media, field, translated);
          }
        }
      }
    }

    for (const entry of translationQueue) {
      const translatedText = translations[entry.id] ?? entry.text;

      if (entry.kind === "timeline") {
        await ctx.runMutation(upsertTimelineTranslationRef, {
          organizationId: args.organizationId,
          timelineItemId: entry.entityId as Id<"projectTimelineItems">,
          field: entry.field,
          locale,
          sourceHash: entry.sourceHash,
          text: translatedText,
        });
        continue;
      }

      await ctx.runMutation(upsertMediaTranslationRef, {
        organizationId: args.organizationId,
        mediaAssetId: entry.entityId as Id<"whatsappMediaAssets">,
        field: entry.field,
        locale,
        sourceHash: entry.sourceHash,
        text: translatedText,
      });
    }

    return {
      locale,
      rows: localizedRows,
    };
  },
});
