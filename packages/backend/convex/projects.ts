import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireActiveOrganization, requireAuthUserId } from "./authhelpers";
import {
  customerResponseValidator,
  toCustomerResponse,
} from "./customerFields";
import { normalizeAppLocale, vAppLocale } from "./lib/locales";
import {
  normalizeProjectLocationInput,
  normalizeOptionalProjectLocationInput,
  requireProjectLocation,
  readProjectLocation,
} from "./projectFields";
import {
  PROJECT_STATUS_ACTIVE,
  projectStatusValidator,
  resolveProjectStatus,
} from "./projectStatus";

const MAX_TIMELINE_ITEMS = 500;
const LEGACY_PROJECT_BACKFILL_BATCH_SIZE = 100;

const timelineMediaKindValidator = v.union(
  v.literal("image"),
  v.literal("audio"),
  v.literal("video"),
  v.literal("file"),
);

const timelineMediaValidator = v.object({
  mediaAssetId: v.id("whatsappMediaAssets"),
  mimeType: v.string(),
  kind: timelineMediaKindValidator,
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
});

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

const projectResponseFields = {
  _id: v.id("projects"),
  _creationTime: v.number(),
  organizationId: v.string(),
  createdBy: v.string(),
  customerId: v.optional(v.id("customers")),
  location: v.string(),
  status: projectStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  customer: v.optional(customerResponseValidator),
};

const projectListItemValidator = v.object({
  ...projectResponseFields,
  hasUnreviewedChanges: v.boolean(),
  hasNachtrag: v.boolean(),
  hasUnseenNachtrag: v.boolean(),
});

const archivedProjectListItemValidator = v.object({
  ...projectResponseFields,
  deletedAt: v.number(),
});

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
};

type LegacyProjectDoc = Doc<"projects"> & {
  name?: string;
};

function resolveProjectLocation(project: Doc<"projects">) {
  return requireProjectLocation(project as LegacyProjectDoc);
}

function toProjectResponse(
  project: Doc<"projects">,
  customer?: ReturnType<typeof toCustomerResponse>,
) {
  return {
    _id: project._id,
    _creationTime: project._creationTime,
    organizationId: project.organizationId,
    createdBy: project.createdBy,
    customerId: project.customerId,
    location: resolveProjectLocation(project),
    status: resolveProjectStatus(project.status),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    customer,
  };
}

function toArchivedProjectResponse(
  project: Doc<"projects">,
  customer?: ReturnType<typeof toCustomerResponse>,
) {
  return {
    ...toProjectResponse(project, customer),
    deletedAt: project.deletedAt ?? project.updatedAt,
  };
}

function ensureProjectBelongsToOrganization(
  project: Doc<"projects"> | null,
  organizationId: string,
) {
  if (!project) {
    throw new ConvexError("Project not found");
  }

  if (project.organizationId !== organizationId) {
    throw new ConvexError("Unauthorized");
  }

  return project;
}

async function ensureCustomerBelongsToOrganization(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
  organizationId: string,
) {
  const customer = await ctx.db.get(customerId);

  if (!customer) {
    throw new ConvexError("Customer not found");
  }

  if (customer.organizationId !== organizationId) {
    throw new ConvexError("Unauthorized");
  }

  return customer;
}

async function requireOrganizationMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
) {
  const member = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "member",
    where: [
      {
        field: "organizationId",
        operator: "eq",
        value: organizationId,
      },
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
  })) as MemberDoc | null;

  if (!member) {
    throw new ConvexError("Unauthorized");
  }

  return member;
}

async function resolveCustomerAssignment(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers"> | undefined,
  organizationId: string,
) {
  if (!customerId) {
    return undefined;
  }

  const customer = await ensureCustomerBelongsToOrganization(ctx, customerId, organizationId);
  if (customer.deletedAt !== undefined) {
    throw new ConvexError("Customer not found");
  }

  return customer;
}

async function buildCustomerMap(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  customerIds: Array<Id<"customers">>,
  options?: {
    includeArchived?: boolean;
  },
) {
  const uniqueCustomerIds = Array.from(
    new Set(customerIds.map((customerId) => String(customerId))),
  ) as Array<string>;

  const entries = await Promise.all(
    uniqueCustomerIds.map(async (customerId) => {
      const customer = await ctx.db.get(customerId as Id<"customers">);
      if (!customer || customer.organizationId !== organizationId) {
        return [customerId, undefined] as const;
      }

      if (!options?.includeArchived && customer.deletedAt !== undefined) {
        return [customerId, undefined] as const;
      }

      return [customerId, toCustomerResponse(customer)] as const;
    }),
  );

  return new Map(entries);
}

