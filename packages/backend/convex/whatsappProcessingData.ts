import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { vAppLocale } from "./lib/locales";
import {
  PROJECT_STATUS_ACTIVE,
  resolveProjectStatus,
} from "./projectStatus";

const PROJECT_NAME_MIN_LENGTH = 2;
const PROJECT_NAME_MAX_LENGTH = 120;

const sendBatchStatusValidator = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("awaiting_project_choice"),
  v.literal("awaiting_project_name"),
  v.literal("completed"),
  v.literal("failed"),
);

const pendingResolutionStateValidator = v.union(
  v.literal("awaiting_choice"),
  v.literal("awaiting_project_name"),
);

const timelineFieldLocalesValidator = v.object({
  sourceText: v.optional(v.string()),
  text: v.optional(v.string()),
  transcript: v.optional(v.string()),
  extractedText: v.optional(v.string()),
  summary: v.optional(v.string()),
  batchTitle: v.optional(v.string()),
  batchOverview: v.optional(v.string()),
  nachtragDetails: v.optional(v.string()),
  nachtragItems: v.optional(v.array(v.string())),
});

const mediaFieldLocalesValidator = v.object({
  transcript: v.optional(v.string()),
  extractedText: v.optional(v.string()),
  summary: v.optional(v.string()),
});

function toUtcDayBucket(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeProjectName(value: string) {
  const normalized = value.trim();

  if (normalized.length < PROJECT_NAME_MIN_LENGTH) {
    return null;
  }

  if (normalized.length > PROJECT_NAME_MAX_LENGTH) {
    return null;
  }

  return normalized;
}

export const getBatchForProcessing = internalQuery({
  args: {
    batchId: v.id("whatsappSendBatches"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);

    if (!batch) {
      return null;
    }

    const [messages, projects, customers, mediaAssets] = await Promise.all([
      Promise.all(batch.messageIds.map((messageId) => ctx.db.get(messageId))),
      ctx.db
        .query("projects")
        .withIndex("by_organization_deletedAt_updatedAt", (q) =>
          q.eq("organizationId", batch.organizationId).eq("deletedAt", undefined),
        )
        .collect(),
      ctx.db
        .query("customers")
        .withIndex("by_organization_deletedAt_updatedAt", (q) =>
          q.eq("organizationId", batch.organizationId).eq("deletedAt", undefined),
        )
        .collect(),
      ctx.db
        .query("whatsappMediaAssets")
        .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
        .collect(),
    ]);

    return {
      batch,
      messages: messages
        .filter((message): message is Doc<"whatsappMessages"> => !!message)
        .sort((left, right) => left.createdAt - right.createdAt),
      projects: projects.filter(
        (project) => resolveProjectStatus(project.status) === PROJECT_STATUS_ACTIVE,
      ),
      customers,
      mediaAssets,
    };
  },
});

export const getActiveRoutingEntities = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const [projects, customers] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_organization_deletedAt_updatedAt", (q) =>
          q.eq("organizationId", args.organizationId).eq("deletedAt", undefined),
        )
        .collect(),
      ctx.db
        .query("customers")
        .withIndex("by_organization_deletedAt_updatedAt", (q) =>
          q.eq("organizationId", args.organizationId).eq("deletedAt", undefined),
        )
        .collect(),
    ]);

    return {
      projects: projects.filter(
        (project) => resolveProjectStatus(project.status) === PROJECT_STATUS_ACTIVE,
      ),
      customers,
    };
  },
});

export const createMediaAsset = internalMutation({
  args: {
    batchId: v.id("whatsappSendBatches"),
    organizationId: v.string(),
    messageId: v.id("whatsappMessages"),
    sourceMediaUrl: v.string(),
    sourceIndex: v.number(),
    mimeType: v.string(),
    kind: v.union(
      v.literal("image"),
      v.literal("audio"),
      v.literal("video"),
      v.literal("file"),
    ),
    storageId: v.id("_storage"),
    fileSize: v.optional(v.number()),
    transcript: v.optional(v.string()),
    extractedText: v.optional(v.string()),
    summary: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    fieldLocales: v.optional(mediaFieldLocalesValidator),
    processingStatus: v.optional(
      v.union(v.literal("pending"), v.literal("processed"), v.literal("failed")),
    ),
    processingError: v.optional(v.string()),
  },
  returns: v.id("whatsappMediaAssets"),
  handler: async (ctx, args) => {
    const existingAssets = await ctx.db
      .query("whatsappMediaAssets")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .collect();
    const existingAsset = existingAssets.find(
      (asset) => asset.batchId === args.batchId && asset.sourceIndex === args.sourceIndex,
    );

    if (existingAsset) {
      return existingAsset._id;
    }

    return await ctx.db.insert("whatsappMediaAssets", {
      batchId: args.batchId,
      organizationId: args.organizationId,
      messageId: args.messageId,
      sourceProvider: "twilio",
      sourceMediaUrl: args.sourceMediaUrl,
      sourceIndex: args.sourceIndex,
      mimeType: args.mimeType,
      kind: args.kind,
      storageId: args.storageId,
      fileSize: args.fileSize,
      transcript: args.transcript,
      extractedText: args.extractedText,
      summary: args.summary,
      keywords: args.keywords,
      fieldLocales: args.fieldLocales,
      processingStatus: args.processingStatus ?? "processed",
      processingError: args.processingError,
      addedAt: Date.now(),
    });
  },
});

