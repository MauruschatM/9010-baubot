import { ConvexError, v } from "convex/values";
import type { FunctionReference } from "convex/server";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, type QueryCtx } from "./_generated/server";
import { requireActiveOrganization } from "./authhelpers";
import { projectStatusValidator, resolveProjectStatus } from "./projectStatus";

const exportModeValidator = v.union(v.literal("customers"), v.literal("projects"));

const exportMessageValidator = v.object({
  timelineItemId: v.id("projectTimelineItems"),
  messageId: v.optional(v.id("whatsappMessages")),
  addedAt: v.number(),
  addedByName: v.optional(v.string()),
  sourceText: v.optional(v.string()),
  transcript: v.optional(v.string()),
  extractedText: v.optional(v.string()),
  summary: v.optional(v.string()),
});

const exportMediaValidator = v.object({
  mediaAssetId: v.id("whatsappMediaAssets"),
  messageId: v.optional(v.id("whatsappMessages")),
  addedAt: v.number(),
  sourceIndex: v.number(),
  mimeType: v.string(),
  kind: v.union(
    v.literal("image"),
    v.literal("audio"),
    v.literal("video"),
    v.literal("file"),
  ),
  downloadUrl: v.optional(v.string()),
  originalFileName: v.optional(v.string()),
  summary: v.optional(v.string()),
  transcript: v.optional(v.string()),
  extractedText: v.optional(v.string()),
});

const exportBatchValidator = v.object({
  batchId: v.id("whatsappSendBatches"),
  timestamp: v.number(),
  title: v.string(),
  overview: v.optional(v.string()),
  summary: v.optional(v.string()),
  hasNachtrag: v.boolean(),
  nachtragDetails: v.optional(v.string()),
  nachtragItems: v.array(v.string()),
  messages: v.array(exportMessageValidator),
  media: v.array(exportMediaValidator),
});

const exportProjectValidator = v.object({
  projectId: v.id("projects"),
  customerId: v.optional(v.id("customers")),
  customerName: v.optional(v.string()),
  name: v.string(),
  location: v.optional(v.string()),
  status: projectStatusValidator,
  batches: v.array(exportBatchValidator),
});

const exportRootValidator = v.object({
  kind: v.union(v.literal("customer"), v.literal("project")),
  customerId: v.optional(v.id("customers")),
  projectId: v.optional(v.id("projects")),
  name: v.string(),
  projects: v.array(exportProjectValidator),
});

const exportManifestDataValidator = v.object({
  roots: v.array(exportRootValidator),
});

const exportManifestValidator = v.object({
  generatedAt: v.number(),
  roots: v.array(exportRootValidator),
});

type ExportBatchAccumulator = {
  batchId: Id<"whatsappSendBatches">;
  latestAddedAt: number;
  summaryAddedAt?: number;
  title?: string;
  overview?: string;
  summary?: string;
  hasNachtrag: boolean;
  nachtragDetails?: string;
  nachtragItems: string[];
  messages: Array<{
    timelineItemId: Id<"projectTimelineItems">;
    messageId?: Id<"whatsappMessages">;
    addedAt: number;
    addedByName?: string;
    sourceText?: string;
    transcript?: string;
    extractedText?: string;
    summary?: string;
  }>;
  mediaById: Map<
    string,
    {
      mediaAssetId: Id<"whatsappMediaAssets">;
      messageId?: Id<"whatsappMessages">;
      addedAt: number;
      sourceIndex: number;
      mimeType: string;
      kind: "image" | "audio" | "video" | "file";
      downloadUrl?: string;
      originalFileName?: string;
      summary?: string;
      transcript?: string;
      extractedText?: string;
    }
  >;
};

