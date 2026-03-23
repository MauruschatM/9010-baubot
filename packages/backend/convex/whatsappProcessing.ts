'use node';

import type { AppLocale } from "@mvp-template/i18n";
import { generateObject } from "ai";
import { ConvexError, v } from "convex/values";
import { z } from "zod";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { normalizeAppLocale } from "./lib/locales";
import {
  hasOpenRouterFastConfig,
  openrouter,
  requireOpenRouterFastModel,
} from "./lib/openrouter";
import {
  isPhoneOnlyMemberEmail,
} from "./memberProfiles";
import {
  documentationFailedMessage,
  documentationProjectChoiceMessage,
  documentationProjectLocationPrompt,
  documentationSavedMessage,
} from "./whatsapp/messages";
import { inferLocaleFromPhoneNumber } from "./whatsapp/normalize";
import { cosineSimilarity, embedTextsWithVoyage } from "./lib/voyage";
import {
  MAX_PROJECT_LOCATION_LENGTH,
  readProjectLocation,
} from "./projectFields";

type BatchProcessingData = {
  batch: Doc<"whatsappSendBatches">;
  messages: Doc<"whatsappMessages">[];
  projects: Doc<"projects">[];
  customers: Doc<"customers">[];
  mediaAssets: Doc<"whatsappMediaAssets">[];
};

type BetterAuthUserDoc = {
  _id: string;
  name: string;
  email: string;
};

type MemberProfileDoc = Doc<"memberProfiles">;

type TimelineFieldLocales = {
  sourceText?: AppLocale;
  text?: AppLocale;
  transcript?: AppLocale;
  extractedText?: AppLocale;
  summary?: AppLocale;
  batchTitle?: AppLocale;
  batchOverview?: AppLocale;
  nachtragDetails?: AppLocale;
  nachtragItems?: AppLocale[];
};

type TimelineMediaAsset = {
  mediaAssetId: Id<"whatsappMediaAssets">;
  messageId: Id<"whatsappMessages">;
  sourceIndex: number;
  sourceMediaUrl: string;
  storageId: Id<"_storage">;
  mimeType: string;
  kind: "image" | "audio" | "video" | "file";
  transcript?: string;
  extractedText?: string;
  summary?: string;
  keywords?: string[];
  fieldLocales?: {
    transcript?: string;
    extractedText?: string;
    summary?: string;
  };
  processingStatus?: "pending" | "processed" | "failed";
  processingError?: string;
};

type RoutingHints = {
  projectQueryCandidates: string[];
  addressCandidates: string[];
  customerCandidates: string[];
  reason: string;
};

type FinalizeResult = {
  message: string;
};

type PreparedTimelineItem = {
  messageId: Id<"whatsappMessages">;
  addedAt: number;
  sourceText?: string;
  text?: string;
  transcript?: string;
  extractedText?: string;
  summary?: string;
  keywords?: string[];
  fieldLocales?: TimelineFieldLocales;
  mediaAssets: TimelineMediaAsset[];
};

type BatchNarrative = {
  batchTitle: string;
  summary: string;
  batchOverview: string;
  fieldLocales?: {
    summary?: AppLocale;
    batchTitle?: AppLocale;
    batchOverview?: AppLocale;
  };
};

type RoutingWorkspaceData = {
  projects: Doc<"projects">[];
  customers: Doc<"customers">[];
};

type ProjectRoutingHit = {
  projectId: Id<"projects">;
  projectLocation: string;
  customerId?: Id<"customers">;
  customerName?: string;
  similarity: number;
};

type CustomerRoutingHit = {
  customerId: Id<"customers">;
  customerName: string;
  similarity: number;
};

type RoutingDecision = {
  decision: "project" | "customer" | "ambiguous" | "none";
  confidence: number;
  projectLocation?: string;
  customerName?: string;
  reason: string;
};

type ProjectChoiceResult =
  | {
      kind: "selected";
      project: Doc<"projects">;
      reason: string;
      confidence: number;
      routingContext: string | null;
    }
  | {
      kind: "choose";
      options: Doc<"projects">[];
      reason: string;
      suggestedProjectLocation: string;
      customerId?: Id<"customers">;
      routingContext: string | null;
    }
  | {
      kind: "need_name";
      suggestedProjectLocation: string;
      customerId?: Id<"customers">;
      reason: string;
      routingContext: string | null;
    };

type ProjectLocationInputChoiceResult =
  | {
      kind: "selected";
      project: Doc<"projects">;
      reason: string;
    }
  | {
      kind: "choose";
      options: Doc<"projects">[];
      reason: string;
    }
  | {
      kind: "create";
      reason: string;
    };

type PendingProjectChoiceOption = {
  projectId: Id<"projects">;
  location: string;
  customerName?: string;
};