export const updateSendBatch = internalMutation({
  args: {
    batchId: v.id("whatsappSendBatches"),
    status: v.optional(sendBatchStatusValidator),
    error: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    projectMatchConfidence: v.optional(v.number()),
    projectMatchReason: v.optional(v.string()),
    candidateProjectIds: v.optional(v.array(v.id("projects"))),
    summary: v.optional(v.string()),
    nachtragEmailSentAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Partial<Doc<"whatsappSendBatches">> & { updatedAt: number } = {
      updatedAt: Date.now(),
    };

    if (args.status !== undefined) {
      patch.status = args.status;
    }

    if (args.error !== undefined) {
      patch.error = args.error;
    }

    if (args.projectId !== undefined) {
      patch.projectId = args.projectId;
    }

    if (args.projectMatchConfidence !== undefined) {
      patch.projectMatchConfidence = args.projectMatchConfidence;
    }

    if (args.projectMatchReason !== undefined) {
      patch.projectMatchReason = args.projectMatchReason;
    }

    if (args.candidateProjectIds !== undefined) {
      patch.candidateProjectIds = args.candidateProjectIds;
    }

    if (args.summary !== undefined) {
      patch.summary = args.summary;
    }

    if (args.nachtragEmailSentAt !== undefined) {
      patch.nachtragEmailSentAt = args.nachtragEmailSentAt;
    }

    if (args.startedAt !== undefined) {
      patch.startedAt = args.startedAt;
    }

    if (args.completedAt !== undefined) {
      patch.completedAt = args.completedAt;
    }

    await ctx.db.patch(args.batchId, patch);
    return null;
  },
});

export const createSendBatchFromBuffer = internalMutation({
  args: {
    connectionId: v.id("whatsappConnections"),
    organizationId: v.string(),
    memberId: v.string(),
    userId: v.string(),
    phoneE164: v.string(),
    commandMessageSid: v.string(),
    commandFrom: v.string(),
    commandTo: v.optional(v.string()),
  },
  returns: v.object({
    batchId: v.optional(v.id("whatsappSendBatches")),
    messageCount: v.number(),
    status: v.union(v.literal("queued"), v.literal("empty"), v.literal("busy")),
  }),
  handler: async (ctx, args) => {
    const activeStatuses = [
      "queued",
      "processing",
      "awaiting_project_choice",
      "awaiting_project_name",
    ] as const;

    for (const status of activeStatuses) {
      const activeBatch = await ctx.db
        .query("whatsappSendBatches")
        .withIndex("by_org_phone_status_createdAt", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("phoneE164", args.phoneE164)
            .eq("status", status),
        )
        .order("desc")
        .first();

      if (activeBatch) {
        return {
          batchId: activeBatch._id,
          messageCount: activeBatch.messageCount,
          status: "busy" as const,
        };
      }
    }

    const buffers = await ctx.db
      .query("whatsappTurnBuffers")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .collect();

    const bufferedMessageIds = Array.from(
      new Set(buffers.flatMap((buffer) => buffer.bufferedMessageIds.map((messageId) => String(messageId)))),
    ) as Array<string>;

    if (bufferedMessageIds.length === 0) {
      return {
        messageCount: 0,
        status: "empty" as const,
      };
    }

    const bufferedMessages = (
      await Promise.all(
        bufferedMessageIds.map((messageId) => ctx.db.get(messageId as Id<"whatsappMessages">)),
      )
    )
      .filter((message): message is Doc<"whatsappMessages"> => !!message)
      .filter(
        (message) =>
          message.organizationId === args.organizationId &&
          message.memberId === args.memberId &&
          message.userId === args.userId,
      )
      .sort((left, right) => left.createdAt - right.createdAt);

    if (bufferedMessages.length === 0) {
      for (const buffer of buffers) {
        if (buffer.documentationReminderJobId) {
          try {
            await ctx.scheduler.cancel(buffer.documentationReminderJobId);
          } catch {
            // Ignore reminder jobs that have already started or completed.
          }
        }

        await ctx.db.delete(buffer._id);
      }

      return {
        messageCount: 0,
        status: "empty" as const,
      };
    }

    const now = Date.now();
    const messageIds = bufferedMessages.map((message) => message._id);
    const batchId = await ctx.db.insert("whatsappSendBatches", {
      organizationId: args.organizationId,
      memberId: args.memberId,
      userId: args.userId,
      phoneE164: args.phoneE164,
      commandMessageSid: args.commandMessageSid,
      commandFrom: args.commandFrom,
      commandTo: args.commandTo,
      status: "queued",
      messageIds,
      messageCount: messageIds.length,
      createdAt: now,
      updatedAt: now,
    });

    await Promise.all(
      bufferedMessages.map((message) =>
        ctx.db.patch(message._id, {
          turnStatus: "ignored",
          documentationStatus: "batched",
          detectedIntent: "documentation",
          documentationBatchId: batchId,
        }),
      ),
    );

    await Promise.all(
      buffers.map(async (buffer) => {
        if (buffer.documentationReminderJobId) {
          try {
            await ctx.scheduler.cancel(buffer.documentationReminderJobId);
          } catch {
            // Ignore reminder jobs that have already started or completed.
          }
        }

        await ctx.db.delete(buffer._id);
      }),
    );

    await ctx.scheduler.runAfter(0, (internal as any).whatsappProcessing.processSendBatch, {
      batchId,
    });

    return {
      batchId,
      messageCount: messageIds.length,
      status: "queued" as const,
    };
  },
});