type ExportMessageDoc = Doc<"whatsappMessages">;
type ExportMessage = {
  timelineItemId: Id<"projectTimelineItems">;
  messageId?: Id<"whatsappMessages">;
  addedAt: number;
  addedByName?: string;
  sourceText?: string;
  transcript?: string;
  extractedText?: string;
  summary?: string;
};
type ExportMedia = {
  mediaAssetId: Id<"whatsappMediaAssets">;
  messageId?: Id<"whatsappMessages">;
  addedAt: number;
  sourceIndex: number;
  mimeType: string;
  kind: "image" | "audio" | "video" | "file";
  downloadUrl?: string;
  originalFileName?: string;
  summary?: string;
  transcript?: string;
  extractedText?: string;
};
type ExportBatch = {
  batchId: Id<"whatsappSendBatches">;
  timestamp: number;
  title: string;
  overview?: string;
  summary?: string;
  hasNachtrag: boolean;
  nachtragDetails?: string;
  nachtragItems: string[];
  messages: ExportMessage[];
  media: ExportMedia[];
};
type ExportProject = {
  projectId: Id<"projects">;
  customerId?: Id<"customers">;
  customerName?: string;
  name: string;
  location?: string;
  status: "active" | "done";
  batches: ExportBatch[];
};
type ExportRoot = {
  kind: "customer" | "project";
  customerId?: Id<"customers">;
  projectId?: Id<"projects">;
  name: string;
  projects: ExportProject[];
};
type ExportManifestData = {
  roots: ExportRoot[];
};
type ExportManifest = {
  generatedAt: number;
  roots: ExportRoot[];
};
type PrepareZipManifestArgs = {
  mode: "customers" | "projects";
  customerIds?: Id<"customers">[];
  projectIds?: Id<"projects">[];
};