const MAX_PROJECT_OPTIONS = 5;
const MAX_BATCH_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 320;
const AUTO_ATTACH_MIN_CONFIDENCE = 0.85;
const VERY_SIMILAR_MATCH_THRESHOLD = 0.87;
const DOMINANT_SIMILARITY_GAP = 0.05;
const ROUTING_CONTEXT_LIMIT = 3;
const ROUTING_CONTEXT_MIN_SIMILARITY = 0.78;
const PROJECT_CHOICE_MIN_SIMILARITY = ROUTING_CONTEXT_MIN_SIMILARITY;
const ROUTING_HINT_QUERY_LIMIT = 4;
const ROUTING_SEARCH_QUERY_LIMIT = 9;
const VISUAL_MEDIA_SUMMARY_MAX_LENGTH = 180;
const VISUAL_MEDIA_KEYWORD_LIMIT = 8;
const ROUTING_MODEL_TIMEOUT_MS = 8_000;
const MEDIA_ANALYSIS_TIMEOUT_MS = 12_000;
const BATCH_NARRATIVE_TIMEOUT_MS = 12_000;
const batchNarrativeSchema = z.object({
  batchTitle: z.string(),
  summary: z.string(),
  batchOverview: z.string(),
});
const routingHintsSchema = z.object({
  projectQueryCandidates: z.array(z.string()).default([]),
  addressCandidates: z.array(z.string()).default([]),
  customerCandidates: z.array(z.string()).default([]),
  reason: z.string(),
});
const visualMediaAnalysisSchema = z.object({
  summary: z.string().optional(),
  extractedText: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Failed to process WhatsApp documentation";
}

function normalizeWhitespace(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMarkdownText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBatchTitle(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  return normalized
    .replace(/^#+\s*/, "")
    .replace(/^["“”'`]+|["“”'`]+$/g, "")
    .trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeProjectLocation(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length < 2 || normalized.length > MAX_PROJECT_LOCATION_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeNameMatch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/ß/gu, "ss")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function kindFromMimeType(mimeType: string): "image" | "audio" | "video" | "file" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function collectBatchSearchSegments(
  messages: Doc<"whatsappMessages">[],
  options?: {
    mediaAssetsByKey?: Map<string, TimelineMediaAsset>;
    extraText?: string[];
  },
) {
  const segments: string[] = [];

  for (const message of messages) {
    segments.push(message.text);

    for (const [index, media] of message.media.entries()) {
      const asset = options?.mediaAssetsByKey?.get(`${String(message._id)}:${index}`);

      segments.push(asset?.transcript ?? media.transcription ?? "");
      segments.push(asset?.extractedText ?? "");
    }
  }

  for (const extraText of options?.extraText ?? []) {
    segments.push(extraText);
  }

  return segments
    .map((segment) => normalizeWhitespace(segment))
    .filter((segment): segment is string => Boolean(segment));
}

function buildBatchEvidenceText(
  messages: Doc<"whatsappMessages">[],
  options?: {
    mediaAssetsByKey?: Map<string, TimelineMediaAsset>;
    extraText?: string[];
  },
) {
  return collectBatchSearchSegments(messages, options).join("\n");
}

function batchSearchText(
  messages: Doc<"whatsappMessages">[],
  options?: {
    mediaAssetsByKey?: Map<string, TimelineMediaAsset>;
    extraText?: string[];
  },
) {
  return normalizeNameMatch(buildBatchEvidenceText(messages, options));
}

function normalizeRoutingCandidates(values: string[], limit: number) {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalizedValue = normalizeWhitespace(value);

    if (!(normalizedValue && !seen.has(normalizedValue.toLowerCase()))) {
      continue;
    }

    deduped.push(normalizedValue);
    seen.add(normalizedValue.toLowerCase());

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function buildRoutingSearchQueries(options: {
  searchText: string;
  routingHints?: RoutingHints;
}) {
  return normalizeRoutingCandidates(
    [
      options.searchText,
      ...(options.routingHints?.projectQueryCandidates ?? []),
      ...(options.routingHints?.addressCandidates ?? []),
      ...(options.routingHints?.customerCandidates ?? []),
    ],
    ROUTING_SEARCH_QUERY_LIMIT,
  );
}

function mergeProjectRoutingHits(hitLists: ProjectRoutingHit[][]) {
  const hitsByProjectId = new Map<string, ProjectRoutingHit>();

  for (const hitList of hitLists) {
    for (const hit of hitList) {
      const key = String(hit.projectId);
      const existingHit = hitsByProjectId.get(key);

      if (!existingHit || hit.similarity > existingHit.similarity) {
        hitsByProjectId.set(key, hit);
      }
    }
  }

  return Array.from(hitsByProjectId.values()).sort(
    (left, right) => right.similarity - left.similarity,
  );
}

function mergeCustomerRoutingHits(hitLists: CustomerRoutingHit[][]) {
  const hitsByCustomerId = new Map<string, CustomerRoutingHit>();

  for (const hitList of hitLists) {
    for (const hit of hitList) {
      const key = String(hit.customerId);
      const existingHit = hitsByCustomerId.get(key);

      if (!existingHit || hit.similarity > existingHit.similarity) {
        hitsByCustomerId.set(key, hit);
      }
    }
  }

  return Array.from(hitsByCustomerId.values()).sort(
    (left, right) => right.similarity - left.similarity,
  );
}

function hasExactNameMention(searchText: string, candidate: string | undefined) {
  const normalizedCandidate = normalizeWhitespace(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return searchText.includes(normalizeNameMatch(normalizedCandidate));
}

function buildCustomerById(customers: Doc<"customers">[]) {
  return new Map(customers.map((customer) => [String(customer._id), customer]));
}

function buildProjectSearchDocument(
  project: Doc<"projects">,
  customerById: Map<string, Doc<"customers">>,
) {
  const customer =
    project.customerId !== undefined ? customerById.get(String(project.customerId)) : undefined;
  const projectLocation = readProjectLocation(project);

  return normalizeWhitespace(
    [
      projectLocation,
      customer?.name,
      customer?.contactName,
      project.description,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function buildCustomerSearchDocument(customer: Doc<"customers">) {
  return normalizeWhitespace(
    [customer.name, customer.contactName, customer.email, customer.phone]
      .filter(Boolean)
      .join("\n"),
  );
}

async function searchSimilarProjectsByEmbedding(
  projects: Doc<"projects">[],
  customers: Doc<"customers">[],
  searchText: string,
): Promise<ProjectRoutingHit[]> {
  const normalizedSearchText = normalizeWhitespace(searchText);
  if (projects.length === 0 || !normalizedSearchText) {
    return [];
  }

  const customerById = buildCustomerById(customers);
  const projectDocuments = projects
    .map((project) => ({
      project,
      document: buildProjectSearchDocument(project, customerById),
    }))
    .filter(
      (
        entry,
      ): entry is { project: Doc<"projects">; document: string } => typeof entry.document === "string",
    );

  if (projectDocuments.length === 0) {
    return [];
  }

  const [queryEmbeddings, projectEmbeddings] = await Promise.all([
    embedTextsWithVoyage([normalizedSearchText], {
      inputType: "query",
    }),
    embedTextsWithVoyage(
      projectDocuments.map((entry) => entry.document),
      {
        inputType: "document",
      },
    ),
  ]);
  if (!(queryEmbeddings?.[0] && projectEmbeddings)) {
    return [];
  }

  const queryEmbedding = queryEmbeddings[0];

  return projectDocuments
    .map((entry, index) => {
      const customer =
        entry.project.customerId !== undefined
          ? customerById.get(String(entry.project.customerId))
          : undefined;

      return {
        projectId: entry.project._id,
        projectLocation: readProjectLocation(entry.project) ?? "Unknown project",
        customerId: entry.project.customerId,
        customerName: customer?.name,
        similarity: cosineSimilarity(queryEmbedding, projectEmbeddings[index] ?? []),
      } satisfies ProjectRoutingHit;
    })
    .sort((left, right) => right.similarity - left.similarity);
}

async function searchSimilarCustomersByEmbedding(
  customers: Doc<"customers">[],
  searchText: string,
): Promise<CustomerRoutingHit[]> {
  const normalizedSearchText = normalizeWhitespace(searchText);
  if (customers.length === 0 || !normalizedSearchText) {
    return [];
  }

  const customerDocuments = customers
    .map((customer) => ({
      customer,
      document: buildCustomerSearchDocument(customer),
    }))
    .filter(
      (
        entry,
      ): entry is { customer: Doc<"customers">; document: string } =>
        typeof entry.document === "string",
    );

  if (customerDocuments.length === 0) {
    return [];
  }

  const [queryEmbeddings, customerEmbeddings] = await Promise.all([
    embedTextsWithVoyage([normalizedSearchText], {
      inputType: "query",
    }),
    embedTextsWithVoyage(
      customerDocuments.map((entry) => entry.document),
      {
        inputType: "document",
      },
    ),
  ]);
  if (!(queryEmbeddings?.[0] && customerEmbeddings)) {
    return [];
  }

  const queryEmbedding = queryEmbeddings[0];

  return customerDocuments
    .map((entry, index) => ({
      customerId: entry.customer._id,
      customerName: entry.customer.name,
      similarity: cosineSimilarity(queryEmbedding, customerEmbeddings[index] ?? []),
    }))
    .sort((left, right) => right.similarity - left.similarity);
}

async function searchSimilarProjectsByQueries(
  projects: Doc<"projects">[],
  customers: Doc<"customers">[],
  searchQueries: string[],
): Promise<ProjectRoutingHit[]> {
  const normalizedQueries = normalizeRoutingCandidates(
    searchQueries,
    ROUTING_SEARCH_QUERY_LIMIT,
  );

  if (normalizedQueries.length === 0) {
    return [];
  }

  const hitLists = await Promise.all(
    normalizedQueries.map((query) =>
      searchSimilarProjectsByEmbedding(projects, customers, query),
    ),
  );

  return mergeProjectRoutingHits(hitLists);
}

async function searchSimilarCustomersByQueries(
  customers: Doc<"customers">[],
  searchQueries: string[],
): Promise<CustomerRoutingHit[]> {
  const normalizedQueries = normalizeRoutingCandidates(
    searchQueries,
    ROUTING_SEARCH_QUERY_LIMIT,
  );

  if (normalizedQueries.length === 0) {
    return [];
  }

  const hitLists = await Promise.all(
    normalizedQueries.map((query) => searchSimilarCustomersByEmbedding(customers, query)),
  );

  return mergeCustomerRoutingHits(hitLists);
}

async function extractRoutingHints(options: {
  locale: AppLocale;
  evidenceText: string;
  suggestedProjectLocation: string;
}): Promise<RoutingHints> {
  const fallback: RoutingHints = {
    projectQueryCandidates: [],
    addressCandidates: [],
    customerCandidates: [],
    reason: "no_routing_hints",
  };

  if (!hasOpenRouterFastConfig()) {
    return fallback;
  }

  const normalizedEvidenceText = normalizeWhitespace(options.evidenceText);
  if (!normalizedEvidenceText) {
    return fallback;
  }

  try {
    const modelId = requireOpenRouterFastModel();
    const result = await generateObject({
      model: openrouter(modelId),
      timeout: { totalMs: ROUTING_MODEL_TIMEOUT_MS },
      schema: routingHintsSchema,
      prompt: [
        "Extract routing search hints for an existing project lookup from a WhatsApp documentation batch.",
        `Write the optional reason in locale ${options.locale}.`,
        "Return short search phrases only. These phrases are recall boosters, not final truth.",
        `Return at most ${ROUTING_HINT_QUERY_LIMIT} projectQueryCandidates, ${ROUTING_HINT_QUERY_LIMIT} addressCandidates, and ${ROUTING_HINT_QUERY_LIMIT} customerCandidates.`,
        "You may lightly normalize obvious speech-to-text or OCR noise when it helps search recall.",
        "Do not invent entities that are unsupported by the evidence.",
        "Prefer phrases that would help find an existing project, site address, or customer record.",
        "If the evidence is weak, return empty arrays.",
        "Context:",
        JSON.stringify({
          suggestedProjectLocation: options.suggestedProjectLocation,
          evidenceText: normalizedEvidenceText,
        }),
      ].join("\n"),
    });

    return {
      projectQueryCandidates: normalizeRoutingCandidates(
        result.object.projectQueryCandidates,
        ROUTING_HINT_QUERY_LIMIT,
      ),
      addressCandidates: normalizeRoutingCandidates(
        result.object.addressCandidates,
        ROUTING_HINT_QUERY_LIMIT,
      ),
      customerCandidates: normalizeRoutingCandidates(
        result.object.customerCandidates,
        ROUTING_HINT_QUERY_LIMIT,
      ),
      reason: normalizeWhitespace(result.object.reason) ?? fallback.reason,
    };
  } catch (error) {
    console.warn("WhatsApp routing hint extraction failed", {
      message: errorMessageFromUnknown(error),
    });
    return fallback;
  }
}

const routingDecisionSchema = z.object({
  decision: z.union([
    z.literal("project"),
    z.literal("customer"),
    z.literal("ambiguous"),
    z.literal("none"),
  ]),
  confidence: z.number(),
  projectLocation: z.string().optional(),
  customerName: z.string().optional(),
  reason: z.string(),
});

function buildRoutingDecisionFallback(options: {
  exactProjectMatches: Doc<"projects">[];
  exactCustomerMatches: Doc<"customers">[];
  projectHits: ProjectRoutingHit[];
  customerHits: CustomerRoutingHit[];
}): RoutingDecision {
  if (options.exactProjectMatches.length === 1) {
    return {
      decision: "project",
      confidence: 1,
      projectLocation: readProjectLocation(options.exactProjectMatches[0]!) ?? "Unknown project",
      reason: "exact_project_mention",
    };
  }

  if (options.exactCustomerMatches.length === 1) {
    return {
      decision: "customer",
      confidence: 0.95,
      customerName: options.exactCustomerMatches[0]!.name,
      reason: "exact_customer_mention",
    };
  }

  const [topProjectHit, nextProjectHit] = options.projectHits;
  const [topCustomerHit, nextCustomerHit] = options.customerHits;

  if (
    topProjectHit &&
    topProjectHit.similarity >= VERY_SIMILAR_MATCH_THRESHOLD &&
    topProjectHit.similarity - (nextProjectHit?.similarity ?? 0) >= DOMINANT_SIMILARITY_GAP
  ) {
    return {
      decision: "project",
      confidence: topProjectHit.similarity,
      projectLocation: topProjectHit.projectLocation,
      reason: "very_similar_project_match",
    };
  }

  if (
    topCustomerHit &&
    topCustomerHit.similarity >= VERY_SIMILAR_MATCH_THRESHOLD &&
    topCustomerHit.similarity - (nextCustomerHit?.similarity ?? 0) >= DOMINANT_SIMILARITY_GAP
  ) {
    return {
      decision: "customer",
      confidence: topCustomerHit.similarity,
      customerName: topCustomerHit.customerName,
      reason: "very_similar_customer_match",
    };
  }

  if (
    options.projectHits.some((hit) => hit.similarity >= VERY_SIMILAR_MATCH_THRESHOLD) ||
    options.customerHits.some((hit) => hit.similarity >= VERY_SIMILAR_MATCH_THRESHOLD)
  ) {
    return {
      decision: "ambiguous",
      confidence: Math.max(topProjectHit?.similarity ?? 0, topCustomerHit?.similarity ?? 0),
      reason: "multiple_similar_matches",
    };
  }

  return {
    decision: "none",
    confidence: 0,
    reason: "no_confident_match",
  };
}

async function resolveRoutingDecision(options: {
  searchText: string;
  routingHints?: RoutingHints;
  searchQueries: string[];
  exactProjectMatches: Doc<"projects">[];
  exactCustomerMatches: Doc<"customers">[];
  projectHits: ProjectRoutingHit[];
  customerHits: CustomerRoutingHit[];
}): Promise<RoutingDecision> {
  const fallback = buildRoutingDecisionFallback(options);

  if (!hasOpenRouterFastConfig()) {
    return fallback;
  }

  try {
    const modelId = requireOpenRouterFastModel();
    const result = await generateObject({
      model: openrouter(modelId),
      timeout: { totalMs: ROUTING_MODEL_TIMEOUT_MS },
      schema: routingDecisionSchema,
      prompt: [
        "Resolve project routing for a WhatsApp documentation batch.",
        "Use only the combined message text, transcripts, OCR text, extracted routing hints, and the provided candidate project/customer metadata as evidence.",
        "Choose 'project' only when one provided project is the strongest clearly supported match.",
        "Choose 'customer' only when one provided customer is clear but the project is still unclear.",
        "Choose 'ambiguous' when multiple provided projects or customers remain plausible, or the evidence conflicts.",
        "Choose 'none' when the text is generic, missing, or too weak. Prefer 'none' over guessing.",
        "Use only the provided names. Never invent, paraphrase, or normalize to unseen names.",
        "Set confidence between 0 and 1. Lower confidence when the evidence comes mostly from noisy transcript or OCR text.",
        "If decision is 'project', set projectLocation exactly as provided. If decision is 'customer', set customerName exactly as provided. Otherwise omit both.",
        "Keep reason short, snake_case, and free of entity names.",
        "Context:",
        JSON.stringify({
          searchText: options.searchText,
          searchQueries: options.searchQueries,
          routingHints: options.routingHints,
          exactProjectMatches: options.exactProjectMatches
            .map((project) => readProjectLocation(project))
            .filter((projectLocation): projectLocation is string => Boolean(projectLocation)),
          exactCustomerMatches: options.exactCustomerMatches.map((customer) => customer.name),
          topProjectHits: options.projectHits.slice(0, ROUTING_CONTEXT_LIMIT),
          topCustomerHits: options.customerHits.slice(0, ROUTING_CONTEXT_LIMIT),
          fallback,
        }),
      ].join("\n"),
    });

    return result.object;
  } catch {
    return fallback;
  }
}

function matchProjectByLocation(
  projects: Doc<"projects">[],
  projectLocation: string | undefined,
) {
  return findProjectsByLocation(projects, projectLocation)[0] ?? null;
}

function findProjectsByLocation(
  projects: Doc<"projects">[],
  projectLocation: string | undefined,
) {
  const normalizedProjectLocation = normalizeWhitespace(projectLocation);
  if (!normalizedProjectLocation) {
    return [];
  }

  const normalizedMatch = normalizeNameMatch(normalizedProjectLocation);
  return projects.filter((project) => {
    const candidateLocation = readProjectLocation(project);
    return (
      candidateLocation !== undefined &&
      normalizeNameMatch(candidateLocation) === normalizedMatch
    );
  });
}

function matchCustomerByName(customers: Doc<"customers">[], customerName: string | undefined) {
  const normalizedCustomerName = normalizeWhitespace(customerName);
  if (!normalizedCustomerName) {
    return null;
  }

  return (
    customers.find(
      (customer) => normalizeNameMatch(customer.name) === normalizeNameMatch(normalizedCustomerName),
    ) ?? null
  );
}

function findDominantSimilarityHit<T extends { similarity: number }>(
  hits: T[],
  minimumSimilarity = VERY_SIMILAR_MATCH_THRESHOLD,
) {
  const [topHit, nextHit] = hits;
  if (!topHit) {
    return null;
  }

  if (
    topHit.similarity < minimumSimilarity ||
    topHit.similarity - (nextHit?.similarity ?? 0) < DOMINANT_SIMILARITY_GAP
  ) {
    return null;
  }

  return topHit;
}

function pickProjectHitsForCustomer(
  projectHits: ProjectRoutingHit[],
  customerId: Id<"customers"> | undefined,
) {
  if (customerId === undefined) {
    return projectHits;
  }

  const sameCustomerHits = projectHits.filter((hit) => hit.customerId === customerId);
  return sameCustomerHits.length > 0 ? sameCustomerHits : projectHits;
}

function findProjectFromHits(options: {
  projects: Doc<"projects">[];
  projectHits: ProjectRoutingHit[];
  customerId?: Id<"customers">;
  minimumSimilarity?: number;
  requireDominant?: boolean;
}) {
  const projectById = new Map(options.projects.map((project) => [String(project._id), project]));
  const scopedHits = pickProjectHitsForCustomer(options.projectHits, options.customerId);
  const candidateHits = options.requireDominant
    ? [findDominantSimilarityHit(scopedHits, options.minimumSimilarity)].filter(
        (hit): hit is ProjectRoutingHit => hit !== null,
      )
    : scopedHits.filter(
        (hit) => hit.similarity >= (options.minimumSimilarity ?? PROJECT_CHOICE_MIN_SIMILARITY),
      );

  for (const hit of candidateHits) {
    const project = projectById.get(String(hit.projectId));
    if (project) {
      return {
        project,
        similarity: hit.similarity,
      };
    }
  }

  return null;
}

function findCustomerFromHits(options: {
  customers: Doc<"customers">[];
  customerHits: CustomerRoutingHit[];
  minimumSimilarity?: number;
  requireDominant?: boolean;
}) {
  const customerById = buildCustomerById(options.customers);
  const candidateHits = options.requireDominant
    ? [findDominantSimilarityHit(options.customerHits, options.minimumSimilarity)].filter(
        (hit): hit is CustomerRoutingHit => hit !== null,
      )
    : options.customerHits.filter(
        (hit) => hit.similarity >= (options.minimumSimilarity ?? PROJECT_CHOICE_MIN_SIMILARITY),
      );

  for (const hit of candidateHits) {
    const customer = customerById.get(String(hit.customerId));
    if (customer) {
      return {
        customer,
        similarity: hit.similarity,
      };
    }
  }

  return null;
}

function selectProjectOptionsFromHits(
  projects: Doc<"projects">[],
  projectHits: ProjectRoutingHit[],
): Doc<"projects">[] {
  const projectById = new Map(projects.map((project) => [String(project._id), project]));
  const selected: Doc<"projects">[] = [];
  const seen = new Set<string>();

  for (const hit of projectHits) {
    if (selected.length >= MAX_PROJECT_OPTIONS) {
      break;
    }

    const key = String(hit.projectId);
    if (seen.has(key)) {
      continue;
    }

    const project = projectById.get(key);
    if (!project) {
      continue;
    }

    selected.push(project);
    seen.add(key);
  }

  return selected;
}

function selectProjectsForCustomer(options: {
  projects: Doc<"projects">[];
  customerId: Id<"customers">;
  projectHits: ProjectRoutingHit[];
}) {
  const scopedProjects = options.projects.filter((project) => project.customerId === options.customerId);
  if (scopedProjects.length <= 1) {
    return scopedProjects;
  }

  const ranked = selectProjectOptionsFromHits(
    scopedProjects,
    pickProjectHitsForCustomer(options.projectHits, options.customerId),
  );

  if (ranked.length === 0) {
    return scopedProjects
      .slice()
      .sort((left, right) =>
        (readProjectLocation(left) ?? "").localeCompare(readProjectLocation(right) ?? ""),
      )
      .slice(0, MAX_PROJECT_OPTIONS);
  }

  const remaining = scopedProjects
    .filter((project) => !ranked.some((rankedProject) => rankedProject._id === project._id))
    .sort((left, right) =>
      (readProjectLocation(left) ?? "").localeCompare(readProjectLocation(right) ?? ""),
    );

  return [...ranked, ...remaining].slice(0, MAX_PROJECT_OPTIONS);
}

function buildPendingProjectChoiceOptions(
  projects: Doc<"projects">[],
  customers: Doc<"customers">[],
): PendingProjectChoiceOption[] {
  const customerById = buildCustomerById(customers);

  return projects
    .slice(0, MAX_PROJECT_OPTIONS)
    .map((project) => {
      const customer =
        project.customerId !== undefined
          ? customerById.get(String(project.customerId))
          : undefined;

      return {
        projectId: project._id,
        location: readProjectLocation(project) ?? "Unknown project",
        customerName: customer?.name,
      } satisfies PendingProjectChoiceOption;
    });
}

function pickLocationMatches(options: {
  projects: Doc<"projects">[];
  projectLocation: string;
  customerId?: Id<"customers">;
}) {
  const matches = findProjectsByLocation(options.projects, options.projectLocation);
  if (matches.length === 0) {
    return [];
  }

  if (options.customerId === undefined) {
    return matches;
  }

  const sameCustomerMatches = matches.filter(
    (project) => project.customerId === options.customerId,
  );

  return sameCustomerMatches.length > 0 ? sameCustomerMatches : matches;
}

function resolveProjectChoiceFromSignals(options: {
  projects: Doc<"projects">[];
  customers: Doc<"customers">[];
  exactProjectMatches: Doc<"projects">[];
  projectHits: ProjectRoutingHit[];
  customerHits: CustomerRoutingHit[];
  routingDecision: RoutingDecision;
  suggestedProjectLocation: string;
  routingContext: string | null;
}): ProjectChoiceResult {
  if (options.exactProjectMatches.length > 1) {
    return {
      kind: "choose",
      options: options.exactProjectMatches.slice(0, MAX_PROJECT_OPTIONS),
      reason: "multiple_exact_project_matches",
      suggestedProjectLocation: options.suggestedProjectLocation,
      routingContext: options.routingContext,
    };
  }

  const exactProject = matchProjectByLocation(
    options.projects,
    options.routingDecision.projectLocation,
  );
  const semanticProjectMatch =
    exactProject || options.routingDecision.decision !== "project"
      ? null
      : findProjectFromHits({
          projects: options.projects,
          projectHits: options.projectHits,
          requireDominant: true,
        });

  const matchedProject = exactProject ?? semanticProjectMatch?.project ?? null;
  if (options.routingDecision.decision === "project" && matchedProject) {
    const matchReason = semanticProjectMatch ? "semantic_project_match" : options.routingDecision.reason;

    if (options.routingDecision.confidence >= AUTO_ATTACH_MIN_CONFIDENCE) {
      return {
        kind: "selected",
        project: matchedProject,
        reason: matchReason,
        confidence: options.routingDecision.confidence,
        routingContext: options.routingContext,
      };
    }

    return {
      kind: "choose",
      options: [matchedProject],
      reason: matchReason,
      suggestedProjectLocation: options.suggestedProjectLocation,
      routingContext: options.routingContext,
    };
  }

  const exactCustomer = matchCustomerByName(
    options.customers,
    options.routingDecision.customerName,
  );
  const semanticCustomerMatch =
    exactCustomer || options.routingDecision.decision !== "customer"
      ? null
      : findCustomerFromHits({
          customers: options.customers,
          customerHits: options.customerHits,
          requireDominant: true,
        });
  const matchedCustomer = exactCustomer ?? semanticCustomerMatch?.customer ?? null;

  if (options.routingDecision.decision === "customer" && matchedCustomer) {
    const matchReason = semanticCustomerMatch
      ? "semantic_customer_match"
      : options.routingDecision.reason;
    const customerProjects = selectProjectsForCustomer({
      projects: options.projects,
      customerId: matchedCustomer._id,
      projectHits: options.projectHits,
    });

    if (customerProjects.length === 1) {
      if (options.routingDecision.confidence >= AUTO_ATTACH_MIN_CONFIDENCE) {
        return {
          kind: "selected",
          project: customerProjects[0]!,
          reason: matchReason,
          confidence: options.routingDecision.confidence,
          routingContext: options.routingContext,
        };
      }

      return {
        kind: "choose",
        options: customerProjects,
        reason: matchReason,
        suggestedProjectLocation: options.suggestedProjectLocation,
        customerId: matchedCustomer._id,
        routingContext: options.routingContext,
      };
    }

    if (customerProjects.length > 1) {
      return {
        kind: "choose",
        options: customerProjects,
        reason: matchReason,
        suggestedProjectLocation: options.suggestedProjectLocation,
        customerId: matchedCustomer._id,
        routingContext: options.routingContext,
      };
    }

    return {
      kind: "need_name",
      suggestedProjectLocation: options.suggestedProjectLocation,
      customerId: matchedCustomer._id,
      reason: matchReason,
      routingContext: options.routingContext,
    };
  }

  const plausibleProjectOptions = selectProjectOptionsFromHits(
    options.projects,
    options.projectHits.filter(
      (hit) => hit.similarity >= PROJECT_CHOICE_MIN_SIMILARITY,
    ),
  );

  if (plausibleProjectOptions.length > 0) {
    return {
      kind: "choose",
      options: plausibleProjectOptions,
      reason: options.routingDecision.reason,
      suggestedProjectLocation: options.suggestedProjectLocation,
      routingContext: options.routingContext,
    };
  }

  return {
    kind: "need_name",
    suggestedProjectLocation: options.suggestedProjectLocation,
    reason: options.routingDecision.reason,
    routingContext: options.routingContext,
  };
}

function buildRoutingContextText(options: {
  projectHits: ProjectRoutingHit[];
  customerHits: CustomerRoutingHit[];
}) {
  const projectLines = options.projectHits
    .filter((hit) => hit.similarity >= ROUTING_CONTEXT_MIN_SIMILARITY)
    .slice(0, ROUTING_CONTEXT_LIMIT)
    .map((hit) => {
      const details = [hit.customerName ? `customer ${hit.customerName}` : null].filter(
        (detail): detail is string => detail !== null,
      );
      const detailsText = details.length > 0 ? `${details.join(", ")}, ` : "";
      return `- ${hit.projectLocation} (${detailsText}similarity ${hit.similarity.toFixed(2)})`;
    });
  const customerLines = options.customerHits
    .filter((hit) => hit.similarity >= ROUTING_CONTEXT_MIN_SIMILARITY)
    .slice(0, ROUTING_CONTEXT_LIMIT)
    .map((hit) => `- ${hit.customerName} (similarity ${hit.similarity.toFixed(2)})`);

  if (projectLines.length === 0 && customerLines.length === 0) {
    return null;
  }

  return [
    "Relevant workspace matches:",
    ...(projectLines.length > 0 ? ["Projects:", ...projectLines] : []),
    ...(customerLines.length > 0 ? ["Customers:", ...customerLines] : []),
    "Use these only if they fit the message context.",
  ].join("\n");
}

function suggestProjectLocation(messages: Doc<"whatsappMessages">[], batchCreatedAt: number) {
  for (const message of messages) {
    const sourceText = normalizeWhitespace(message.text);
    if (!sourceText || sourceText.startsWith("/")) {
      continue;
    }

    const firstLine = normalizeWhitespace(sourceText.split("\n")[0] ?? "");
    const candidate = firstLine ? truncateText(firstLine, MAX_PROJECT_LOCATION_LENGTH) : undefined;

    if (candidate && normalizeProjectLocation(candidate)) {
      return candidate;
    }
  }

  const date = new Date(batchCreatedAt);
  const datePart = Number.isNaN(date.getTime()) ? "undated" : date.toISOString().slice(0, 10);
  return `WhatsApp ${datePart}`;
}

function defaultBatchTitle(locale: AppLocale) {
  return locale === "de" ? "WhatsApp-Update" : "WhatsApp update";
}

function describeMediaCount(messages: Doc<"whatsappMessages">[], locale: AppLocale) {
  const mediaCount = messages.reduce((count, message) => count + message.media.length, 0);

  if (mediaCount === 0) {
    return undefined;
  }

  if (locale === "de") {
    return mediaCount === 1 ? "1 Medienanhang" : `${mediaCount} Medienanhänge`;
  }

  return mediaCount === 1 ? "1 media attachment" : `${mediaCount} media attachments`;
}

function buildBatchSummary(messages: Doc<"whatsappMessages">[], locale: AppLocale) {
  const combinedText = normalizeWhitespace(
    messages
      .flatMap((message) => [
        message.text,
        ...message.media.map((media) => media.transcription ?? ""),
      ])
      .join("\n"),
  );

  if (combinedText) {
    return {
      text: truncateText(combinedText, MAX_SUMMARY_LENGTH),
    };
  }

  const mediaLabel = describeMediaCount(messages, locale);

  if (locale === "de") {
    return {
      text: mediaLabel ? `${mediaLabel} erfasst.` : "WhatsApp-Dokumentation erfasst.",
      sourceLocale: locale,
    };
  }

  return {
    text: mediaLabel ? `${mediaLabel} captured.` : "WhatsApp documentation captured.",
    sourceLocale: locale,
  };
}

function buildBatchOverview(options: {
  messages: Doc<"whatsappMessages">[];
  addedByName?: string;
  locale: AppLocale;
}) {
  const messageLabel =
    options.locale === "de"
      ? options.messages.length === 1
        ? "1 WhatsApp-Nachricht"
        : `${options.messages.length} WhatsApp-Nachrichten`
      : options.messages.length === 1
        ? "1 WhatsApp message"
        : `${options.messages.length} WhatsApp messages`;
  const mediaLabel = describeMediaCount(options.messages, options.locale);

  if (options.locale === "de") {
    return [
      `Dieser Batch enthält ${messageLabel}.`,
      [mediaLabel ? `Er umfasst ${mediaLabel}.` : null, options.addedByName ? `Erfasst von ${options.addedByName}.` : null]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    `This batch contains ${messageLabel}.`,
    [mediaLabel ? `It includes ${mediaLabel}.` : null, options.addedByName ? `Submitted by ${options.addedByName}.` : null]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildBatchNarrativeFallback(options: {
  messages: Doc<"whatsappMessages">[];
  addedByName?: string;
  locale: AppLocale;
}): BatchNarrative {
  const summary = buildBatchSummary(options.messages, options.locale);

  return {
    batchTitle: defaultBatchTitle(options.locale),
    summary: summary.text,
    batchOverview: buildBatchOverview(options),
    fieldLocales: {
      ...(summary.sourceLocale ? { summary: summary.sourceLocale } : {}),
      batchTitle: options.locale,
      batchOverview: options.locale,
    },
  };
}

async function generateBatchNarrative(options: {
  messages: Doc<"whatsappMessages">[];
  preparedItems: PreparedTimelineItem[];
  addedByName?: string;
  locale: AppLocale;
}): Promise<BatchNarrative> {
  const fallback = buildBatchNarrativeFallback(options);

  if (!hasOpenRouterFastConfig()) {
    return fallback;
  }

  try {
    const modelId = requireOpenRouterFastModel();
    const result = await generateObject({
      model: openrouter(modelId),
      timeout: { totalMs: BATCH_NARRATIVE_TIMEOUT_MS },
      schema: batchNarrativeSchema,
      prompt: [
        "Summarize this WhatsApp documentation batch for a project timeline card.",
        `Write all output fields in locale ${options.locale}.`,
        "Return JSON only with this schema:",
        '{"batchTitle":string,"summary":string,"batchOverview":string}',
        "batchTitle must be concise, specific, and 2-6 words.",
        `summary must be exactly one sentence and no longer than ${MAX_SUMMARY_LENGTH} characters.`,
        "batchOverview must be 2-4 short Markdown paragraphs that are easy to scan.",
        "Use only plain paragraphs with optional inline emphasis. Do not use headings, bullet lists, numbered lists, tables, blockquotes, links, or code blocks.",
        "Describe concrete progress, issues, materials, decisions, and next steps only when they are supported by the batch content.",
        "Use message text, audio/video transcripts, extracted text, and media summaries as primary evidence.",
        "If the batch is mostly media, surface the actual transcript or extracted content rather than saying the content is unavailable.",
        "Avoid generic filler such as 'captured successfully' unless the batch is too sparse to infer anything useful.",
        "Do not invent facts, quantities, people, deadlines, or missing context.",
        "Avoid repeating project or customer names in the output. Prefer neutral references like 'the site', 'the customer', or 'the team'.",
        "If evidence is partial or uncertain, say that briefly instead of guessing.",
        "Batch input is chronological.",
        "Context:",
        JSON.stringify({
          addedByName: options.addedByName,
          messageCount: options.messages.length,
          items: options.preparedItems.map((item) => ({
            itemId: String(item.messageId),
            addedAt: new Date(item.addedAt).toISOString(),
            text: item.sourceText,
            transcript: item.transcript,
            extractedText: item.extractedText,
            summary: item.summary,
            keywords: item.keywords,
            media: item.mediaAssets.map((asset) => ({
              kind: asset.kind,
              mimeType: asset.mimeType,
              transcript: asset.transcript,
              extractedText: asset.extractedText,
              summary: asset.summary,
              keywords: asset.keywords,
            })),
          })),
        }),
      ].join("\n"),
    });

    const batchTitle = normalizeBatchTitle(result.object.batchTitle);
    const summary = normalizeWhitespace(result.object.summary);
    const batchOverview = normalizeMarkdownText(result.object.batchOverview);

    return {
      batchTitle: batchTitle
        ? truncateText(batchTitle, MAX_BATCH_TITLE_LENGTH)
        : fallback.batchTitle,
      summary: summary ? truncateText(summary, MAX_SUMMARY_LENGTH) : fallback.summary,
      batchOverview: batchOverview ?? fallback.batchOverview,
      fieldLocales: {
        ...fallback.fieldLocales,
        ...(batchTitle ? { batchTitle: options.locale } : {}),
        ...(summary ? { summary: options.locale } : {}),
        ...(batchOverview ? { batchOverview: options.locale } : {}),
      },
    };
  } catch (error) {
    console.error("WhatsApp batch narrative generation failed", error);
    return fallback;
  }
}

function normalizeKeywordList(values: string[] | undefined) {
  return normalizeRoutingCandidates(values ?? [], VISUAL_MEDIA_KEYWORD_LIMIT);
}

async function describeVisualMedia(options: {
  mediaUrl: string;
  mimeType: string;
  locale: AppLocale;
}): Promise<{
  summary?: string;
  extractedText?: string;
  keywords?: string[];
} | null> {
  if (!hasOpenRouterFastConfig()) {
    return null;
  }

  try {
    const modelId = requireOpenRouterFastModel();
    const result = await generateObject({
      model: openrouter(modelId),
      timeout: { totalMs: MEDIA_ANALYSIS_TIMEOUT_MS },
      schema: visualMediaAnalysisSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Analyze this WhatsApp image for project-routing evidence and timeline persistence.",
                `Write summary in locale ${options.locale}.`,
                `summary must be one sentence and at most ${VISUAL_MEDIA_SUMMARY_MAX_LENGTH} characters.`,
                "If readable text is visible, copy it into extractedText as faithfully as possible.",
                "Do not infer missing words. If no readable text is visible, omit extractedText.",
                `keywords must be concise and contain at most ${VISUAL_MEDIA_KEYWORD_LIMIT} items.`,
                "Return JSON only.",
              ].join("\n"),
            },
            {
              type: "image",
              image: options.mediaUrl,
              mediaType: options.mimeType,
            },
          ],
        },
      ],
    });

    return {
      summary: normalizeWhitespace(result.object.summary),
      extractedText: normalizeWhitespace(result.object.extractedText),
      keywords: normalizeKeywordList(result.object.keywords),
    };
  } catch (error) {
    console.warn("WhatsApp visual media analysis failed", {
      message: errorMessageFromUnknown(error),
    });
    return null;
  }
}

function dedupeKeywords(values: Array<string | undefined>) {
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeWhitespace(value)?.toLowerCase();

    if (!(normalized && !seen.has(normalized))) {
      continue;
    }

    seen.add(normalized);
    keywords.push(normalized);
  }

  return keywords.length > 0 ? keywords : undefined;
}

function resolveUniformLocale(locales: Array<string | undefined>) {
  const uniqueLocales = Array.from(
    new Set(
      locales
        .map((locale) => (locale === undefined ? undefined : normalizeAppLocale(locale)))
        .filter((locale): locale is AppLocale => !!locale),
    ),
  );
  return uniqueLocales.length === 1 ? uniqueLocales[0] : undefined;
}

export function derivePreparedTimelineFieldLocales(options: {
  sourceText?: string;
  sourceTextLocale?: AppLocale;
  transcript?: string;
  transcriptLocale?: AppLocale;
  extractedText?: string;
  extractedTextLocale?: AppLocale;
  summary?: string;
}) {
  const fieldLocales: TimelineFieldLocales = {};

  if (options.sourceText && options.sourceTextLocale) {
    fieldLocales.sourceText = options.sourceTextLocale;
    fieldLocales.text = options.sourceTextLocale;
  }

  if (options.transcript && options.transcriptLocale) {
    fieldLocales.transcript = options.transcriptLocale;
  }

  if (options.extractedText && options.extractedTextLocale) {
    fieldLocales.extractedText = options.extractedTextLocale;
  }

  if (options.summary) {
    const summaryLocale =
      (options.summary === options.sourceText ? options.sourceTextLocale : undefined) ??
      (options.summary === options.transcript ? options.transcriptLocale : undefined) ??
      (options.summary === options.extractedText ? options.extractedTextLocale : undefined);

    if (summaryLocale) {
      fieldLocales.summary = summaryLocale;
    }
  }

  return Object.keys(fieldLocales).length > 0 ? fieldLocales : undefined;
}

export function resolvePreparedTimelineSourceTextLocale(options: {
  sourceText?: string;
  sourceTextLocale?: AppLocale;
  transcriptLocale?: AppLocale;
  extractedTextLocale?: AppLocale;
  batchLocale: AppLocale;
}) {
  if (!options.sourceText) {
    return undefined;
  }

  return (
    options.sourceTextLocale ??
    options.transcriptLocale ??
    options.extractedTextLocale ??
    options.batchLocale
  );
}

async function resolveBatchLocale(ctx: {
  runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
}, batch: Doc<"whatsappSendBatches">): Promise<AppLocale> {
  const preferredLocale = (await ctx.runQuery(internal.whatsappData.getUserLocaleByUserId, {
    userId: batch.userId,
  })) as "en" | "de" | null;

  return preferredLocale === "de" ? "de" : inferLocaleFromPhoneNumber(batch.phoneE164);
}

async function resolveAddedByName(ctx: {
  runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
}, batch: Doc<"whatsappSendBatches">) {
  const profile = (await ctx.runQuery(internal.memberProfiles.getMemberProfileByMemberId, {
    memberId: batch.memberId,
  })) as MemberProfileDoc | null;
  const profileName = normalizeWhitespace(profile?.displayName);

  if (profileName) {
    return profileName;
  }

  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [
      {
        field: "_id",
        operator: "eq",
        value: batch.userId,
      },
    ],
  })) as BetterAuthUserDoc | null;

  const userName = normalizeWhitespace(user?.name);
  if (userName) {
    return userName;
  }

  if (user?.email && !isPhoneOnlyMemberEmail(user.email)) {
    return user.email;
  }

  return batch.phoneE164;
}

async function loadBatchData(ctx: {
  runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
}, batchId: Id<"whatsappSendBatches">): Promise<BatchProcessingData | null> {
  return (await ctx.runQuery((internal as any).whatsappProcessingData.getBatchForProcessing, {
    batchId,
  })) as BatchProcessingData | null;
}

async function ensureMediaAssets(
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
  },
  data: BatchProcessingData,
) {
  const assetsByKey = new Map<string, TimelineMediaAsset>();

  for (const asset of data.mediaAssets) {
    assetsByKey.set(`${String(asset.messageId)}:${asset.sourceIndex}`, {
      mediaAssetId: asset._id,
      messageId: asset.messageId,
      sourceIndex: asset.sourceIndex,
      sourceMediaUrl: asset.sourceMediaUrl,
      storageId: asset.storageId,
      mimeType: asset.mimeType,
      kind: asset.kind,
      transcript: asset.transcript,
      extractedText: asset.extractedText,
      summary: asset.summary,
      keywords: asset.keywords,
      fieldLocales: asset.fieldLocales,
      processingStatus: asset.processingStatus,
      processingError: asset.processingError,
    });
  }

  for (const message of data.messages) {
    for (const [index, media] of message.media.entries()) {
      const key = `${String(message._id)}:${index}`;

      if (assetsByKey.has(key)) {
        continue;
      }

      const mediaAssetId = (await ctx.runMutation(
        (internal as any).whatsappProcessingData.createMediaAsset,
        {
          batchId: data.batch._id,
          organizationId: data.batch.organizationId,
          messageId: message._id,
          sourceMediaUrl: media.mediaUrl ?? `storage:${String(media.storageId)}`,
          sourceIndex: index,
          mimeType: media.contentType,
          kind: kindFromMimeType(media.contentType),
          storageId: media.storageId,
          transcript: media.transcription,
          fieldLocales: media.transcriptionLocale
            ? {
                transcript: media.transcriptionLocale,
              }
            : undefined,
          processingStatus: "processed",
        },
      )) as Id<"whatsappMediaAssets">;

      assetsByKey.set(key, {
        mediaAssetId,
        messageId: message._id,
        sourceIndex: index,
        sourceMediaUrl: media.mediaUrl ?? `storage:${String(media.storageId)}`,
        storageId: media.storageId,
        mimeType: media.contentType,
        kind: kindFromMimeType(media.contentType),
        transcript: media.transcription,
        fieldLocales: media.transcriptionLocale
          ? {
                transcript: media.transcriptionLocale,
              }
          : undefined,
        processingStatus: "processed",
      });
    }
  }

  return assetsByKey;
}

async function ensureEnrichedMediaAssets(
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    storage: {
      getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
    };
  },
  data: BatchProcessingData,
  options: {
    locale: AppLocale;
  },
) {
  const assetsByKey = await ensureMediaAssets(ctx, data);

  if (!hasOpenRouterFastConfig()) {
    return assetsByKey;
  }

  for (const [key, asset] of assetsByKey.entries()) {
    if (
      asset.kind !== "image" ||
      asset.extractedText ||
      asset.summary ||
      (asset.keywords?.length ?? 0) > 0 ||
      asset.processingStatus === "failed"
    ) {
      continue;
    }

    try {
      const mediaUrl = await ctx.storage.getUrl(asset.storageId);

      if (!mediaUrl) {
        throw new Error("Stored media URL could not be resolved.");
      }

      const analysis = await describeVisualMedia({
        mediaUrl,
        mimeType: asset.mimeType,
        locale: options.locale,
      });

      if (!analysis) {
        continue;
      }

      const fieldLocales = {
        ...asset.fieldLocales,
        ...(analysis.extractedText ? { extractedText: options.locale } : {}),
        ...(analysis.summary ? { summary: options.locale } : {}),
      };

      const nextAsset: TimelineMediaAsset = {
        ...asset,
        extractedText: analysis.extractedText ?? asset.extractedText,
        summary: analysis.summary ?? asset.summary,
        keywords: analysis.keywords ?? asset.keywords,
        fieldLocales: Object.keys(fieldLocales).length > 0 ? fieldLocales : undefined,
        processingStatus: "processed",
        processingError: undefined,
      };

      assetsByKey.set(key, nextAsset);

      await ctx.runMutation((internal as any).whatsappProcessingData.updateMediaAssetAnalysis, {
        mediaAssetId: asset.mediaAssetId,
        extractedText: nextAsset.extractedText,
        summary: nextAsset.summary,
        keywords: nextAsset.keywords,
        fieldLocales: nextAsset.fieldLocales,
        processingStatus: "processed",
        processingError: "",
      });
    } catch (error) {
      console.warn("WhatsApp media asset enrichment failed", {
        mediaAssetId: String(asset.mediaAssetId),
        message: errorMessageFromUnknown(error),
      });

      assetsByKey.set(key, {
        ...asset,
        processingStatus: "failed",
        processingError: errorMessageFromUnknown(error),
      });

      await ctx.runMutation((internal as any).whatsappProcessingData.updateMediaAssetAnalysis, {
        mediaAssetId: asset.mediaAssetId,
        processingStatus: "failed",
        processingError: errorMessageFromUnknown(error),
      });
    }
  }

  return assetsByKey;
}

async function resolveProjectChoice(options: {
  data: BatchProcessingData;
  locale: AppLocale;
}): Promise<ProjectChoiceResult> {
  const { data } = options;
  const suggestedProjectLocation = suggestProjectLocation(data.messages, data.batch.createdAt);

  if (data.projects.length === 0) {
    return {
      kind: "need_name" as const,
      suggestedProjectLocation,
      reason: "no_active_projects",
      routingContext: null,
    };
  }

  const searchText = batchSearchText(data.messages);
  const exactProjectMatches = data.projects.filter((project) =>
    hasExactNameMention(searchText, readProjectLocation(project)),
  );

  if (exactProjectMatches.length === 1) {
    return {
      kind: "selected",
      project: exactProjectMatches[0]!,
      reason: "exact_project_match",
      confidence: 1,
      routingContext: null,
    };
  }

  if (exactProjectMatches.length > 1) {
    return {
      kind: "choose",
      options: exactProjectMatches.slice(0, MAX_PROJECT_OPTIONS),
      reason: "multiple_exact_project_matches",
      suggestedProjectLocation,
      routingContext: null,
    };
  }

  const evidenceText = buildBatchEvidenceText(data.messages);
  const routingHints = await extractRoutingHints({
    locale: options.locale,
    evidenceText,
    suggestedProjectLocation,
  });
  const routingSearchQueries = buildRoutingSearchQueries({
    searchText,
    routingHints,
  });
  const exactCustomerMatches = data.customers.filter(
    (customer) =>
      routingSearchQueries.some(
        (query) =>
          hasExactNameMention(normalizeNameMatch(query), customer.name) ||
          hasExactNameMention(normalizeNameMatch(query), customer.contactName),
      ),
  );

  let projectHits: ProjectRoutingHit[] = [];
  let customerHits: CustomerRoutingHit[] = [];

  try {
    [projectHits, customerHits] = await Promise.all([
      searchSimilarProjectsByQueries(data.projects, data.customers, routingSearchQueries),
      searchSimilarCustomersByQueries(data.customers, routingSearchQueries),
    ]);
  } catch (error) {
    console.error("WhatsApp routing similarity search failed", error);
  }

  const routingDecision = await resolveRoutingDecision({
    searchText: evidenceText,
    searchQueries: routingSearchQueries,
    routingHints,
    exactProjectMatches,
    exactCustomerMatches,
    projectHits,
    customerHits,
  });
  const routingContext = buildRoutingContextText({
    projectHits,
    customerHits,
  });

  return resolveProjectChoiceFromSignals({
    projects: data.projects,
    customers: data.customers,
    exactProjectMatches,
    projectHits,
    customerHits,
    routingDecision,
    suggestedProjectLocation,
    routingContext,
  });
}

async function resolveProjectLocationInputChoice(options: {
  projects: Doc<"projects">[];
  customers: Doc<"customers">[];
  projectLocation: string;
  customerId?: Id<"customers">;
}): Promise<ProjectLocationInputChoiceResult> {
  const locationMatches = pickLocationMatches({
    projects: options.projects,
    projectLocation: options.projectLocation,
    customerId: options.customerId,
  });

  if (locationMatches.length > 1) {
    return {
      kind: "choose",
      options: locationMatches.slice(0, MAX_PROJECT_OPTIONS),
      reason: "multiple_existing_location_matches",
    };
  }

  const existingProject = locationMatches[0] ?? null;
  if (existingProject) {
    return {
      kind: "selected",
      project: existingProject,
      reason: "selected_by_location",
    };
  }

  if (options.projects.length === 0) {
    return {
      kind: "create",
      reason: "created_from_whatsapp",
    };
  }

  let projectHits: ProjectRoutingHit[] = [];

  try {
    projectHits = await searchSimilarProjectsByEmbedding(
      options.projects,
      options.customers,
      options.projectLocation,
    );
  } catch (error) {
    console.error("WhatsApp manual project location similarity search failed", error);
  }

  const semanticOptions = selectProjectOptionsFromHits(
    options.projects,
    pickProjectHitsForCustomer(
      projectHits.filter((hit) => hit.similarity >= PROJECT_CHOICE_MIN_SIMILARITY),
      options.customerId,
    ),
  );

  if (semanticOptions.length > 0) {
    return {
      kind: "choose",
      options: semanticOptions,
      reason: "similar_existing_location_matches",
    };
  }

  return {
    kind: "create",
    reason: "created_from_whatsapp",
  };
}

async function finalizePreparedBatch(
  ctx: {
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    storage: {
      getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
    };
  },
  options: {
    data: BatchProcessingData;
    projectId: Id<"projects">;
    projectLocation: string;
    locale: AppLocale;
    mediaAssetsByKey?: Map<string, TimelineMediaAsset>;
  },
): Promise<FinalizeResult> {
  const addedByName = await resolveAddedByName(ctx, options.data.batch);
  const mediaAssetsByKey =
    options.mediaAssetsByKey ??
    (await ensureEnrichedMediaAssets(ctx, options.data, {
      locale: options.locale,
    }));
  const preparedTimelineItems: PreparedTimelineItem[] = options.data.messages.map((message) => {
    const messageMediaAssets = message.media.map((_media, index) => {
      const entry = mediaAssetsByKey.get(`${String(message._id)}:${index}`);

      if (!entry) {
        throw new ConvexError("Media asset could not be resolved for timeline persistence.");
      }

      return entry;
    });

    const sourceText = normalizeWhitespace(message.text);
    const transcript = normalizeWhitespace(
      messageMediaAssets
        .map((asset) => asset.transcript ?? "")
        .join("\n"),
    );
    const transcriptLocale = resolveUniformLocale(
      messageMediaAssets.map((asset) => asset.fieldLocales?.transcript),
    );
    const extractedText = normalizeWhitespace(
      messageMediaAssets
        .map((asset) => asset.extractedText ?? "")
        .join("\n"),
    );
    const extractedTextLocale = resolveUniformLocale(
      messageMediaAssets.map((asset) => asset.fieldLocales?.extractedText),
    );
    const keywords = dedupeKeywords(
      messageMediaAssets.flatMap((asset) => asset.keywords ?? []),
    );
    const summary =
      sourceText ??
      transcript ??
      extractedText ??
      (messageMediaAssets.length > 0
        ? `${messageMediaAssets.length} media attachment${messageMediaAssets.length === 1 ? "" : "s"}`
        : undefined);
    const sourceTextLocale = resolvePreparedTimelineSourceTextLocale({
      sourceText,
      transcriptLocale,
      extractedTextLocale,
      batchLocale: options.locale,
    });

    return {
      messageId: message._id,
      addedAt: message.createdAt,
      sourceText,
      text: sourceText,
      transcript,
      extractedText,
      summary,
      keywords,
      fieldLocales: derivePreparedTimelineFieldLocales({
        sourceText,
        sourceTextLocale,
        transcript,
        transcriptLocale,
        extractedText,
        extractedTextLocale,
        summary,
      }),
      mediaAssets: messageMediaAssets,
    };
  });

  const batchNarrative = await generateBatchNarrative({
    messages: options.data.messages,
    preparedItems: preparedTimelineItems,
    addedByName,
    locale: options.locale,
  });
  const timelineItems = preparedTimelineItems.map((item) => ({
    ...item,
    mediaAssets: item.mediaAssets.map((asset) => ({
      mediaAssetId: asset.mediaAssetId,
      mimeType: asset.mimeType,
      kind: asset.kind,
    })),
  }));
  const summaryAddedAt =
    options.data.messages[options.data.messages.length - 1]?.createdAt ?? options.data.batch.createdAt;

  await ctx.runMutation((internal as any).whatsappProcessingData.finalizeBatchPersistence, {
    batchId: options.data.batch._id,
    projectId: options.projectId,
    batchTitle: batchNarrative.batchTitle,
    summary: batchNarrative.summary,
    batchOverview: batchNarrative.batchOverview,
    summaryFieldLocales:
      batchNarrative.fieldLocales && Object.keys(batchNarrative.fieldLocales).length > 0
        ? batchNarrative.fieldLocales
        : undefined,
    summaryAddedAt,
    addedByMemberId: options.data.batch.memberId,
    addedByUserId: options.data.batch.userId,
    addedByName,
    items: timelineItems,
  });

  try {
      await ctx.runAction((internal as any).documentationSearch.indexDocumentationOverviewByBatch, {
      batchId: options.data.batch._id,
    });
  } catch (error) {
    console.error("Documentation overview indexing failed", error);
  }

  return {
    message: documentationSavedMessage({
      locale: options.locale,
      count: options.data.messages.length,
      projectLocation: options.projectLocation,
    }),
  };
}

async function failBatch(
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  },
  options: {
    batchId: Id<"whatsappSendBatches">;
    phoneNumberE164: string;
    locale: AppLocale;
    error: unknown;
    notifyMember: boolean;
  },
) {
  console.error("WhatsApp batch processing failed", {
    batchId: String(options.batchId),
    phoneNumberE164: options.phoneNumberE164,
    notifyMember: options.notifyMember,
    message: errorMessageFromUnknown(options.error),
  });

  await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
    batchId: options.batchId,
    status: "failed",
    error: errorMessageFromUnknown(options.error),
  });

  if (options.notifyMember) {
    try {
      await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.phoneNumberE164,
        locale: options.locale,
        text: documentationFailedMessage(options.locale),
      });
    } catch (notificationError) {
      console.error("WhatsApp documentation failure notification could not be delivered", {
        batchId: String(options.batchId),
        reason: errorMessageFromUnknown(notificationError),
      });
    }
  }
}

