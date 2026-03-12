'use node';

import { gateway } from "@ai-sdk/gateway";
import type { AppLocale } from "@mvp-template/i18n";
import { generateObject } from "ai";
import { ConvexError, v } from "convex/values";
import { z } from "zod";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  isPhoneOnlyMemberEmail,
} from "./memberProfiles";
import {
  documentationFailedMessage,
  documentationProjectChoiceMessage,
  documentationProjectNamePrompt,
  documentationSavedMessage,
} from "./whatsapp/messages";
import { WHATSAPP_AGENT_MODEL } from "./whatsapp/constants";
import { inferLocaleFromPhoneNumber } from "./whatsapp/normalize";
import { cosineSimilarity, embedTextsWithVoyage } from "./lib/voyage";

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

type TimelineMediaAsset = {
  mediaAssetId: Id<"whatsappMediaAssets">;
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
  projectName: string;
  projectLocation?: string;
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
  projectName?: string;
  customerName?: string;
  reason: string;
};

const MAX_PROJECT_OPTIONS = 5;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_BATCH_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 320;
const AUTO_ATTACH_MIN_CONFIDENCE = 0.85;
const VERY_SIMILAR_MATCH_THRESHOLD = 0.87;
const ROUTING_CONTEXT_LIMIT = 3;
const ROUTING_CONTEXT_MIN_SIMILARITY = 0.78;
const batchNarrativeSchema = z.object({
  batchTitle: z.string(),
  summary: z.string(),
  batchOverview: z.string(),
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

function normalizeProjectName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length < 2 || normalized.length > MAX_PROJECT_NAME_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeNameMatch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function batchSearchText(messages: Doc<"whatsappMessages">[]) {
  return normalizeNameMatch(
    messages
      .flatMap((message) => [
        message.text,
        ...message.media.map((media) => media.transcription ?? ""),
      ])
      .join("\n"),
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

  return normalizeWhitespace(
    [
      project.name,
      customer?.name,
      customer?.contactName,
      project.location,
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

  const embeddings = await embedTextsWithVoyage([
    normalizedSearchText,
    ...projectDocuments.map((entry) => entry.document),
  ]);
  if (!embeddings) {
    return [];
  }

  const [queryEmbedding, ...projectEmbeddings] = embeddings;

  return projectDocuments
    .map((entry, index) => {
      const customer =
        entry.project.customerId !== undefined
          ? customerById.get(String(entry.project.customerId))
          : undefined;

      return {
        projectId: entry.project._id,
        projectName: entry.project.name,
        projectLocation: entry.project.location,
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

  const embeddings = await embedTextsWithVoyage([
    normalizedSearchText,
    ...customerDocuments.map((entry) => entry.document),
  ]);
  if (!embeddings) {
    return [];
  }

  const [queryEmbedding, ...customerEmbeddings] = embeddings;

  return customerDocuments
    .map((entry, index) => ({
      customerId: entry.customer._id,
      customerName: entry.customer.name,
      similarity: cosineSimilarity(queryEmbedding, customerEmbeddings[index] ?? []),
    }))
    .sort((left, right) => right.similarity - left.similarity);
}

const routingDecisionSchema = z.object({
  decision: z.union([
    z.literal("project"),
    z.literal("customer"),
    z.literal("ambiguous"),
    z.literal("none"),
  ]),
  confidence: z.number(),
  projectName: z.string().optional(),
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
      projectName: options.exactProjectMatches[0]!.name,
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
    topProjectHit.similarity - (nextProjectHit?.similarity ?? 0) >= 0.05
  ) {
    return {
      decision: "project",
      confidence: topProjectHit.similarity,
      projectName: topProjectHit.projectName,
      reason: "very_similar_project_match",
    };
  }

  if (
    topCustomerHit &&
    topCustomerHit.similarity >= VERY_SIMILAR_MATCH_THRESHOLD &&
    topCustomerHit.similarity - (nextCustomerHit?.similarity ?? 0) >= 0.05
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
  exactProjectMatches: Doc<"projects">[];
  exactCustomerMatches: Doc<"customers">[];
  projectHits: ProjectRoutingHit[];
  customerHits: CustomerRoutingHit[];
}): Promise<RoutingDecision> {
  const fallback = buildRoutingDecisionFallback(options);

  if (!process.env.AI_GATEWAY_API_KEY) {
    return fallback;
  }

  try {
    const result = await generateObject({
      model: gateway(process.env.AI_GATEWAY_ROUTING_MODEL ?? WHATSAPP_AGENT_MODEL),
      schema: routingDecisionSchema,
      prompt: [
        "Resolve project routing for a WhatsApp documentation batch.",
        "Use only the combined message text, transcripts, and the provided candidate project/customer metadata as evidence.",
        "Choose 'project' only when one provided project is the strongest clearly supported match.",
        "Choose 'customer' only when one provided customer is clear but the project is still unclear.",
        "Choose 'ambiguous' when multiple provided projects or customers remain plausible, or the evidence conflicts.",
        "Choose 'none' when the text is generic, missing, or too weak. Prefer 'none' over guessing.",
        "Use only the provided names. Never invent, paraphrase, or normalize to unseen names.",
        "Set confidence between 0 and 1. Lower confidence when the evidence comes mostly from noisy transcript or OCR text.",
        "If decision is 'project', set projectName exactly as provided. If decision is 'customer', set customerName exactly as provided. Otherwise omit both.",
        "Keep reason short, snake_case, and free of entity names.",
        "Context:",
        JSON.stringify({
          searchText: options.searchText,
          exactProjectMatches: options.exactProjectMatches.map((project) => project.name),
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

function matchProjectByName(projects: Doc<"projects">[], projectName: string | undefined) {
  const normalizedProjectName = normalizeWhitespace(projectName);
  if (!normalizedProjectName) {
    return null;
  }

  return (
    projects.find((project) => normalizeNameMatch(project.name) === normalizeNameMatch(normalizedProjectName)) ??
    null
  );
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
    options.projectHits.filter((hit) => hit.customerId === options.customerId),
  );

  if (ranked.length === 0) {
    return scopedProjects
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_PROJECT_OPTIONS);
  }

  const remaining = scopedProjects
    .filter((project) => !ranked.some((rankedProject) => rankedProject._id === project._id))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...ranked, ...remaining].slice(0, MAX_PROJECT_OPTIONS);
}

function buildRoutingContextText(options: {
  projectHits: ProjectRoutingHit[];
  customerHits: CustomerRoutingHit[];
}) {
  const projectLines = options.projectHits
    .filter((hit) => hit.similarity >= ROUTING_CONTEXT_MIN_SIMILARITY)
    .slice(0, ROUTING_CONTEXT_LIMIT)
    .map((hit) => {
      const details = [
        hit.projectLocation ? `location ${hit.projectLocation}` : null,
        hit.customerName ? `customer ${hit.customerName}` : null,
      ].filter((detail): detail is string => detail !== null);
      const detailsText = details.length > 0 ? `${details.join(", ")}, ` : "";
      return `- ${hit.projectName} (${detailsText}similarity ${hit.similarity.toFixed(2)})`;
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

function suggestProjectName(messages: Doc<"whatsappMessages">[], batchCreatedAt: number) {
  for (const message of messages) {
    const sourceText = normalizeWhitespace(message.text);
    if (!sourceText || sourceText.startsWith("/")) {
      continue;
    }

    const firstLine = normalizeWhitespace(sourceText.split("\n")[0] ?? "");
    const candidate = firstLine ? truncateText(firstLine, MAX_PROJECT_NAME_LENGTH) : undefined;

    if (candidate && normalizeProjectName(candidate)) {
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

  if (!process.env.AI_GATEWAY_API_KEY) {
    return fallback;
  }

  try {
    const result = await generateObject({
      model: gateway(
        process.env.AI_GATEWAY_BATCH_SUMMARY_MODEL ??
          process.env.AI_GATEWAY_MODEL ??
          WHATSAPP_AGENT_MODEL,
      ),
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
      mimeType: asset.mimeType,
      kind: asset.kind,
      transcript: asset.transcript,
      extractedText: asset.extractedText,
      summary: asset.summary,
      keywords: asset.keywords,
      fieldLocales: asset.fieldLocales,
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
          processingStatus: "processed",
        },
      )) as Id<"whatsappMediaAssets">;

      assetsByKey.set(key, {
        mediaAssetId,
        mimeType: media.contentType,
        kind: kindFromMimeType(media.contentType),
        transcript: media.transcription,
      });
    }
  }

  return assetsByKey;
}

async function resolveProjectChoice(data: BatchProcessingData) {
  const suggestedProjectName = suggestProjectName(data.messages, data.batch.createdAt);

  if (data.projects.length === 0) {
    return {
      kind: "need_name" as const,
      suggestedProjectName,
      reason: "no_active_projects",
      routingContext: null,
    };
  }

  const searchText = batchSearchText(data.messages);
  const exactProjectMatches = data.projects.filter((project) =>
    hasExactNameMention(searchText, project.name),
  );
  const exactCustomerMatches = data.customers.filter(
    (customer) =>
      hasExactNameMention(searchText, customer.name) ||
      hasExactNameMention(searchText, customer.contactName),
  );

  let projectHits: ProjectRoutingHit[] = [];
  let customerHits: CustomerRoutingHit[] = [];

  try {
    [projectHits, customerHits] = await Promise.all([
      searchSimilarProjectsByEmbedding(data.projects, data.customers, searchText),
      searchSimilarCustomersByEmbedding(data.customers, searchText),
    ]);
  } catch (error) {
    console.error("WhatsApp routing similarity search failed", error);
  }

  const routingDecision = await resolveRoutingDecision({
    searchText,
    exactProjectMatches,
    exactCustomerMatches,
    projectHits,
    customerHits,
  });
  const routingContext = buildRoutingContextText({
    projectHits,
    customerHits,
  });

  const matchedProject = matchProjectByName(data.projects, routingDecision.projectName);
  if (
    routingDecision.decision === "project" &&
    matchedProject &&
    routingDecision.confidence >= AUTO_ATTACH_MIN_CONFIDENCE
  ) {
    return {
      kind: "selected" as const,
      project: matchedProject,
      reason: routingDecision.reason,
      confidence: routingDecision.confidence,
      routingContext,
    };
  }

  const matchedCustomer = matchCustomerByName(data.customers, routingDecision.customerName);
  if (
    routingDecision.decision === "customer" &&
    matchedCustomer &&
    routingDecision.confidence >= AUTO_ATTACH_MIN_CONFIDENCE
  ) {
    const customerProjects = selectProjectsForCustomer({
      projects: data.projects,
      customerId: matchedCustomer._id,
      projectHits,
    });

    if (customerProjects.length === 1) {
      return {
        kind: "selected" as const,
        project: customerProjects[0]!,
        reason: routingDecision.reason,
        confidence: routingDecision.confidence,
        routingContext,
      };
    }

    if (customerProjects.length > 1) {
      return {
        kind: "choose" as const,
        options: customerProjects,
        reason: routingDecision.reason,
        suggestedProjectName,
        customerId: matchedCustomer._id,
        routingContext,
      };
    }

    return {
      kind: "need_name" as const,
      suggestedProjectName,
      customerId: matchedCustomer._id,
      reason: routingDecision.reason,
      routingContext,
    };
  }

  const similarProjectOptions = selectProjectOptionsFromHits(
    data.projects,
    projectHits.filter((hit) => hit.similarity >= VERY_SIMILAR_MATCH_THRESHOLD),
  );

  if (similarProjectOptions.length > 1 || (routingDecision.decision === "ambiguous" && similarProjectOptions.length > 0)) {
    return {
      kind: "choose" as const,
      options: similarProjectOptions.slice(0, MAX_PROJECT_OPTIONS),
      reason: routingDecision.reason,
      suggestedProjectName,
      routingContext,
    };
  }

  return {
    kind: "need_name" as const,
    suggestedProjectName,
    reason: routingDecision.reason,
    routingContext,
  };
}

async function finalizePreparedBatch(
  ctx: {
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
  },
  options: {
    data: BatchProcessingData;
    projectId: Id<"projects">;
    projectName: string;
    locale: AppLocale;
  },
): Promise<FinalizeResult> {
  const addedByName = await resolveAddedByName(ctx, options.data.batch);
  const mediaAssetsByKey = await ensureMediaAssets(ctx, options.data);
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
    const extractedText = normalizeWhitespace(
      messageMediaAssets
        .map((asset) => asset.extractedText ?? "")
        .join("\n"),
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

    return {
      messageId: message._id,
      addedAt: message.createdAt,
      sourceText,
      text: sourceText,
      transcript,
      extractedText,
      summary,
      keywords,
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
      projectName: options.projectName,
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

      const choice = await resolveProjectChoice(data);

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
          projectName: choice.project.name,
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
          aiSuggestedProjectName: choice.suggestedProjectName,
        });

        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: data.batch.phoneE164,
          locale,
          text: documentationProjectNamePrompt({
            locale,
            suggestedProjectName: choice.suggestedProjectName,
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
        options: choice.options.map((project) => ({
          projectId: project._id,
          projectName: project.name,
        })),
        aiSuggestedProjectName: choice.suggestedProjectName,
      });

      await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: data.batch.phoneE164,
        locale,
        text: documentationProjectChoiceMessage({
          locale,
          projects: choice.options.map((project) => ({
            name: project.name,
          })),
          suggestedProjectName: choice.suggestedProjectName,
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
        projectMatchReason: "selected_by_member",
        candidateProjectIds: [selectedProject._id],
      });

      return await finalizePreparedBatch(ctx, {
        data,
        projectId: selectedProject._id,
        projectName: selectedProject.name,
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
    projectName: v.string(),
    customerId: v.optional(v.id("customers")),
    locale: v.union(v.literal("en"), v.literal("de")),
  },
  returns: v.object({
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<{ message: string }> => {
    const data = await loadBatchData(ctx, args.batchId);

    if (!data) {
      throw new ConvexError("Batch not found.");
    }

    const normalizedProjectName = normalizeProjectName(args.projectName);
    if (!normalizedProjectName) {
      throw new ConvexError("Project name is invalid.");
    }

    const existingProject =
      data.projects.find(
        (project) =>
          project.customerId === args.customerId &&
          normalizeNameMatch(project.name) === normalizeNameMatch(normalizedProjectName),
      ) ??
      data.projects.find(
        (project) => normalizeNameMatch(project.name) === normalizeNameMatch(normalizedProjectName),
      ) ??
      null;

    try {
      await ctx.runMutation((internal as any).whatsappProcessingData.clearPendingResolutionByBatch, {
        batchId: args.batchId,
      });
      await ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: args.batchId,
        status: "processing",
        error: "",
        projectId: existingProject?._id,
        projectMatchReason: existingProject ? "selected_by_name" : "created_from_whatsapp",
        candidateProjectIds: existingProject ? [existingProject._id] : [],
      });

      const projectId =
        existingProject?._id ??
        ((await ctx.runMutation((internal as any).whatsappProcessingData.createProjectForOrganization, {
          organizationId: data.batch.organizationId,
          createdBy: data.batch.userId,
          customerId: args.customerId,
          name: normalizedProjectName,
        })) as Id<"projects">);

      return await finalizePreparedBatch(ctx, {
        data,
        projectId,
        projectName: existingProject?.name ?? normalizedProjectName,
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
  buildProjectSearchDocument,
  buildRoutingContextText,
};
