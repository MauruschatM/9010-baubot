import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const mediaAssetResponseValidator = v.object({
  mediaAssetId: v.id("whatsappMediaAssets"),
  mimeType: v.string(),
  kind: v.union(v.literal("image"), v.literal("audio"), v.literal("video"), v.literal("file")),
  storageId: v.id("_storage"),
  fileSize: v.optional(v.number()),
  summary: v.optional(v.string()),
});

function dedupeIds<T extends string>(ids: T[]) {
  return Array.from(new Set(ids));
}

function toUtcDayBucket(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export const getBatchImageAttachments = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.id("projects"),
    batchId: v.id("whatsappSendBatches"),
    mediaAssetIds: v.array(v.id("whatsappMediaAssets")),
  },
  returns: v.array(mediaAssetResponseValidator),
  handler: async (ctx, args) => {
    const uniqueIds = dedupeIds(args.mediaAssetIds.map((mediaAssetId) => String(mediaAssetId)));

    if (uniqueIds.length === 0) {
      return [];
    }

    const batchRows = await ctx.db
      .query("projectTimelineItems")
      .withIndex("by_batchId", (queryBuilder) => queryBuilder.eq("batchId", args.batchId))
      .collect();

    const projectBatchRows = batchRows.filter(
      (row) =>
        row.organizationId === args.organizationId &&
        row.projectId === args.projectId,
    );

    if (projectBatchRows.length === 0) {
      throw new ConvexError("Timeline batch not found");
    }

    const results = await Promise.all(
      uniqueIds.map(async (mediaAssetId) => {
        const asset = await ctx.db.get(mediaAssetId as Id<"whatsappMediaAssets">);

        if (!asset || asset.organizationId !== args.organizationId || asset.batchId !== args.batchId) {
          throw new ConvexError("Selected image is no longer available");
        }

        if (asset.kind !== "image") {
          throw new ConvexError("Only images can be attached to the email");
        }

        return {
          mediaAssetId: asset._id,
          mimeType: asset.mimeType,
          kind: asset.kind,
          storageId: asset.storageId,
          fileSize: asset.fileSize,
          summary: asset.summary,
        };
      }),
    );

    return results;
  },
});

export const recordSentTimelineEmail = internalMutation({
  args: {
    organizationId: v.string(),
    projectId: v.id("projects"),
    batchId: v.id("whatsappSendBatches"),
    addedByUserId: v.string(),
    addedByMemberId: v.string(),
    addedByName: v.optional(v.string()),
    recipientEmail: v.string(),
    subject: v.string(),
    body: v.string(),
    mediaAssets: v.array(
      v.object({
        mediaAssetId: v.id("whatsappMediaAssets"),
        mimeType: v.string(),
        kind: v.union(v.literal("image"), v.literal("audio"), v.literal("video"), v.literal("file")),
      }),
    ),
  },
  returns: v.id("projectTimelineItems"),
  handler: async (ctx, args) => {
    const [project, batch] = await Promise.all([
      ctx.db.get(args.projectId),
      ctx.db.get(args.batchId),
    ]);

    if (!project || project.organizationId !== args.organizationId || project.deletedAt !== undefined) {
      throw new ConvexError("Project not found");
    }

    if (!batch || batch.organizationId !== args.organizationId) {
      throw new ConvexError("Timeline batch not found");
    }

    const batchRows = await ctx.db
      .query("projectTimelineItems")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .collect();

    const ownsBatch = batchRows.some(
      (row) => row.organizationId === args.organizationId && row.projectId === args.projectId,
    );
    if (!ownsBatch) {
      throw new ConvexError("Timeline batch not found");
    }

    const now = Date.now();
    const timelineItemId = await ctx.db.insert("projectTimelineItems", {
      organizationId: args.organizationId,
      projectId: args.projectId,
      batchId: args.batchId,
      sourceType: "email_sent",
      addedAt: now,
      dayBucketUtc: toUtcDayBucket(now),
      addedByMemberId: args.addedByMemberId,
      addedByUserId: args.addedByUserId,
      addedByName: args.addedByName,
      emailRecipient: args.recipientEmail.trim(),
      emailSubject: args.subject.trim(),
      emailBody: args.body.trim(),
      mediaAssets: args.mediaAssets,
      createdAt: now,
    });

    const projectPatch: Partial<Doc<"projects">> = {
      lastTimelineActivityAt: now,
      updatedAt: now,
    };
    await ctx.db.patch(args.projectId, projectPatch);

    return timelineItemId;
  },
});