function buildLastSeenByProjectId(reviewStates: Array<Doc<"projectReviewStates">>) {
  const lastSeenByProjectId = new Map<string, number>();

  for (const reviewState of reviewStates) {
    lastSeenByProjectId.set(
      String(reviewState.projectId),
      reviewState.lastSeenTimelineActivityAt,
    );
  }

  return lastSeenByProjectId;
}

function buildProjectListItems(
  projects: Array<Doc<"projects">>,
  customerById: Map<string, ReturnType<typeof toCustomerResponse> | undefined>,
  lastSeenByProjectId: Map<string, number>,
) {
  return projects.map((project) => {
    const lastTimelineActivityAt = project.lastTimelineActivityAt ?? 0;
    const lastNachtragAt = project.lastNachtragAt ?? 0;
    const lastSeenTimelineActivityAt = lastSeenByProjectId.get(String(project._id)) ?? 0;

    return {
      ...toProjectResponse(
        project,
        project.customerId ? customerById.get(String(project.customerId)) : undefined,
      ),
      hasUnreviewedChanges:
        lastTimelineActivityAt > 0 && lastSeenTimelineActivityAt < lastTimelineActivityAt,
      hasNachtrag: lastNachtragAt > 0,
      hasUnseenNachtrag: lastNachtragAt > 0 && lastSeenTimelineActivityAt < lastNachtragAt,
    };
  });
}

async function listProjectsForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
    statuses?: Array<Doc<"projects">["status"]>;
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const [projects, reviewStates] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_organization_deletedAt_updatedAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("deletedAt", undefined),
      )
      .order("desc")
      .collect(),
    ctx.db
      .query("projectReviewStates")
      .withIndex("by_user_org_project", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .collect(),
  ]);

  const requestedStatuses = new Set(args.statuses ?? []);
  const filteredProjects =
    requestedStatuses.size > 0
      ? projects.filter((project) => requestedStatuses.has(resolveProjectStatus(project.status)))
      : projects;
  const customerById = await buildCustomerMap(
    ctx,
    args.organizationId,
    filteredProjects
      .map((project) => project.customerId)
      .filter((customerId): customerId is Id<"customers"> => customerId !== undefined),
  );

  return buildProjectListItems(
    filteredProjects,
    customerById,
    buildLastSeenByProjectId(reviewStates),
  );
}

async function listProjectsByCustomerForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
    customerId: Id<"customers">;
    statuses?: Array<Doc<"projects">["status"]>;
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const customer = await ctx.db.get(args.customerId);
  if (
    !customer ||
    customer.organizationId !== args.organizationId ||
    customer.deletedAt !== undefined
  ) {
    return [];
  }

  const [projects, reviewStates] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_customerId_updatedAt", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .collect(),
    ctx.db
      .query("projectReviewStates")
      .withIndex("by_user_org_project", (q) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .collect(),
  ]);

  const requestedStatuses = new Set(args.statuses ?? []);
  const filteredProjects = projects.filter((project) => {
    if (project.organizationId !== args.organizationId || project.deletedAt !== undefined) {
      return false;
    }

    if (requestedStatuses.size === 0) {
      return true;
    }

    return requestedStatuses.has(resolveProjectStatus(project.status));
  });

  const customerById = new Map<string, ReturnType<typeof toCustomerResponse> | undefined>([
    [String(customer._id), toCustomerResponse(customer)],
  ]);

  return buildProjectListItems(
    filteredProjects,
    customerById,
    buildLastSeenByProjectId(reviewStates),
  );
}

async function listArchivedProjectsForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_organization_deletedAt_updatedAt", (q) =>
      q.eq("organizationId", args.organizationId).gt("deletedAt", undefined),
    )
    .order("desc")
    .collect();
  const customerById = await buildCustomerMap(
    ctx,
    args.organizationId,
    projects
      .map((project) => project.customerId)
      .filter((customerId): customerId is Id<"customers"> => customerId !== undefined),
    { includeArchived: true },
  );

  return projects.map((project) =>
    toArchivedProjectResponse(
      project,
      project.customerId ? customerById.get(String(project.customerId)) : undefined,
    ),
  );
}

