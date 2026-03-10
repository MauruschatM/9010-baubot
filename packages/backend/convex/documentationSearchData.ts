import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { vAppLocale } from "./lib/locales";

function normalizeWhitespace(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function buildDocumentationOverviewSearchText(options: {
  projectName?: string;
  customerName?: string;
  batchTitle?: string;
  summary?: string;
  overview?: string;
  nachtragDetails?: string;
  nachtragItems?: string[];
}) {
  return normalizeWhitespace(
    [
      options.projectName ? `Project: ${options.projectName}` : null,
      options.customerName ? `Customer: ${options.customerName}` : null,
      options.batchTitle ? `Title: ${options.batchTitle}` : null,
      options.summary ? `Summary: ${options.summary}` : null,
      options.nachtragItems && options.nachtragItems.length > 0
        ? `Nachtrag items: ${options.nachtragItems.join(", ")}`
        : null,
      options.nachtragDetails ? `Nachtrag details: ${options.nachtragDetails}` : null,
      options.overview ?? null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function resolveBatchTitle(row: Doc<"projectTimelineItems">) {
  return (
    normalizeWhitespace(row.batchTitle) ??
    normalizeWhitespace(row.summary) ??
    "Project update"
  );
}

async function buildProjectMap(
  ctx: QueryCtx,
  projectIds: Id<"projects">[],
) {
  const uniqueProjectIds = Array.from(
    new Set(projectIds.map((projectId) => String(projectId))),
  ) as string[];

  const entries = await Promise.all(
    uniqueProjectIds.map(async (projectId) => {
      const project = await ctx.db.get(projectId as Id<"projects">);
      return [projectId, project] as const;
    }),
  );

  return new Map(entries);
}

async function buildCustomerMap(
  ctx: QueryCtx,
  customerIds: Id<"customers">[],
) {
  const uniqueCustomerIds = Array.from(
    new Set(customerIds.map((customerId) => String(customerId))),
  ) as string[];

  const entries = await Promise.all(
    uniqueCustomerIds.map(async (customerId) => {
      const customer = await ctx.db.get(customerId as Id<"customers">);
      return [customerId, customer] as const;
    }),
  );

  return new Map(entries);
}

function mapDocumentationOverviewSource(options: {
  row: Doc<"projectTimelineItems">;
  project: Doc<"projects"> | null;
  customer: Doc<"customers"> | null;
}) {
  const overview = normalizeWhitespace(options.row.batchOverview);
  if (!overview) {
    return null;
  }

  const projectName =
    normalizeWhitespace(options.project?.name) ??
    normalizeWhitespace(options.row.batchTitle) ??
    "Unknown project";
  const customerName = normalizeWhitespace(options.customer?.name) ?? null;
  const batchTitle = resolveBatchTitle(options.row);
  const summary = normalizeWhitespace(options.row.summary) ?? null;
  const nachtragDetails = normalizeWhitespace(options.row.nachtragDetails);
  const searchText = buildDocumentationOverviewSearchText({
    projectName,
    customerName: customerName ?? undefined,
    batchTitle,
    summary: summary ?? undefined,
    overview,
    nachtragDetails,
    nachtragItems: options.row.nachtragItems,
  });

  if (!searchText) {
    return null;
  }

  return {
    batchId: options.row.batchId,
    timelineItemId: options.row._id,
    organizationId: options.row.organizationId,
    projectId: options.row.projectId,
    projectName,
    customerName,
    batchTitle,
    summary,
    overview,
    searchText,
    hasNachtrag: Boolean(options.row.hasNachtrag),
    locale: options.row.fieldLocales?.batchOverview,
    addedAt: options.row.addedAt,
  };
}

export const getDocumentationOverviewSourceByBatchId = internalQuery({
  args: {
    batchId: v.id("whatsappSendBatches"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("projectTimelineItems")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .collect();
    const row =
      rows.find(
        (entry) =>
          entry.sourceType === "whatsapp_batch_summary" &&
          normalizeWhitespace(entry.batchOverview),
      ) ?? null;

    if (!row) {
      return null;
    }

    const project = await ctx.db.get(row.projectId);
    if (!project) {
      return null;
    }

    const customer = project.customerId ? await ctx.db.get(project.customerId) : null;
    return mapDocumentationOverviewSource({
      row,
      project,
      customer,
    });
  },
});

export const listDocumentationOverviewSources = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId;
    const rows = projectId
      ? await ctx.db
          .query("projectTimelineItems")
          .withIndex("by_project_addedAt", (q) => q.eq("projectId", projectId))
          .order("desc")
          .collect()
      : await ctx.db
          .query("projectTimelineItems")
          .withIndex("by_organization_sourceType_addedAt", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("sourceType", "whatsapp_batch_summary"),
          )
          .order("desc")
          .collect();

    const summaryRows = rows.filter(
      (row) =>
        row.organizationId === args.organizationId &&
        row.sourceType === "whatsapp_batch_summary" &&
        normalizeWhitespace(row.batchOverview),
    );

    if (summaryRows.length === 0) {
      return [];
    }

    const projectsById = await buildProjectMap(
      ctx,
      summaryRows.map((row) => row.projectId),
    );
    const customersById = await buildCustomerMap(
      ctx,
      Array.from(
        new Set(
          summaryRows
            .map((row) => {
              const project = projectsById.get(String(row.projectId));
              return project?.customerId;
            })
            .filter((customerId): customerId is Id<"customers"> => customerId !== undefined),
        ),
      ),
    );

    return summaryRows
      .map((row) =>
        mapDocumentationOverviewSource({
          row,
          project: projectsById.get(String(row.projectId)) ?? null,
          customer:
            projectsById.get(String(row.projectId))?.customerId !== undefined
              ? (customersById.get(
                  String(projectsById.get(String(row.projectId))!.customerId),
                ) ?? null)
              : null,
        }),
      )
      .filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

export const listDocumentationOverviewEmbeddings = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId;
    const rows = projectId
      ? await ctx.db
          .query("documentationOverviewEmbeddings")
          .withIndex("by_project_addedAt", (q) => q.eq("projectId", projectId))
          .order("desc")
          .collect()
      : await ctx.db
          .query("documentationOverviewEmbeddings")
          .withIndex("by_organization_addedAt", (q) =>
            q.eq("organizationId", args.organizationId),
          )
          .order("desc")
          .collect();

    return rows.filter((row) => row.organizationId === args.organizationId);
  },
});

export const upsertDocumentationOverviewEmbedding = internalMutation({
  args: {
    batchId: v.id("whatsappSendBatches"),
    timelineItemId: v.id("projectTimelineItems"),
    organizationId: v.string(),
    projectId: v.id("projects"),
    projectName: v.string(),
    customerName: v.optional(v.string()),
    batchTitle: v.string(),
    summary: v.optional(v.string()),
    overview: v.string(),
    searchText: v.string(),
    hasNachtrag: v.boolean(),
    locale: v.optional(vAppLocale),
    addedAt: v.number(),
    embeddingModel: v.string(),
    embedding: v.array(v.number()),
  },
  returns: v.id("documentationOverviewEmbeddings"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("documentationOverviewEmbeddings")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .first();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        timelineItemId: args.timelineItemId,
        organizationId: args.organizationId,
        projectId: args.projectId,
        projectName: args.projectName,
        customerName: args.customerName,
        batchTitle: args.batchTitle,
        summary: args.summary,
        overview: args.overview,
        searchText: args.searchText,
        hasNachtrag: args.hasNachtrag,
        locale: args.locale,
        addedAt: args.addedAt,
        embeddingModel: args.embeddingModel,
        embedding: args.embedding,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("documentationOverviewEmbeddings", {
      batchId: args.batchId,
      timelineItemId: args.timelineItemId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      projectName: args.projectName,
      customerName: args.customerName,
      batchTitle: args.batchTitle,
      summary: args.summary,
      overview: args.overview,
      searchText: args.searchText,
      hasNachtrag: args.hasNachtrag,
      locale: args.locale,
      addedAt: args.addedAt,
      embeddingModel: args.embeddingModel,
      embedding: args.embedding,
      createdAt: now,
      updatedAt: now,
    });
  },
});
