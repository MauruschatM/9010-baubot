'use node';

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { cosineSimilarity, embedTextsWithVoyage } from "./lib/voyage";

const DOCUMENTATION_EMBEDDING_MODEL = "voyage-4";
const MIN_LEXICAL_SCORE = 0.15;
const MIN_SEMANTIC_SCORE = 0.15;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const EMBEDDING_BATCH_SIZE = 16;

type DocumentationOverviewSource = {
  batchId: Id<"whatsappSendBatches">;
  timelineItemId: Id<"projectTimelineItems">;
  organizationId: string;
  projectId: Id<"projects">;
  projectLocation: string;
  customerName: string | null;
  batchTitle: string;
  summary: string | null;
  overview: string;
  searchText: string;
  hasNachtrag: boolean;
  locale?: "en" | "de";
  addedAt: number;
};

type DocumentationOverviewEmbedding = {
  batchId: Id<"whatsappSendBatches">;
  searchText: string;
  embeddingModel: string;
  embedding: number[];
};

function normalizeWhitespace(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function tokenize(value: string) {
  return normalizeWhitespace(value)
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1) ?? [];
}

function lexicalScore(queryText: string, documentText: string) {
  const normalizedQuery = normalizeWhitespace(queryText)?.toLowerCase();
  const normalizedDocument = normalizeWhitespace(documentText)?.toLowerCase();

  if (!(normalizedQuery && normalizedDocument)) {
    return 0;
  }

  if (normalizedDocument.includes(normalizedQuery)) {
    return 1;
  }

  const queryTokens = Array.from(new Set(tokenize(normalizedQuery)));
  if (queryTokens.length === 0) {
    return 0;
  }

  const documentTokens = new Set(tokenize(normalizedDocument));
  const matches = queryTokens.filter((token) => documentTokens.has(token)).length;

  return matches / queryTokens.length;
}

async function ensureDocumentationOverviewEmbeddings(
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
  },
  options: {
    organizationId: string;
    projectId?: Id<"projects">;
    sources: DocumentationOverviewSource[];
  },
) {
  const existingRows = (await ctx.runQuery(
    (internal as any).documentationSearchData.listDocumentationOverviewEmbeddings,
    {
      organizationId: options.organizationId,
      projectId: options.projectId,
    },
  )) as DocumentationOverviewEmbedding[];

  const embeddingByBatchId = new Map<string, DocumentationOverviewEmbedding>();
  for (const row of existingRows) {
    embeddingByBatchId.set(String(row.batchId), row);
  }

  const missingSources = options.sources.filter((source) => {
    const existing = embeddingByBatchId.get(String(source.batchId));
    return !(
      existing &&
      existing.embeddingModel === DOCUMENTATION_EMBEDDING_MODEL &&
      existing.searchText === source.searchText &&
      Array.isArray(existing.embedding) &&
      existing.embedding.length > 0
    );
  });

  if (missingSources.length === 0) {
    return embeddingByBatchId;
  }

  for (const batch of chunkArray(missingSources, EMBEDDING_BATCH_SIZE)) {
    let embeddings: number[][] | null = null;

    try {
      embeddings = await embedTextsWithVoyage(
        batch.map((source) => source.searchText),
        {
          inputType: "document",
          model: DOCUMENTATION_EMBEDDING_MODEL,
        },
      );
    } catch (error) {
      console.error("Documentation overview embedding batch failed", error);
      return embeddingByBatchId;
    }

    if (!embeddings) {
      return embeddingByBatchId;
    }

    await Promise.all(
      batch.map(async (source, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
          return;
        }

        await ctx.runMutation(
          (internal as any).documentationSearchData.upsertDocumentationOverviewEmbedding,
          {
            batchId: source.batchId,
            timelineItemId: source.timelineItemId,
            organizationId: source.organizationId,
            projectId: source.projectId,
            projectLocation: source.projectLocation,
            customerName: source.customerName ?? undefined,
            batchTitle: source.batchTitle,
            summary: source.summary ?? undefined,
            overview: source.overview,
            searchText: source.searchText,
            hasNachtrag: source.hasNachtrag,
            locale: source.locale,
            addedAt: source.addedAt,
            embeddingModel: DOCUMENTATION_EMBEDDING_MODEL,
            embedding,
          },
        );

        embeddingByBatchId.set(String(source.batchId), {
          batchId: source.batchId,
          searchText: source.searchText,
          embeddingModel: DOCUMENTATION_EMBEDDING_MODEL,
          embedding,
        });
      }),
    );
  }

  return embeddingByBatchId;
}