async function getProjectByIdForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
    projectId: Id<"projects">;
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const project = await ctx.db.get(args.projectId);

  if (!project) {
    return null;
  }

  if (project.organizationId !== args.organizationId || project.deletedAt !== undefined) {
    return null;
  }

  const customer =
    project.customerId !== undefined
      ? await resolveCustomerAssignment(ctx, project.customerId, args.organizationId).catch(
          () => undefined,
        )
      : undefined;

  return toProjectResponse(project, customer ? toCustomerResponse(customer) : undefined);
}

async function listTimelineForProject(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    projectId: Id<"projects">;
    limit?: number;
  },
) {
  const project = await ctx.db.get(args.projectId);

  if (!project || project.deletedAt !== undefined) {
    return [];
  }

  if (project.organizationId !== args.organizationId) {
    throw new ConvexError("Unauthorized");
  }

  const limit = Math.min(Math.max(args.limit ?? 200, 1), MAX_TIMELINE_ITEMS);
  const timelineRows = await ctx.db
    .query("projectTimelineItems")
    .withIndex("by_project_addedAt", (q) => q.eq("projectId", args.projectId))
    .order("desc")
    .take(limit);

  return await Promise.all(
    timelineRows.map(async (timelineRow) => {
      const media = await Promise.all(
        (timelineRow.mediaAssets ?? []).map(async (entry) => {
          const mediaAsset = await ctx.db.get(entry.mediaAssetId);

          if (!(mediaAsset && mediaAsset.organizationId === args.organizationId)) {
            return {
              mediaAssetId: entry.mediaAssetId,
              mimeType: entry.mimeType,
              kind: entry.kind,
            };
          }

          return {
            mediaAssetId: entry.mediaAssetId,
            mimeType: entry.mimeType,
            kind: entry.kind,
            summary: mediaAsset.summary,
            transcript: mediaAsset.transcript,
            extractedText: mediaAsset.extractedText,
            fieldLocales: mediaAsset.fieldLocales,
            url: (await ctx.storage.getUrl(mediaAsset.storageId)) ?? undefined,
          };
        }),
      );

      return {
        _id: timelineRow._id,
        batchId: timelineRow.batchId,
        sourceType: timelineRow.sourceType,
        messageId: timelineRow.messageId,
        addedAt: timelineRow.addedAt,
        dayBucketUtc: timelineRow.dayBucketUtc,
        addedByMemberId: timelineRow.addedByMemberId,
        addedByUserId: timelineRow.addedByUserId,
        addedByName: timelineRow.addedByName,
        sourceText: timelineRow.sourceText,
        text: timelineRow.text,
        transcript: timelineRow.transcript,
        extractedText: timelineRow.extractedText,
        summary: timelineRow.summary,
        batchTitle: timelineRow.batchTitle,
        batchOverview: timelineRow.batchOverview,
        hasNachtrag: timelineRow.hasNachtrag,
        nachtragNeedsClarification: timelineRow.nachtragNeedsClarification,
        nachtragItems: timelineRow.nachtragItems,
        nachtragDetails: timelineRow.nachtragDetails,
        nachtragLanguage: normalizeAppLocale(timelineRow.nachtragLanguage) ?? undefined,
        keywords: timelineRow.keywords,
        fieldLocales: timelineRow.fieldLocales,
        media,
      };
    }),
  );
}

async function computeLatestNachtragAtForProject(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const rows = await ctx.db
    .query("projectTimelineItems")
    .withIndex("by_project_addedAt", (q) => q.eq("projectId", projectId))
    .order("desc")
    .collect();
  const matched = rows.find(
    (row) => row.sourceType === "whatsapp_batch_summary" && row.hasNachtrag,
  );

  return matched?.addedAt ?? 0;
}

async function archiveProjectById(
  ctx: MutationCtx,
  organizationId: string,
  projectId: Id<"projects">,
) {
  const project = ensureProjectBelongsToOrganization(await ctx.db.get(projectId), organizationId);
  if (project.deletedAt !== undefined) {
    return null;
  }

  const now = Date.now();
  await ctx.db.patch(projectId, {
    deletedAt: now,
    updatedAt: now,
  });

  return null;
}