async function recordCompletedBatchDeliveryError(
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
  },
  options: {
    batchId: Id<"whatsappSendBatches">;
    error: unknown;
  },
) {
  console.error("WhatsApp batch delivery failed after persistence", {
    batchId: String(options.batchId),
    message: errorMessageFromUnknown(options.error),
  });

  await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
    batchId: options.batchId,
    error: `WhatsApp delivery failed: ${errorMessageFromUnknown(options.error)}`,
  });
}

export const processSendBatch = internalAction({
  args: {
    batchId: v.id("whatsappSendBatches"),
  },
  returns: v.object({
    message: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<{ message: string | null }> => {
    console.info("WhatsApp processSendBatch started", {
      batchId: String(args.batchId),
    });

    const data = await loadBatchData(ctx, args.batchId);

    if (!data) {
      throw new ConvexError("Batch not found.");
    }

    const locale = await resolveBatchLocale(ctx, data.batch);
    let batchPersisted = false;

    try {
      await ctx.runMutation((internal as any).whatsappProcessingData.clearPendingResolutionByBatch, {
        batchId: args.batchId,
      });
      await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: args.batchId,
        status: "processing",
        error: "",
        startedAt: Date.now(),
      });

      await ensureMediaAssets(ctx, data);
      const choice = await resolveProjectChoice({
        data,
        locale,
      });

      console.info("WhatsApp processSendBatch resolved project choice", {
        batchId: String(args.batchId),
        choice: choice.kind,
      });

      if (choice.kind === "selected") {
        await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
          batchId: args.batchId,
          projectId: choice.project._id,
          projectMatchConfidence: choice.confidence,
          projectMatchReason: choice.reason,
          candidateProjectIds: [choice.project._id],
        });

        const result = await finalizePreparedBatch(ctx, {
          data,
          projectId: choice.project._id,
          projectLocation: readProjectLocation(choice.project) ?? "Unknown project",
          locale,
        });
        batchPersisted = true;

        try {
          await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
            phoneNumberE164: data.batch.phoneE164,
            locale,
            text: result.message,
          });
        } catch (deliveryError) {
          await recordCompletedBatchDeliveryError(ctx, {
            batchId: args.batchId,
            error: deliveryError,
          });
          throw deliveryError;
        }

        return result;
      }

      console.info("WhatsApp processSendBatch awaiting member input", {
        batchId: String(args.batchId),
        choice: choice.kind,
      });

      if (choice.kind === "need_name") {
        await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
          batchId: args.batchId,
          status: "awaiting_project_name",
          projectMatchReason: choice.reason,
          candidateProjectIds: [],
        });
        await ctx.runMutation((internal as any).whatsappProcessingData.upsertPendingResolution, {
          organizationId: data.batch.organizationId,
          phoneE164: data.batch.phoneE164,
          memberId: data.batch.memberId,
          batchId: args.batchId,
          state: "awaiting_project_name",
          customerId: choice.customerId,
          aiSuggestedProjectName: choice.suggestedProjectLocation,
        });

        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: data.batch.phoneE164,
          locale,
          text: documentationProjectLocationPrompt({
            locale,
            suggestedProjectLocation: choice.suggestedProjectLocation,
          }),
        });

        return {
          message: null,
        };
      }

      await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: args.batchId,
        status: "awaiting_project_choice",
        projectMatchReason: choice.reason,
        candidateProjectIds: choice.options.map((project) => project._id),
      });

      await ctx.runMutation((internal as any).whatsappProcessingData.upsertPendingResolution, {
        organizationId: data.batch.organizationId,
        phoneE164: data.batch.phoneE164,
        memberId: data.batch.memberId,
        batchId: args.batchId,
        state: "awaiting_choice",
        customerId: choice.customerId,
        options: buildPendingProjectChoiceOptions(choice.options, data.customers),
        aiSuggestedProjectName: choice.suggestedProjectLocation,
      });

      await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: data.batch.phoneE164,
        locale,
        text: documentationProjectChoiceMessage({
          locale,
          projects: buildPendingProjectChoiceOptions(choice.options, data.customers),
          suggestedProjectLocation: choice.suggestedProjectLocation,
        }),
      });

      return {
        message: null,
      };
    } catch (error) {
      if (batchPersisted) {
        throw error;
      }

      await failBatch(ctx, {
        batchId: args.batchId,
        phoneNumberE164: data.batch.phoneE164,
        locale,
        error,
        notifyMember: true,
      });
      throw error;
    }
  },
});