export const indexDocumentationOverviewByBatch = internalAction({
  args: {
    batchId: v.id("whatsappSendBatches"),
  },
  returns: v.object({
    indexed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const source = (await ctx.runQuery(
      (internal as any).documentationSearchData.getDocumentationOverviewSourceByBatchId,
      {
        batchId: args.batchId,
      },
    )) as DocumentationOverviewSource | null;

    if (!source) {
      return {
        indexed: false,
      };
    }

    let embeddings: number[][] | null = null;

    try {
      embeddings = await embedTextsWithVoyage([source.searchText], {
        inputType: "document",
        model: DOCUMENTATION_EMBEDDING_MODEL,
      });
    } catch (error) {
      console.error("Documentation overview indexing failed", error);
      return {
        indexed: false,
      };
    }

    if (!embeddings?.[0]) {
      return {
        indexed: false,
      };
    }

    await ctx.runMutation(
      (internal as any).documentationSearchData.upsertDocumentationOverviewEmbedding,
      {
        batchId: source.batchId,
        timelineItemId: source.timelineItemId,
        organizationId: source.organizationId,
        projectId: source.projectId,
        projectLocation: source.projectLocation,
        customerName: source.customerName ?? undefined,
        batchTitle: source.batchTitle,
        summary: source.summary ?? undefined,
        overview: source.overview,
        searchText: source.searchText,
        hasNachtrag: source.hasNachtrag,
        locale: source.locale,
        addedAt: source.addedAt,
        embeddingModel: DOCUMENTATION_EMBEDDING_MODEL,
        embedding: embeddings[0],
      },
    );

    return {
      indexed: true,
    };
  },
});

export const searchDocumentationOverviews = internalAction({
  args: {
    organizationId: v.string(),
    queryText: v.string(),
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    searchMode: v.union(v.literal("semantic"), v.literal("text")),
    hits: v.array(
      v.object({
        batchId: v.string(),
        projectId: v.string(),
        projectLocation: v.string(),
        customerName: v.union(v.string(), v.null()),
        title: v.string(),
        summary: v.union(v.string(), v.null()),
        overview: v.string(),
        hasNachtrag: v.boolean(),
        addedAt: v.number(),
        score: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const normalizedQueryText = normalizeWhitespace(args.queryText);
    if (!normalizedQueryText) {
      return {
        searchMode: "text" as const,
        hits: [],
      };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const sources = (await ctx.runQuery(
      (internal as any).documentationSearchData.listDocumentationOverviewSources,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
      },
    )) as DocumentationOverviewSource[];

    if (sources.length === 0) {
      return {
        searchMode: "text" as const,
        hits: [],
      };
    }

    const embeddingByBatchId = await ensureDocumentationOverviewEmbeddings(ctx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      sources,
    });

    let queryEmbeddings: number[][] | null = null;

    try {
      queryEmbeddings = await embedTextsWithVoyage([normalizedQueryText], {
        inputType: "document",
        model: DOCUMENTATION_EMBEDDING_MODEL,
      });
    } catch (error) {
      console.error("Documentation overview query embedding failed", error);
    }

    const queryEmbedding = queryEmbeddings?.[0] ?? null;

    if (queryEmbedding) {
      const semanticHits = sources
        .map((source) => {
          const embeddingRow = embeddingByBatchId.get(String(source.batchId));
          const score = embeddingRow?.embedding
            ? cosineSimilarity(queryEmbedding, embeddingRow.embedding)
            : 0;

          return {
            batchId: String(source.batchId),
            projectId: String(source.projectId),
            projectLocation: source.projectLocation,
            customerName: source.customerName,
            title: source.batchTitle,
            summary: source.summary,
            overview: source.overview,
            hasNachtrag: source.hasNachtrag,
            addedAt: source.addedAt,
            score,
          };
        })
        .filter((hit) => hit.score >= MIN_SEMANTIC_SCORE)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);

      if (semanticHits.length > 0) {
        return {
          searchMode: "semantic" as const,
          hits: semanticHits,
        };
      }
    }

    const textHits = sources
      .map((source) => ({
        batchId: String(source.batchId),
        projectId: String(source.projectId),
        projectLocation: source.projectLocation,
        customerName: source.customerName,
        title: source.batchTitle,
        summary: source.summary,
        overview: source.overview,
        hasNachtrag: source.hasNachtrag,
        addedAt: source.addedAt,
        score: lexicalScore(normalizedQueryText, source.searchText),
      }))
      .filter((hit) => hit.score >= MIN_LEXICAL_SCORE)
      .sort((left, right) => right.score - left.score || right.addedAt - left.addedAt)
      .slice(0, limit);

    return {
      searchMode: "text" as const,
      hits: textHits,
    };
  },
});