async function reassignBatchProjectForOrganization(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    batchId: Id<"whatsappSendBatches">;
    targetProjectId: Id<"projects">;
  },
) {
  const batch = await ctx.db.get(args.batchId);

  if (!batch) {
    throw new ConvexError("Batch not found");
  }

  if (batch.organizationId !== args.organizationId) {
    throw new ConvexError("Unauthorized");
  }

  const timelineRows = await ctx.db
    .query("projectTimelineItems")
    .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
    .collect();

  if (timelineRows.length === 0) {
    throw new ConvexError("Timeline batch not found");
  }

  const sourceProjectId = timelineRows[0]?.projectId;
  const sourceProject = sourceProjectId
    ? ensureProjectBelongsToOrganization(await ctx.db.get(sourceProjectId), args.organizationId)
    : null;
  const targetProject = ensureProjectBelongsToOrganization(
    await ctx.db.get(args.targetProjectId),
    args.organizationId,
  );

  if (targetProject.deletedAt !== undefined) {
    throw new ConvexError("Project not found");
  }

  if (sourceProject?.deletedAt !== undefined) {
    throw new ConvexError("Project not found");
  }

  if (resolveProjectStatus(targetProject.status) !== PROJECT_STATUS_ACTIVE) {
    throw new ConvexError("Only active projects can receive timeline updates");
  }

  if (sourceProject && resolveProjectStatus(sourceProject.status) !== PROJECT_STATUS_ACTIVE) {
    throw new ConvexError("Only active projects can be updated");
  }

  if (sourceProjectId === targetProject._id) {
    return null;
  }

  for (const timelineRow of timelineRows) {
    if (timelineRow.organizationId !== args.organizationId) {
      throw new ConvexError("Unauthorized");
    }
  }

  const mediaAssetIds = new Set<string>();
  const mediaAssetIdList: Id<"whatsappMediaAssets">[] = [];

  for (const timelineRow of timelineRows) {
    await ctx.db.patch(timelineRow._id, {
      projectId: targetProject._id,
    });

    for (const mediaAsset of timelineRow.mediaAssets ?? []) {
      const mediaAssetId = mediaAsset.mediaAssetId;
      const dedupeKey = String(mediaAssetId);

      if (mediaAssetIds.has(dedupeKey)) {
        continue;
      }

      mediaAssetIds.add(dedupeKey);
      mediaAssetIdList.push(mediaAssetId);
    }
  }

  for (const mediaAssetId of mediaAssetIdList) {
    await ctx.db.patch(mediaAssetId, {
      projectId: targetProject._id,
    });
  }

  const now = Date.now();
  await ctx.db.patch(args.batchId, {
    projectId: targetProject._id,
    updatedAt: now,
  });
  const [targetProjectNachtragAt, sourceProjectNachtragAt] = await Promise.all([
    computeLatestNachtragAtForProject(ctx, targetProject._id),
    sourceProjectId
      ? computeLatestNachtragAtForProject(ctx, sourceProjectId)
      : Promise.resolve(0),
  ]);
  await ctx.db.patch(targetProject._id, {
    lastTimelineActivityAt: now,
    lastNachtragAt: targetProjectNachtragAt,
    updatedAt: now,
  });

  if (sourceProject && sourceProjectId) {
    await ctx.db.patch(sourceProjectId, {
      lastTimelineActivityAt: now,
      lastNachtragAt: sourceProjectNachtragAt,
      updatedAt: now,
    });
  }

  return null;
}

export const list = query({
  args: {
    statuses: v.optional(v.array(projectStatusValidator)),
  },
  returns: v.array(projectListItemValidator),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    return await listProjectsForOrganization(ctx, {
      organizationId: organization.id,
      userId,
      statuses: args.statuses,
    });
  },
});

export const listByCustomer = query({
  args: {
    customerId: v.id("customers"),
    statuses: v.optional(v.array(projectStatusValidator)),
  },
  returns: v.array(projectListItemValidator),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    return await listProjectsByCustomerForOrganization(ctx, {
      organizationId: organization.id,
      userId,
      customerId: args.customerId,
      statuses: args.statuses,
    });
  },
});

export const listArchived = query({
  args: {},
  returns: v.array(archivedProjectListItemValidator),
  handler: async (ctx) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    return await listArchivedProjectsForOrganization(ctx, {
      organizationId: organization.id,
      userId,
    });
  },
});