function dedupeIds<T>(values: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function trimToUndefined(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function trimArray(values: string[] | undefined) {
  return (
    values
      ?.map((value) => value.trim())
      .filter((value) => value.length > 0) ?? []
  );
}

function extractFileNameFromUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const candidate = new URL(value).pathname.split("/").pop()?.trim();
    return candidate ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function resolveOriginalFileName(
  message: ExportMessageDoc | undefined,
  sourceIndex: number,
  sourceMediaUrl: string,
) {
  const mediaEntry = message?.media[sourceIndex];

  return (
    trimToUndefined(mediaEntry?.fileName) ??
    extractFileNameFromUrl(mediaEntry?.mediaUrl) ??
    extractFileNameFromUrl(sourceMediaUrl)
  );
}

async function getCustomerDoc(
  ctx: QueryCtx,
  organizationId: string,
  customerId: Id<"customers">,
) {
  const customer = await ctx.db.get(customerId);

  if (!customer || customer.organizationId !== organizationId || customer.deletedAt !== undefined) {
    return null;
  }

  return customer;
}

async function getProjectDoc(
  ctx: QueryCtx,
  organizationId: string,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);

  if (!project || project.organizationId !== organizationId || project.deletedAt !== undefined) {
    return null;
  }

  return project;
}

async function buildMessageMap(
  ctx: QueryCtx,
  organizationId: string,
  messageIds: Array<Id<"whatsappMessages">>,
) {
  const entries = await Promise.all(
    dedupeIds(messageIds).map(async (messageId) => {
      const message = await ctx.db.get(messageId);

      if (!message) {
        return [String(messageId), undefined] as const;
      }

      if (message.organizationId && message.organizationId !== organizationId) {
        return [String(messageId), undefined] as const;
      }

      return [String(messageId), message] as const;
    }),
  );

  return new Map(entries);
}

async function buildMediaMap(
  ctx: QueryCtx,
  organizationId: string,
  mediaAssetIds: Array<Id<"whatsappMediaAssets">>,
) {
  const entries = await Promise.all(
    dedupeIds(mediaAssetIds).map(async (mediaAssetId) => {
      const mediaAsset = await ctx.db.get(mediaAssetId);

      if (!mediaAsset || mediaAsset.organizationId !== organizationId) {
        return [String(mediaAssetId), undefined] as const;
      }

      const downloadUrl = (await ctx.storage.getUrl(mediaAsset.storageId)) ?? undefined;

      return [
        String(mediaAssetId),
        {
          mediaAsset,
          downloadUrl,
        },
      ] as const;
    }),
  );

  return new Map(entries);
}

function createBatchAccumulator(batchId: Id<"whatsappSendBatches">, addedAt: number): ExportBatchAccumulator {
  return {
    batchId,
    latestAddedAt: addedAt,
    hasNachtrag: false,
    nachtragItems: [],
    messages: [],
    mediaById: new Map(),
  };
}

async function buildProjectExport(
  ctx: QueryCtx,
  organizationId: string,
  project: Doc<"projects">,
  customer: Doc<"customers"> | null,
): Promise<ExportProject> {
  const timelineRows = await ctx.db
    .query("projectTimelineItems")
    .withIndex("by_project_addedAt", (q) => q.eq("projectId", project._id))
    .order("asc")
    .collect();

  const messageIds = timelineRows
    .map((row) => row.messageId)
    .filter((messageId): messageId is Id<"whatsappMessages"> => messageId !== undefined);
  const mediaAssetIds = timelineRows.flatMap((row) =>
    (row.mediaAssets ?? []).map((entry) => entry.mediaAssetId),
  );

  const [messageById, mediaById] = await Promise.all([
    buildMessageMap(ctx, organizationId, messageIds),
    buildMediaMap(ctx, organizationId, mediaAssetIds),
  ]);

  const batchById = new Map<string, ExportBatchAccumulator>();

  for (const row of timelineRows) {
    const batchKey = String(row.batchId);
    const batch = batchById.get(batchKey) ?? createBatchAccumulator(row.batchId, row.addedAt);
    batch.latestAddedAt = Math.max(batch.latestAddedAt, row.addedAt);

    if (row.sourceType === "whatsapp_batch_summary") {
      batch.summaryAddedAt = row.addedAt;
      batch.title = trimToUndefined(row.batchTitle) ?? "Project update";
      batch.overview = trimToUndefined(row.batchOverview);
      batch.summary = trimToUndefined(row.summary);
      batch.hasNachtrag = Boolean(row.hasNachtrag);
      batch.nachtragDetails = trimToUndefined(row.nachtragDetails);
      batch.nachtragItems = trimArray(row.nachtragItems);
    } else {
      batch.messages.push({
        timelineItemId: row._id,
        messageId: row.messageId,
        addedAt: row.addedAt,
        addedByName: trimToUndefined(row.addedByName),
        sourceText: trimToUndefined(row.sourceText),
        transcript: trimToUndefined(row.transcript),
        extractedText: trimToUndefined(row.extractedText),
        summary: trimToUndefined(row.summary),
      });

      for (const mediaRef of row.mediaAssets ?? []) {
        const mediaKey = String(mediaRef.mediaAssetId);
        if (batch.mediaById.has(mediaKey)) {
          continue;
        }

        const mediaEntry = mediaById.get(mediaKey);
        const message = row.messageId ? messageById.get(String(row.messageId)) : undefined;
        const mediaAsset = mediaEntry?.mediaAsset;

        batch.mediaById.set(mediaKey, {
          mediaAssetId: mediaRef.mediaAssetId,
          messageId: row.messageId,
          addedAt: row.addedAt,
          sourceIndex: mediaAsset?.sourceIndex ?? 0,
          mimeType: mediaAsset?.mimeType ?? mediaRef.mimeType,
          kind: mediaAsset?.kind ?? mediaRef.kind,
          downloadUrl: mediaEntry?.downloadUrl,
          originalFileName:
            mediaAsset !== undefined
              ? resolveOriginalFileName(message, mediaAsset.sourceIndex, mediaAsset.sourceMediaUrl)
              : undefined,
          summary: trimToUndefined(mediaAsset?.summary),
          transcript: trimToUndefined(mediaAsset?.transcript),
          extractedText: trimToUndefined(mediaAsset?.extractedText),
        });
      }
    }

    batchById.set(batchKey, batch);
  }

  const batches = Array.from(batchById.values())
    .map((batch) => ({
      batchId: batch.batchId,
      timestamp: batch.summaryAddedAt ?? batch.latestAddedAt,
      title: batch.title ?? "Project update",
      overview: batch.overview,
      summary: batch.summary,
      hasNachtrag: batch.hasNachtrag,
      nachtragDetails: batch.nachtragDetails,
      nachtragItems: batch.nachtragItems,
      messages: batch.messages,
      media: Array.from(batch.mediaById.values()).sort((left, right) => {
        if (left.addedAt !== right.addedAt) {
          return left.addedAt - right.addedAt;
        }

        return left.sourceIndex - right.sourceIndex;
      }),
    }))
    .sort((left, right) => left.timestamp - right.timestamp);

  return {
    projectId: project._id,
    customerId: customer?._id,
    customerName: trimToUndefined(customer?.name),
    name: project.name,
    location: trimToUndefined(project.location),
    status: resolveProjectStatus(project.status),
    batches,
  };
}

async function buildCustomerRoots(
  ctx: QueryCtx,
  organizationId: string,
  customerIds: Array<Id<"customers">>,
): Promise<ExportRoot[]> {
  const roots: ExportRoot[] = [];

  for (const customerId of dedupeIds(customerIds)) {
    const customer = await getCustomerDoc(ctx, organizationId, customerId);
    if (!customer) {
      continue;
    }

    const linkedProjects = await ctx.db
      .query("projects")
      .withIndex("by_customerId_updatedAt", (q) => q.eq("customerId", customer._id))
      .order("desc")
      .collect();

    const visibleProjects = linkedProjects.filter(
      (project) => project.organizationId === organizationId && project.deletedAt === undefined,
    );
    const projectExports = await Promise.all(
      visibleProjects
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((project) => buildProjectExport(ctx, organizationId, project, customer)),
    );

    roots.push({
      kind: "customer" as const,
      customerId: customer._id,
      projectId: undefined,
      name: customer.name,
      projects: projectExports,
    });
  }

  return roots;
}

async function buildProjectRoots(
  ctx: QueryCtx,
  organizationId: string,
  projectIds: Array<Id<"projects">>,
): Promise<ExportRoot[]> {
  const roots: ExportRoot[] = [];

  for (const projectId of dedupeIds(projectIds)) {
    const project = await getProjectDoc(ctx, organizationId, projectId);
    if (!project) {
      continue;
    }

    const customer =
      project.customerId !== undefined
        ? await getCustomerDoc(ctx, organizationId, project.customerId)
        : null;
    const projectExport = await buildProjectExport(ctx, organizationId, project, customer);

    roots.push({
      kind: "project" as const,
      customerId: undefined,
      projectId: project._id,
      name: project.name,
      projects: [projectExport],
    });
  }

  return roots;
}

export const prepareZipManifestData = internalQuery({
  args: {
    mode: exportModeValidator,
    customerIds: v.optional(v.array(v.id("customers"))),
    projectIds: v.optional(v.array(v.id("projects"))),
  },
  returns: exportManifestDataValidator,
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);

    if (args.mode === "customers") {
      if ((args.customerIds?.length ?? 0) === 0) {
        return { roots: [] };
      }

      return {
        roots: await buildCustomerRoots(ctx, organization.id, args.customerIds ?? []),
      };
    }

    if ((args.projectIds?.length ?? 0) === 0) {
      return { roots: [] };
    }

    return {
      roots: await buildProjectRoots(ctx, organization.id, args.projectIds ?? []),
    };
  },
});