export const finalizeBatchToProject = internalAction({
  args: {
    batchId: v.id("whatsappSendBatches"),
    projectId: v.id("projects"),
    locale: v.union(v.literal("en"), v.literal("de")),
    matchReason: v.optional(v.string()),
  },
  returns: v.object({
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<{ message: string }> => {
    const data = await loadBatchData(ctx, args.batchId);

    if (!data) {
      throw new ConvexError("Batch not found.");
    }

    const selectedProject = data.projects.find((project) => project._id === args.projectId);
    if (!selectedProject) {
      throw new ConvexError("Project is not available for WhatsApp timeline updates.");
    }

    try {
      await ctx.runMutation((internal as any).whatsappProcessingData.clearPendingResolutionByBatch, {
        batchId: args.batchId,
      });
      await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: args.batchId,
        status: "processing",
        error: "",
        projectId: selectedProject._id,
        projectMatchConfidence: 1,
        projectMatchReason: args.matchReason ?? "selected_by_member",
        candidateProjectIds: [selectedProject._id],
      });

      return await finalizePreparedBatch(ctx, {
        data,
        projectId: selectedProject._id,
        projectLocation: readProjectLocation(selectedProject) ?? "Unknown project",
        locale: args.locale,
      });
    } catch (error) {
      await failBatch(ctx, {
        batchId: args.batchId,
        phoneNumberE164: data.batch.phoneE164,
        locale: args.locale,
        error,
        notifyMember: false,
      });
      throw error;
    }
  },
});