export const getById = query({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.union(v.object(projectResponseFields), v.null()),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    return await getProjectByIdForOrganization(ctx, {
      organizationId: organization.id,
      userId,
      projectId: args.projectId,
    });
  },
});

export const timeline = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
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
      fieldLocales: v.optional(timelineFieldLocalesValidator),
      media: v.array(timelineMediaValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    await requireOrganizationMember(ctx, organization.id, userId);
    return await listTimelineForProject(ctx, {
      organizationId: organization.id,
      projectId: args.projectId,
      limit: args.limit,
    });
  },
});

export const create = mutation({
  args: {
    location: v.string(),
    customerId: v.optional(v.id("customers")),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    const [userId, customer] = await Promise.all([
      requireAuthUserId(ctx),
      resolveCustomerAssignment(ctx, args.customerId, organization.id),
    ]);
    const now = Date.now();

    return await ctx.db.insert("projects", {
      organizationId: organization.id,
      createdBy: userId,
      customerId: customer?._id,
      location: normalizeProjectLocationInput(args.location),
      status: PROJECT_STATUS_ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    statuses: v.optional(v.array(projectStatusValidator)),
  },
  returns: v.array(projectListItemValidator),
  handler: async (ctx, args) => {
    return await listProjectsForOrganization(ctx, args);
  },
});

export const listByCustomerForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    customerId: v.id("customers"),
    statuses: v.optional(v.array(projectStatusValidator)),
  },
  returns: v.array(projectListItemValidator),
  handler: async (ctx, args) => {
    return await listProjectsByCustomerForOrganization(ctx, args);
  },
});

export const listArchivedForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.array(archivedProjectListItemValidator),
  handler: async (ctx, args) => {
    return await listArchivedProjectsForOrganization(ctx, args);
  },
});

export const getByIdForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.union(v.object(projectResponseFields), v.null()),
  handler: async (ctx, args) => {
    return await getProjectByIdForOrganization(ctx, args);
  },
});

export const timelineForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
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
      fieldLocales: v.optional(timelineFieldLocalesValidator),
      media: v.array(timelineMediaValidator),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    return await listTimelineForProject(ctx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      limit: args.limit,
    });
  },
});

export const createForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    location: v.string(),
    customerId: v.optional(v.id("customers")),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    const customer = await resolveCustomerAssignment(ctx, args.customerId, args.organizationId);
    const now = Date.now();

    return await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      createdBy: args.userId,
      customerId: customer?._id,
      location: normalizeProjectLocationInput(args.location),
      status: PROJECT_STATUS_ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
    location: v.optional(v.string()),
    customerId: v.optional(v.union(v.id("customers"), v.null())),
    status: v.optional(projectStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    const project = ensureProjectBelongsToOrganization(await ctx.db.get(args.projectId), args.organizationId);
    if (project.deletedAt !== undefined) {
      throw new ConvexError("Project not found");
    }

    const noFieldChanges =
      args.location === undefined &&
      args.customerId === undefined &&
      args.status === undefined;
    if (noFieldChanges) {
      return null;
    }

    const patch: Partial<Doc<"projects">> = {
      updatedAt: Date.now(),
    };

    if (args.location !== undefined) {
      patch.location = normalizeProjectLocationInput(args.location);
    }

    if (args.customerId !== undefined) {
      if (args.customerId === null) {
        patch.customerId = undefined;
      } else {
        const customer = await resolveCustomerAssignment(ctx, args.customerId, args.organizationId);
        patch.customerId = customer?._id;
      }
    }

    if (args.status !== undefined) {
      patch.status = args.status;
    }

    await ctx.db.patch(args.projectId, patch);
    return null;
  },
});