export const getPendingResolutionByPhone = internalQuery({
  args: {
    organizationId: v.string(),
    phoneE164: v.string(),
  },
  handler: async (ctx, args) => {
    const awaitingChoice = await ctx.db
      .query("whatsappPendingResolutions")
      .withIndex("by_org_phone_state", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("phoneE164", args.phoneE164)
          .eq("state", "awaiting_choice"),
      )
      .order("desc")
      .first();

    if (awaitingChoice) {
      return awaitingChoice;
    }

    return await ctx.db
      .query("whatsappPendingResolutions")
      .withIndex("by_org_phone_state", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("phoneE164", args.phoneE164)
          .eq("state", "awaiting_project_name"),
      )
      .order("desc")
      .first();
  },
});

export const getSendBatchById = internalQuery({
  args: {
    batchId: v.id("whatsappSendBatches"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.batchId);
  },
});

export const upsertPendingResolution = internalMutation({
  args: {
    organizationId: v.string(),
    phoneE164: v.string(),
    memberId: v.string(),
    batchId: v.id("whatsappSendBatches"),
    state: pendingResolutionStateValidator,
    customerId: v.optional(v.id("customers")),
    options: v.optional(
      v.array(
        v.object({
          projectId: v.id("projects"),
          projectName: v.string(),
        }),
      ),
    ),
    aiSuggestedProjectName: v.optional(v.string()),
  },
  returns: v.id("whatsappPendingResolutions"),
  handler: async (ctx, args) => {
    const existingResolution = await ctx.db
      .query("whatsappPendingResolutions")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .first();
    const now = Date.now();

    if (existingResolution) {
      await ctx.db.patch(existingResolution._id, {
        state: args.state,
        customerId: args.customerId,
        options: args.options,
        aiSuggestedProjectName: args.aiSuggestedProjectName,
        updatedAt: now,
      });
      return existingResolution._id;
    }

    return await ctx.db.insert("whatsappPendingResolutions", {
      organizationId: args.organizationId,
      phoneE164: args.phoneE164,
      memberId: args.memberId,
      batchId: args.batchId,
      state: args.state,
      customerId: args.customerId,
      options: args.options,
      aiSuggestedProjectName: args.aiSuggestedProjectName,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const clearPendingResolutionByBatch = internalMutation({
  args: {
    batchId: v.id("whatsappSendBatches"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const resolutions = await ctx.db
      .query("whatsappPendingResolutions")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .collect();

    for (const resolution of resolutions) {
      await ctx.db.delete(resolution._id);
    }

    return null;
  },
});

export const finalizeBatchPersistence = internalMutation({
  args: {
    batchId: v.id("whatsappSendBatches"),
    projectId: v.id("projects"),
    batchTitle: v.string(),
    summary: v.string(),
    batchOverview: v.string(),
    hasNachtrag: v.optional(v.boolean()),
    nachtragNeedsClarification: v.optional(v.boolean()),
    nachtragItems: v.optional(v.array(v.string())),
    nachtragDetails: v.optional(v.string()),
    nachtragLanguage: v.optional(vAppLocale),
    summaryFieldLocales: v.optional(timelineFieldLocalesValidator),
    summaryAddedAt: v.number(),
    addedByMemberId: v.string(),
    addedByUserId: v.string(),
    addedByName: v.optional(v.string()),
    items: v.array(
      v.object({
        messageId: v.id("whatsappMessages"),
        addedAt: v.number(),
        sourceText: v.optional(v.string()),
        text: v.optional(v.string()),
        transcript: v.optional(v.string()),
        extractedText: v.optional(v.string()),
        summary: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
        fieldLocales: v.optional(timelineFieldLocalesValidator),
        mediaAssets: v.array(
          v.object({
            mediaAssetId: v.id("whatsappMediaAssets"),
            mimeType: v.string(),
            kind: v.union(
              v.literal("image"),
              v.literal("audio"),
              v.literal("video"),
              v.literal("file"),
            ),
          }),
        ),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingTimelineItem = await ctx.db
      .query("projectTimelineItems")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .first();
    const batch = await ctx.db.get(args.batchId);

    if (!batch) {
      throw new ConvexError("Batch not found.");
    }

    const project = await ctx.db.get(args.projectId);

    if (!project) {
      throw new ConvexError("Project not found.");
    }

    if (project.organizationId !== batch.organizationId) {
      throw new ConvexError("Unauthorized");
    }

    if (project.deletedAt !== undefined) {
      throw new ConvexError("Project not found.");
    }

    if (resolveProjectStatus(project.status) !== PROJECT_STATUS_ACTIVE) {
      throw new ConvexError("Timeline updates are only allowed for active projects.");
    }

    if (!existingTimelineItem) {
      const now = Date.now();

      for (const item of args.items) {
        await ctx.db.insert("projectTimelineItems", {
          organizationId: batch.organizationId,
          projectId: args.projectId,
          batchId: args.batchId,
          sourceType: "whatsapp_message",
          messageId: item.messageId,
          addedAt: item.addedAt,
          dayBucketUtc: toUtcDayBucket(item.addedAt),
          addedByMemberId: args.addedByMemberId,
          addedByUserId: args.addedByUserId,
          addedByName: args.addedByName,
          sourceText: item.sourceText,
          text: item.text,
          transcript: item.transcript,
          extractedText: item.extractedText,
          summary: item.summary,
          keywords: item.keywords,
          fieldLocales: item.fieldLocales,
          mediaAssets: item.mediaAssets,
          createdAt: now,
        });

        for (const media of item.mediaAssets) {
          await ctx.db.patch(media.mediaAssetId, {
            projectId: args.projectId,
          });
        }
      }

      await ctx.db.insert("projectTimelineItems", {
        organizationId: batch.organizationId,
        projectId: args.projectId,
        batchId: args.batchId,
        sourceType: "whatsapp_batch_summary",
        addedAt: args.summaryAddedAt,
        dayBucketUtc: toUtcDayBucket(args.summaryAddedAt),
        addedByMemberId: args.addedByMemberId,
        addedByUserId: args.addedByUserId,
        addedByName: args.addedByName,
        summary: args.summary,
        batchTitle: args.batchTitle,
        batchOverview: args.batchOverview,
        hasNachtrag: args.hasNachtrag,
        nachtragNeedsClarification: args.nachtragNeedsClarification,
        nachtragItems: args.nachtragItems,
        nachtragDetails: args.nachtragDetails,
        nachtragLanguage: args.nachtragLanguage,
        fieldLocales: args.summaryFieldLocales,
        createdAt: now,
      });

      const projectPatch: Partial<Doc<"projects">> = {
        lastTimelineActivityAt: now,
        updatedAt: now,
      };

      if (args.hasNachtrag) {
        projectPatch.lastNachtragAt = Math.max(project.lastNachtragAt ?? 0, args.summaryAddedAt);
      }

      await ctx.db.patch(args.projectId, projectPatch);
    }

    const pendingResolutions = await ctx.db
      .query("whatsappPendingResolutions")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .collect();

    for (const pendingResolution of pendingResolutions) {
      await ctx.db.delete(pendingResolution._id);
    }

    await ctx.db.patch(args.batchId, {
      status: "completed",
      projectId: args.projectId,
      summary: args.summary,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const createProjectForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    createdBy: v.string(),
    name: v.string(),
    customerId: v.optional(v.id("customers")),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const projectName = normalizeProjectName(args.name);

    if (!projectName) {
      throw new ConvexError(
        `Project name must be between ${PROJECT_NAME_MIN_LENGTH} and ${PROJECT_NAME_MAX_LENGTH} characters.`,
      );
    }

    const now = Date.now();
    return await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      createdBy: args.createdBy,
      customerId: args.customerId,
      name: projectName,
      status: PROJECT_STATUS_ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
  },
});