const prepareZipManifestDataRef =
  internal.exports.prepareZipManifestData as FunctionReference<
    "query",
    "internal",
    PrepareZipManifestArgs,
    ExportManifestData
  >;

export const prepareZipManifest = action({
  args: {
    mode: exportModeValidator,
    customerIds: v.optional(v.array(v.id("customers"))),
    projectIds: v.optional(v.array(v.id("projects"))),
  },
  returns: exportManifestValidator,
  handler: async (ctx, args): Promise<ExportManifest> => {
    const hasCustomerSelection = (args.customerIds?.length ?? 0) > 0;
    const hasProjectSelection = (args.projectIds?.length ?? 0) > 0;

    if (args.mode === "customers" && !hasCustomerSelection) {
      throw new ConvexError("Select at least one customer to export.");
    }

    if (args.mode === "projects" && !hasProjectSelection) {
      throw new ConvexError("Select at least one project to export.");
    }

    if (args.mode === "customers" && hasProjectSelection) {
      throw new ConvexError("Project selections are not valid for customer exports.");
    }

    if (args.mode === "projects" && hasCustomerSelection) {
      throw new ConvexError("Customer selections are not valid for project exports.");
    }

    const { roots } = await ctx.runQuery(prepareZipManifestDataRef, args);

    return {
      generatedAt: Date.now(),
      roots,
    };
  },
});