export const createProjectAndFinalizeBatch = internalAction({
  args: {
    batchId: v.id("whatsappSendBatches"),
    location: v.string(),
    customerId: v.optional(v.id("customers")),
    locale: v.union(v.literal("en"), v.literal("de")),
  },
  returns: v.union(
    v.object({
      status: v.literal("saved"),
      message: v.string(),
    }),
    v.object({
      status: v.literal("awaiting_choice"),
      message: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<
    | { status: "saved"; message: string }
    | { status: "awaiting_choice"; message: string }
  > => {
    const data = await loadBatchData(ctx, args.batchId);

    if (!data) {
      throw new ConvexError("Batch not found.");
    }

    const normalizedProjectLocation = normalizeProjectLocation(args.location);
    if (!normalizedProjectLocation) {
      throw new ConvexError("Project location is invalid.");
    }

    const locationChoice = await resolveProjectLocationInputChoice({
      projects: data.projects,
      customers: data.customers,
      projectLocation: normalizedProjectLocation,
      customerId: args.customerId,
    });

    if (locationChoice.kind === "choose") {
      const choiceOptions = buildPendingProjectChoiceOptions(
        locationChoice.options,
        data.customers,
      );

      await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: args.batchId,
        status: "awaiting_project_choice",
        error: "",
        projectMatchReason: locationChoice.reason,
        candidateProjectIds: choiceOptions.map((option) => option.projectId),
      });
      await ctx.runMutation((internal as any).whatsappProcessingData.upsertPendingResolution, {
        organizationId: data.batch.organizationId,
        phoneE164: data.batch.phoneE164,
        memberId: data.batch.memberId,
        batchId: args.batchId,
        state: "awaiting_choice",
        customerId: args.customerId,
        options: choiceOptions,
        aiSuggestedProjectName: normalizedProjectLocation,
      });

      return {
        status: "awaiting_choice",
        message: documentationProjectChoiceMessage({
          locale: args.locale,
          projects: choiceOptions,
          suggestedProjectLocation: normalizedProjectLocation,
        }),
      };
    }

    const existingProject = locationChoice.kind === "selected" ? locationChoice.project : null;

    try {
      await ctx.runMutation((internal as any).whatsappProcessingData.clearPendingResolutionByBatch, {
        batchId: args.batchId,
      });
      await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: args.batchId,
        status: "processing",
        error: "",
        projectId: existingProject?._id,
        projectMatchReason: locationChoice.reason,
        candidateProjectIds: existingProject ? [existingProject._id] : [],
      });

      const projectId =
        existingProject?._id ??
        ((await ctx.runMutation((internal as any).whatsappProcessingData.createProjectForOrganization, {
          organizationId: data.batch.organizationId,
          createdBy: data.batch.userId,
          customerId: args.customerId,
          location: normalizedProjectLocation,
        })) as Id<"projects">);

      const result = await finalizePreparedBatch(ctx, {
        data,
        projectId,
        projectLocation:
          readProjectLocation(existingProject ?? { location: normalizedProjectLocation }) ??
          normalizedProjectLocation,
        locale: args.locale,
      });

      return {
        status: "saved",
        message: result.message,
      };
    } catch (error) {
      await failBatch(ctx, {
        batchId: args.batchId,
        phoneNumberE164: data.batch.phoneE164,
        locale: args.locale,
        error,
        notifyMember: false,
      });
      throw error;
    }
  },
});