export const restoreForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    const project = ensureProjectBelongsToOrganization(await ctx.db.get(args.projectId), args.organizationId);
    if (project.deletedAt === undefined) {
      return null;
    }

    const now = Date.now();
    if (project.customerId) {
      const customer = await ensureCustomerBelongsToOrganization(
        ctx,
        project.customerId,
        args.organizationId,
      );
      if (customer.deletedAt !== undefined) {
        await ctx.db.patch(customer._id, {
          deletedAt: undefined,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(args.projectId, {
      deletedAt: undefined,
      updatedAt: now,
    });
    return null;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    location: v.optional(v.string()),
    customerId: v.optional(v.union(v.id("customers"), v.null())),
    status: v.optional(projectStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    const project = ensureProjectBelongsToOrganization(await ctx.db.get(args.projectId), organization.id);
    if (project.deletedAt !== undefined) {
      throw new ConvexError("Project not found");
    }

    const noFieldChanges =
      args.location === undefined &&
      args.customerId === undefined &&
      args.status === undefined;
    if (noFieldChanges) {
      return null;
    }

    const patch: Partial<Doc<"projects">> = {
      updatedAt: Date.now(),
    };

    if (args.location !== undefined) {
      patch.location = normalizeProjectLocationInput(args.location);
    }

    if (args.customerId !== undefined) {
      if (args.customerId === null) {
        patch.customerId = undefined;
      } else {
        const customer = await resolveCustomerAssignment(ctx, args.customerId, organization.id);
        patch.customerId = customer?._id;
      }
    }

    if (args.status !== undefined) {
      patch.status = args.status;
    }

    await ctx.db.patch(args.projectId, patch);
    return null;
  },
});

export const archive = mutation({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    return await archiveProjectById(ctx, organization.id, args.projectId);
  },
});

export const remove = mutation({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    return await archiveProjectById(ctx, organization.id, args.projectId);
  },
});

export const restore = mutation({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    const project = ensureProjectBelongsToOrganization(await ctx.db.get(args.projectId), organization.id);
    if (project.deletedAt === undefined) {
      return null;
    }

    const now = Date.now();
    if (project.customerId) {
      const customer = await ensureCustomerBelongsToOrganization(
        ctx,
        project.customerId,
        organization.id,
      );
      if (customer.deletedAt !== undefined) {
        await ctx.db.patch(customer._id, {
          deletedAt: undefined,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(args.projectId, {
      deletedAt: undefined,
      updatedAt: now,
    });
    return null;
  },
});

export const markReviewed = mutation({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    const project = ensureProjectBelongsToOrganization(
      await ctx.db.get(args.projectId),
      organization.id,
    );
    if (project.deletedAt !== undefined) {
      throw new ConvexError("Project not found");
    }

    const existingReviewState = await ctx.db
      .query("projectReviewStates")
      .withIndex("by_user_org_project", (q) =>
        q.eq("userId", userId)
          .eq("organizationId", organization.id)
          .eq("projectId", args.projectId),
      )
      .first();
    const now = Date.now();
    const lastSeenTimelineActivityAt = project.lastTimelineActivityAt ?? now;

    if (existingReviewState) {
      await ctx.db.patch(existingReviewState._id, {
        lastSeenTimelineActivityAt,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert("projectReviewStates", {
      organizationId: organization.id,
      projectId: args.projectId,
      userId,
      lastSeenTimelineActivityAt,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const reassignBatchProject = mutation({
  args: {
    batchId: v.id("whatsappSendBatches"),
    targetProjectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    return await reassignBatchProjectForOrganization(ctx, {
      organizationId: organization.id,
      batchId: args.batchId,
      targetProjectId: args.targetProjectId,
    });
  },
});

export const reassignBatchProjectForOrganizationUser = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    batchId: v.id("whatsappSendBatches"),
    targetProjectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    return await reassignBatchProjectForOrganization(ctx, {
      organizationId: args.organizationId,
      batchId: args.batchId,
      targetProjectId: args.targetProjectId,
    });
  },
});

export const backfillLocationsFromLegacyNames = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
    hasMore: v.boolean(),
    continueCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("projects")
      .paginate({
        numItems: LEGACY_PROJECT_BACKFILL_BATCH_SIZE,
        cursor: args.cursor ?? null,
      });

    let processed = 0;

    for (const project of result.page) {
      const legacyProject = project as LegacyProjectDoc;
      const legacyLocation = readProjectLocation(legacyProject);

      if (!legacyLocation) {
        continue;
      }

      const {
        _creationTime,
        _id,
        name: legacyName,
        ...replacement
      } = legacyProject;

      if (
        legacyName === undefined &&
        normalizeOptionalProjectLocationInput(replacement.location) === legacyLocation
      ) {
        continue;
      }

      await ctx.db.replace(project._id, {
        ...replacement,
        location: legacyLocation,
      });
      processed += 1;
    }

    return {
      processed,
      hasMore: !result.isDone,
      continueCursor: result.isDone ? undefined : result.continueCursor,
    };
  },
});
