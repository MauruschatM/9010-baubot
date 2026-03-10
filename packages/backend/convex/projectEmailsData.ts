import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

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