export const lookupRoutingContext = internalAction({
  args: {
    organizationId: v.string(),
    queryText: v.string(),
  },
  returns: v.object({
    contextText: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const normalizedQueryText = normalizeWhitespace(args.queryText);
    if (!normalizedQueryText) {
      return {
        contextText: null,
      };
    }

    const workspaceData = (await ctx.runQuery(
      (internal as any).whatsappProcessingData.getActiveRoutingEntities,
      {
        organizationId: args.organizationId,
      },
    )) as RoutingWorkspaceData;

    let projectHits: ProjectRoutingHit[] = [];
    let customerHits: CustomerRoutingHit[] = [];

    try {
      [projectHits, customerHits] = await Promise.all([
        searchSimilarProjectsByEmbedding(
          workspaceData.projects,
          workspaceData.customers,
          normalizedQueryText,
        ),
        searchSimilarCustomersByEmbedding(workspaceData.customers, normalizedQueryText),
      ]);
    } catch (error) {
      console.error("WhatsApp routing context lookup failed", error);
    }

    return {
      contextText: buildRoutingContextText({
        projectHits,
        customerHits,
      }),
    };
  },
});

export {
  batchSearchText,
  buildRoutingSearchQueries,
  buildProjectSearchDocument,
  buildRoutingContextText,
  findProjectsByLocation,
  resolveProjectLocationInputChoice,
  resolveProjectChoiceFromSignals,
};
