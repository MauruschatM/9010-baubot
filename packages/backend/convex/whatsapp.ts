'use node';

import type { AppLocale } from "@mvp-template/i18n";
import { v } from "convex/values";

import { vAppLocale } from "./lib/locales";
import { cosineSimilarity, embedTextsWithVoyage } from "./lib/voyage";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { createAuth } from "./auth";
import { getMastraWhatsAppThreadId } from "./mastraComponent/constants";
import {
  WHATSAPP_OUTBOUND_CHUNK_DELAY_MS,
  WHATSAPP_OUTBOUND_CHUNK_HARD_LIMIT_CHARS,
  WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS,
  WHATSAPP_OUTBOUND_MAX_CHUNKS,
  WHATSAPP_ONBOARDING_TTL_MS,
  WHATSAPP_THREAD_READINESS_BUFFER_MS,
} from "./whatsapp/constants";
import {
  askPasswordMessage,
  documentationBusyMessage,
  documentationCapturedMessage,
  documentationEmptyMessage,
  documentationInProgressMessage,
  documentationProjectChoiceMessage,
  documentationProjectLocationLengthMessage,
  documentationProjectLocationPrompt,
  formatProjectChoiceOption,
  documentationStartedMessage,
  invalidEmailMessage,
  invalidPasswordMessage,
  onboardingCompletedMessage,
  onboardingGreetingMessages,
  onboardingPasswordAttemptsExceededMessage,
  onboardingSwitchHintMessage,
  pendingVoiceReplyTypingFallbackMessage,
  processingFallbackMessage,
  readyQuestionMessage,
  switchPromptMessage,
  switchSuccessMessage,
  unlinkConfirmationMessage,
  unlinkSuccessMessage,
  unsupportedCommandMessage,
  waitForMoreMessage,
} from "./whatsapp/messages";
import {
  extractDocumentationTextFromSendCommand,
  extractEmailCandidate,
  inferLocaleFromPhoneNumber,
  isAffirmativeAnswer,
  isNegativeCommand,
  isSendCommand,
  isSwitchCommand,
  isUnlinkCommand,
  normalizeCommandText,
  normalizePhoneNumber,
  slugFromOrganizationSeed,
} from "./whatsapp/normalize";
import {
  isTranscribableWhatsAppContentType,
  transcribeWhatsAppMedia,
} from "./whatsapp/transcription";
import {
  getConfiguredTwilioWhatsAppFromNumber,
  parseTwilioInboundPayload,
  sendTwilioWhatsAppMessage,
  sendTwilioWhatsAppTypingIndicator,
  validateTwilioSignature,
} from "./whatsapp/twilio";
import type { StoredWhatsAppMedia, TwilioInboundPayload } from "./whatsapp/types";
import { getSessionHeadersForUser } from "./serviceSessions";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: number;
};

type UserDoc = {
  _id: string;
  name: string;
  email: string;
  image?: string | null;
};

type OrganizationDoc = {
  _id: string;
  name: string;
  slug: string;
  logo?: string | null;
};

type InvitationDoc = {
  _id: string;
  organizationId: string;
  email: string;
  role?: string | null;
  status: string;
};

type WhatsAppConnectionDoc = {
  _id: Id<"whatsappConnections">;
  organizationId: string;
  memberId: string;
  userId: string;
  phoneNumberE164: string;
  phoneNumberDigits: string;
  status: "active" | "disconnected";
  createdAt: number;
  updatedAt: number;
  disconnectedAt?: number;
};

type WhatsAppTurnBufferDoc = {
  _id: Id<"whatsappTurnBuffers">;
  connectionId: Id<"whatsappConnections">;
  organizationId: string;
  userId: string;
  memberId: string;
  threadId: string;
  status: "buffering" | "awaiting_confirmation" | "awaiting_documentation_confirmation";
  bufferedMessageIds: Id<"whatsappMessages">[];
  firstBufferedAt: number;
  lastBufferedAt: number;
  readyPromptSentAt?: number;
  documentationPromptSentAt?: number;
  documentationReminderJobId?: Id<"_scheduled_functions">;
  updatedAt: number;
};

type WhatsAppPendingResolutionDoc = {
  _id: Id<"whatsappPendingResolutions">;
  organizationId: string;
  phoneE164: string;
  memberId: string;
  batchId: Id<"whatsappSendBatches">;
  state: "awaiting_choice" | "awaiting_project_name";
  customerId?: Id<"customers">;
  options?: PendingProjectChoiceOption[];
  aiSuggestedProjectName?: string;
  createdAt: number;
  updatedAt: number;
};

type PendingProjectChoiceOption = {
  projectId: Id<"projects">;
  location: string;
  customerName?: string;
};

type OnboardingSessionDoc = {
  _id: Id<"whatsappOnboardingSessions">;
  phoneNumberE164: string;
  status: "active" | "completed" | "expired";
  stage:
    | "awaiting_email"
    | "awaiting_password"
    | "awaiting_switch_selection"
    | "awaiting_unlink_confirmation"
    | "ready";
  locale: AppLocale;
  email?: string;
  userId?: string;
  organizationId?: string;
  memberId?: string;
  pendingOrganizations?: Array<{
    organizationId: string;
    organizationName: string;
    memberId: string;
  }>;
  otpAttempts: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

type PendingReplyInput = {
  text: string;
  source: "body" | "transcript" | "none";
  hadMedia: boolean;
  transcriptionAttempted: boolean;
};

type PendingHandlingResult = {
  handled: boolean;
  reply?: string | null;
  batchId?: Id<"whatsappSendBatches">;
  deliveryStage?: "pre_persistence" | "post_persistence";
};

type PendingProjectChoiceHit = {
  option: PendingProjectChoiceOption;
  similarity: number;
};

const PENDING_CHOICE_MATCH_THRESHOLD = 0.87;
const PENDING_CHOICE_MATCH_GAP = 0.05;

type AuthApiClient = {
  api?: unknown;
};

type OrganizationSelection = {
  organizationId: string;
  organizationName: string;
  memberId: string;
};

const PAGE_SIZE = 200;
const MAX_MESSAGE_TEXT = 2500;
const MAX_ONBOARDING_AUTH_ATTEMPTS = 6;
const WHATSAPP_ONBOARDING_PLACEHOLDER_NAME = " ";

function toLocale(value: string | undefined) {
  return value === "de" ? "de" : "en";
}

async function resolveInboundLocale(options: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  phoneNumberE164: string;
  userId?: string | null;
}) {
  const localeFromPhone = inferLocaleFromPhoneNumber(options.phoneNumberE164);
  if (!options.userId) {
    return localeFromPhone;
  }

  const userPreferenceLocale = (await options.runQuery(
    internal.whatsappData.getUserLocaleByUserId,
    {
      userId: options.userId,
    },
  )) as "en" | "de" | null;

  return toLocale(userPreferenceLocale ?? localeFromPhone);
}

function clampMessageText(value: string) {
  return value.trim().slice(0, MAX_MESSAGE_TEXT);
}

function isNewProjectCommand(value: string) {
  const normalized = normalizeCommandText(value);

  return (
    normalized === "new" ||
    normalized === "neu" ||
    normalized === "new project" ||
    normalized === "neues projekt"
  );
}

function normalizeProjectLocationCandidate(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length < 2 || normalized.length > 120) {
    return null;
  }

  return normalized;
}

async function fetchInboundMediaBlob(mediaItem: TwilioInboundPayload["media"][number]) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return null;
  }

  try {
    const mediaResponse = await fetch(mediaItem.mediaUrl, {
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      },
    });

    if (!mediaResponse.ok) {
      return null;
    }

    return await mediaResponse.blob();
  } catch {
    return null;
  }
}

async function transcribePendingReplyMedia(options: {
  locale: AppLocale;
  media: TwilioInboundPayload["media"];
}) {
  const transcriptions: string[] = [];
  let transcriptionAttempted = false;

  for (const mediaItem of options.media) {
    if (!isTranscribableWhatsAppContentType(mediaItem.contentType)) {
      continue;
    }

    transcriptionAttempted = true;
    try {
      const mediaBlob = await fetchInboundMediaBlob(mediaItem);
      if (!mediaBlob) {
        continue;
      }

      const mediaBytes = new Uint8Array(await mediaBlob.arrayBuffer());
      const transcriptionResult = await transcribeWhatsAppMedia({
        fileBytes: mediaBytes,
        contentType: mediaItem.contentType,
      });

      const normalizedTranscription = clampMessageText(transcriptionResult?.text ?? "");
      if (normalizedTranscription) {
        transcriptions.push(normalizedTranscription);
      }
    } catch {
      // Keep trying other media items so a single failed fetch/transcription does not abort reply handling.
    }
  }

  return {
    text: transcriptions.join("\n").trim(),
    transcriptionAttempted,
  };
}

async function buildStoredInboundMediaEntries(options: {
  locale: AppLocale;
  media: TwilioInboundPayload["media"];
  store: (blob: Blob) => Promise<Id<"_storage">>;
}) {
  const mediaEntries: StoredWhatsAppMedia[] = [];

  for (const mediaItem of options.media) {
    try {
      const mediaBlob = await fetchInboundMediaBlob(mediaItem);
      if (!mediaBlob) {
        continue;
      }

      const mediaBytes = new Uint8Array(await mediaBlob.arrayBuffer());
      const storageId = await options.store(mediaBlob);
      const transcriptionResult = await transcribeWhatsAppMedia({
        fileBytes: mediaBytes,
        contentType: mediaItem.contentType,
      });

      mediaEntries.push({
        storageId,
        contentType: mediaItem.contentType,
        fileName: mediaItem.fileName,
        mediaUrl: mediaItem.mediaUrl,
        transcription: transcriptionResult?.text ?? undefined,
        transcriptionLocale: transcriptionResult?.detectedLocale ?? undefined,
        transcriptionModel: transcriptionResult ? "groq:whisper-large-v3" : undefined,
      });
    } catch {
      // Skip failed media item.
    }
  }

  return mediaEntries;
}

type StoredInboundMediaResolver = typeof buildStoredInboundMediaEntries;

export async function persistInboundDocumentationMessage(options: {
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    storage: {
      store: (blob: Blob) => Promise<Id<"_storage">>;
    };
  };
  locale: AppLocale;
  payload: TwilioInboundPayload;
  phoneNumberE164: string;
  connection: WhatsAppConnectionDoc;
  threadId: string;
  bodyText: string;
  resolveMediaEntries?: StoredInboundMediaResolver;
}) {
  const resolveMediaEntries =
    options.resolveMediaEntries ?? buildStoredInboundMediaEntries;
  const mediaEntries = await resolveMediaEntries({
    locale: options.locale,
    media: options.payload.media,
    store: options.ctx.storage.store,
  });
  const normalizedBody = clampMessageText(options.bodyText);

  if (!normalizedBody && mediaEntries.length === 0) {
    return null;
  }

  const insertedMessage = (await options.ctx.runMutation(
    internal.whatsappData.insertWhatsAppMessage,
    {
      providerMessageSid: options.payload.messageSid,
      direction: "inbound",
      phoneNumberE164: options.phoneNumberE164,
      connectionId: options.connection._id,
      organizationId: options.connection.organizationId,
      userId: options.connection.userId,
      memberId: options.connection.memberId,
      threadId: options.threadId,
      text: normalizedBody,
      media: mediaEntries,
      turnStatus: "buffered",
    },
  )) as { id: Id<"whatsappMessages"> };

  await options.ctx.runMutation(internal.whatsappData.addMessageToTurnBuffer, {
    connectionId: options.connection._id,
    organizationId: options.connection.organizationId,
    userId: options.connection.userId,
    memberId: options.connection.memberId,
    threadId: options.threadId,
    messageId: insertedMessage.id,
  });

  return insertedMessage.id;
}

export async function resolvePendingReplyInput(options: {
  body: string;
  locale: AppLocale;
  media: TwilioInboundPayload["media"];
  resolveTranscript?: (
    media: TwilioInboundPayload["media"],
  ) => Promise<string | null>;
}): Promise<PendingReplyInput> {
  const normalizedBody = clampMessageText(options.body);
  if (normalizedBody) {
    return {
      text: normalizedBody,
      source: "body",
      hadMedia: options.media.length > 0,
      transcriptionAttempted: false,
    };
  }

  const hadMedia = options.media.length > 0;
  const transcribableMedia = options.media.filter((mediaItem) =>
    isTranscribableWhatsAppContentType(mediaItem.contentType),
  );
  if (transcribableMedia.length === 0) {
    return {
      text: "",
      source: "none",
      hadMedia,
      transcriptionAttempted: false,
    };
  }

  let resolvedTranscript: string | null = null;
  try {
    resolvedTranscript = options.resolveTranscript
      ? await options.resolveTranscript(transcribableMedia)
      : (await transcribePendingReplyMedia({
          locale: options.locale,
          media: transcribableMedia,
        })).text;
  } catch (error) {
    console.warn("Failed to resolve WhatsApp pending reply transcript", {
      mediaCount: transcribableMedia.length,
      message: errorMessageFromUnknown(error),
    });
  }

  const normalizedTranscript = clampMessageText(resolvedTranscript ?? "");
  return {
    text: normalizedTranscript,
    source: normalizedTranscript ? "transcript" : "none",
    hadMedia,
    transcriptionAttempted: true,
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function splitByWordBoundary(value: string, maxChars: number) {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  const flushCurrent = () => {
    if (!current) {
      return;
    }
    chunks.push(current.trim());
    current = "";
  };

  for (const word of words) {
    if (word.length > maxChars) {
      flushCurrent();
      for (let index = 0; index < word.length; index += maxChars) {
        chunks.push(word.slice(index, index + maxChars));
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    flushCurrent();
    current = word;
  }

  flushCurrent();
  return chunks;
}

function splitParagraphIntoSemanticSegments(paragraph: string) {
  const normalized = paragraph.trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS) {
    return [normalized];
  }

  const sentenceCandidates =
    normalized
      .replace(/\s+/g, " ")
      .match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) ?? [];

  if (sentenceCandidates.length > 1) {
    const packed: string[] = [];
    let current = "";

    const flushCurrent = () => {
      if (!current) {
        return;
      }
      packed.push(current.trim());
      current = "";
    };

    for (const sentence of sentenceCandidates) {
      if (sentence.length > WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS) {
        flushCurrent();
        packed.push(
          ...splitByWordBoundary(
            sentence,
            WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS,
          ),
        );
        continue;
      }

      if (!current) {
        current = sentence;
        continue;
      }

      const candidate = `${current} ${sentence}`;
      if (candidate.length <= WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS) {
        current = candidate;
        continue;
      }

      flushCurrent();
      current = sentence;
    }

    flushCurrent();
    if (packed.length > 0) {
      return packed;
    }
  }

  return splitByWordBoundary(normalized, WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS);
}

function splitOutboundTextForWhatsApp(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const semanticSegments =
    paragraphs.length > 0
      ? paragraphs.flatMap((paragraph) =>
          splitParagraphIntoSemanticSegments(paragraph),
        )
      : splitParagraphIntoSemanticSegments(normalized);

  if (semanticSegments.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  const flushCurrent = () => {
    if (!current) {
      return;
    }
    chunks.push(current.trim());
    current = "";
  };

  for (const segment of semanticSegments) {
    if (!current) {
      current = segment;
      continue;
    }

    const candidate = `${current}\n\n${segment}`;
    if (candidate.length <= WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS) {
      current = candidate;
      continue;
    }

    flushCurrent();
    current = segment;
  }

  flushCurrent();

  const hardLimited = chunks.flatMap((chunk) => {
    if (chunk.length <= WHATSAPP_OUTBOUND_CHUNK_HARD_LIMIT_CHARS) {
      return [chunk];
    }

    return splitByWordBoundary(chunk, WHATSAPP_OUTBOUND_CHUNK_HARD_LIMIT_CHARS);
  });

  return hardLimited
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .slice(0, WHATSAPP_OUTBOUND_MAX_CHUNKS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRecordString(value: Record<string, unknown>, key: string): string | null {
  const maybeValue = value[key];
  if (typeof maybeValue !== "string") {
    return null;
  }

  const trimmed = maybeValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Operation failed";
}

function normalizeOrganizationInfo(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const id = getRecordString(value, "id") ?? getRecordString(value, "_id");
  const name = getRecordString(value, "name");
  const slug = getRecordString(value, "slug");
  const logoRaw = value.logo;
  const logo = typeof logoRaw === "string" ? logoRaw : null;

  if (!id || !name || !slug) {
    return null;
  }

  return {
    id,
    name,
    slug,
    logo,
  };
}

function normalizeUserInfo(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.user) ? value.user : value;
  const id = getRecordString(candidate, "_id") ?? getRecordString(candidate, "id");
  const email = getRecordString(candidate, "email");
  const fallbackNameFromEmail = email ? email.split("@")[0]?.trim() : null;
  const name = getRecordString(candidate, "name") ?? fallbackNameFromEmail ?? "User";
  const imageRaw = candidate.image;
  const image = typeof imageRaw === "string" ? imageRaw : null;

  if (!id || !email) {
    return null;
  }

  return {
    id,
    name,
    email,
    image,
  };
}

async function callAuthApi(
  auth: AuthApiClient,
  methodName: string,
  context: Record<string, unknown>,
) {
  const apiRecord = isRecord(auth.api)
    ? (auth.api as Record<string, unknown>)
    : undefined;
  const method = apiRecord?.[methodName];
  if (typeof method !== "function") {
    throw new Error(`Better Auth API method '${methodName}' is not available`);
  }

  return await (method as (context: Record<string, unknown>) => Promise<unknown>)(
    context,
  );
}

function buildWhatsAppOutboundConfigurationError() {
  const missing: string[] = [];
  if (!process.env.TWILIO_ACCOUNT_SID) {
    missing.push("TWILIO_ACCOUNT_SID");
  }
  if (!process.env.TWILIO_AUTH_TOKEN) {
    missing.push("TWILIO_AUTH_TOKEN");
  }
  if (!getConfiguredTwilioWhatsAppFromNumber()) {
    missing.push("TWILIO_WHATSAPP_FROM_NUMBER");
  }

  return `WhatsApp outbound messaging is not fully configured (${missing.join(", ")}).`;
}

function buildWhatsAppDeliveryError(error: unknown) {
  return `WhatsApp delivery failed: ${errorMessageFromUnknown(error)}`;
}

type OutboundMessageDeliveryResult =
  | { ok: true }
  | { ok: false; error: string };

async function sendOutboundMessage(options: {
  text: string;
  phoneNumberE164: string;
  locale: AppLocale;
  connection: WhatsAppConnectionDoc | null;
  runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<OutboundMessageDeliveryResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = getConfiguredTwilioWhatsAppFromNumber();

  if (!accountSid || !authToken || !fromNumber) {
    return {
      ok: false,
      error: buildWhatsAppOutboundConfigurationError(),
    };
  }

  const body = options.text.trim();
  if (!body) {
    return {
      ok: false,
      error: "WhatsApp outbound message body is empty.",
    };
  }

  const chunks = splitOutboundTextForWhatsApp(body);
  if (chunks.length === 0) {
    return {
      ok: false,
      error: "WhatsApp outbound message body is empty.",
    };
  }

  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunkIndex > 0) {
      await sleep(WHATSAPP_OUTBOUND_CHUNK_DELAY_MS);
    }

    let twilioResponse: Awaited<ReturnType<typeof sendTwilioWhatsAppMessage>>;
    try {
      twilioResponse = await sendTwilioWhatsAppMessage({
        accountSid,
        authToken,
        fromNumber,
        toNumber: options.phoneNumberE164,
        body: chunk,
      });
    } catch (error) {
      return {
        ok: false,
        error: errorMessageFromUnknown(error),
      };
    }

    await options.runMutation(internal.whatsappData.insertWhatsAppMessage, {
      providerMessageSid: twilioResponse.sid,
      direction: "outbound",
      phoneNumberE164: options.phoneNumberE164,
      connectionId: options.connection?._id,
      organizationId: options.connection?.organizationId,
      userId: options.connection?.userId,
      memberId: options.connection?.memberId,
      threadId: options.connection
        ? getMastraWhatsAppThreadId({
            organizationId: options.connection.organizationId,
            memberId: options.connection.memberId,
          })
        : undefined,
      text: chunk,
      media: [],
      turnStatus: "ignored",
    });
  }

  return { ok: true };
}

async function resolveUserOrganizations(ctx: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, userId: string) {
  const membersResult = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: PAGE_SIZE,
    },
  })) as { page?: MemberDoc[] };

  const members = (membersResult.page ?? []) as MemberDoc[];
  if (members.length === 0) {
    return [];
  }

  const organizationIds = [...new Set(members.map((member) => member.organizationId))];
  const organizationsResult = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "organization",
    where: [
      {
        field: "_id",
        operator: "in",
        value: organizationIds,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: PAGE_SIZE,
    },
  })) as { page?: OrganizationDoc[] };

  const organizations = (organizationsResult.page ?? []) as OrganizationDoc[];
  const organizationById = new Map(organizations.map((organization) => [organization._id, organization]));

  return members
    .map((member) => {
      const organization = organizationById.get(member.organizationId);
      if (!organization) {
        return null;
      }

      return {
        organizationId: organization._id,
        organizationName: organization.name,
        memberId: member._id,
      } satisfies OrganizationSelection;
    })
    .filter((entry): entry is OrganizationSelection => !!entry);
}

async function createOrganizationForUser(options: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  user: UserDoc;
}) {
  const auth = createAuth(options as any);
  const baseName = options.user.name?.trim() || options.user.email.split("@")[0] || "Workspace";
  const orgName = `${baseName} Workspace`;

  const created = await callAuthApi(auth, "createOrganization", {
    body: {
      userId: options.user._id,
      name: orgName,
      slug: slugFromOrganizationSeed(orgName),
    },
    headers: new Headers(),
  });

  const organization = normalizeOrganizationInfo(created);
  if (!organization) {
    throw new Error("Failed to create organization");
  }

  const membersResult = (await options.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [
      {
        field: "organizationId",
        operator: "eq",
        value: organization.id,
      },
      {
        field: "userId",
        operator: "eq",
        value: options.user._id,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: 10,
    },
  })) as { page?: MemberDoc[] };

  const member = (membersResult.page ?? [])[0] as MemberDoc | undefined;
  if (!member) {
    throw new Error("Failed to create organization membership");
  }

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    memberId: member._id,
  } satisfies OrganizationSelection;
}

async function autoAcceptInvitationsForEmail(options: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  userId: string;
  email: string;
}) {
  const auth = createAuth(options as any);
  const sessionHeaders = await getSessionHeadersForUser(options, options.userId);

  const invitationsResult = (await options.runQuery(components.betterAuth.adapter.findMany, {
    model: "invitation",
    where: [
      {
        field: "email",
        operator: "eq",
        value: options.email,
      },
      {
        field: "status",
        operator: "eq",
        value: "pending",
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: PAGE_SIZE,
    },
  })) as { page?: InvitationDoc[] };

  const invitations = (invitationsResult.page ?? []) as InvitationDoc[];
  for (const invitation of invitations) {
    try {
      await callAuthApi(auth, "acceptInvitation", {
        body: {
          invitationId: invitation._id,
        },
        headers: sessionHeaders,
      });
    } catch {
      // Keep processing other invitations.
    }
  }
}

function buildPendingVoiceReplyPrompt(locale: AppLocale, prompt: string) {
  return [pendingVoiceReplyTypingFallbackMessage(locale), prompt].join("\n\n");
}

function normalizeWhitespace(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function findDominantPendingChoiceHit(hits: PendingProjectChoiceHit[]) {
  const [topHit, nextHit] = hits;
  if (!topHit) {
    return null;
  }

  if (
    topHit.similarity < PENDING_CHOICE_MATCH_THRESHOLD ||
    topHit.similarity - (nextHit?.similarity ?? 0) < PENDING_CHOICE_MATCH_GAP
  ) {
    return null;
  }

  return topHit;
}

async function searchPendingProjectChoiceOptionsByEmbedding(
  optionsList: PendingProjectChoiceOption[],
  searchText: string,
): Promise<PendingProjectChoiceHit[]> {
  const normalizedSearchText = normalizeWhitespace(searchText);
  if (optionsList.length === 0 || !normalizedSearchText) {
    return [];
  }

  const optionDocuments = optionsList
    .map((option) => ({
      option,
      document: normalizeWhitespace(
        [
          formatProjectChoiceOption(option),
          option.location,
          option.customerName,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    }))
    .filter(
      (
        entry,
      ): entry is { option: PendingProjectChoiceOption; document: string } =>
        typeof entry.document === "string",
    );

  if (optionDocuments.length === 0) {
    return [];
  }

  const [queryEmbeddings, optionEmbeddings] = await Promise.all([
    embedTextsWithVoyage([normalizedSearchText], {
      inputType: "query",
    }),
    embedTextsWithVoyage(
      optionDocuments.map((entry) => entry.document),
      {
        inputType: "document",
      },
    ),
  ]);

  if (!(queryEmbeddings?.[0] && optionEmbeddings)) {
    return [];
  }

  const queryEmbedding = queryEmbeddings[0];

  return optionDocuments
    .map((entry, index) => ({
      option: entry.option,
      similarity: cosineSimilarity(queryEmbedding, optionEmbeddings[index] ?? []),
    }))
    .sort((left, right) => right.similarity - left.similarity);
}

async function recordPendingReplyDeliveryFailure(options: {
  runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
  batchId: Id<"whatsappSendBatches">;
  deliveryStage: "pre_persistence" | "post_persistence";
  error: unknown;
}) {
  const mutationArgs: Record<string, unknown> = {
    batchId: options.batchId,
    error: buildWhatsAppDeliveryError(options.error),
  };

  if (options.deliveryStage === "pre_persistence") {
    mutationArgs.status = "failed";
  }

  await options.runMutation((internal as any).whatsappProcessingData.updateSendBatch, mutationArgs);
}

async function sendPendingHandlingReply(options: {
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: AppLocale;
  connection: WhatsAppConnectionDoc;
  result: PendingHandlingResult;
}) {
  if (!options.result.reply) {
    return;
  }

  const deliveryResult = (await options.ctx.runAction(
    (internal as any).whatsapp.sendSystemMessage,
    {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: options.result.reply,
      connectionId: options.connection._id,
    },
  )) as OutboundMessageDeliveryResult;

  if (!deliveryResult.ok && options.result.batchId && options.result.deliveryStage) {
    await recordPendingReplyDeliveryFailure({
      runMutation: options.ctx.runMutation,
      batchId: options.result.batchId,
      deliveryStage: options.result.deliveryStage,
      error: deliveryResult.error,
    });
  }
}

export async function handlePendingProjectResolution(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: AppLocale;
  resolvePendingReplyInput: () => Promise<PendingReplyInput>;
  connection: WhatsAppConnectionDoc;
}): Promise<PendingHandlingResult> {
  const pendingResolution = (await options.ctx.runQuery(
    (internal as any).whatsappProcessingData.getPendingResolutionByPhone,
    {
      organizationId: options.connection.organizationId,
      phoneE164: options.connection.phoneNumberE164,
    },
  )) as WhatsAppPendingResolutionDoc | null;

  if (!pendingResolution) {
    return {
      handled: false,
    };
  }

  const pendingReplyInput = await options.resolvePendingReplyInput();
  const normalizedMessage = normalizeCommandText(pendingReplyInput.text);

  if (pendingResolution.state === "awaiting_choice") {
    const optionsList = pendingResolution.options ?? [];
    const choicePrompt = documentationProjectChoiceMessage({
      locale: options.locale,
      projects: optionsList.map((option) => ({
        location: option.location,
        customerName: option.customerName,
      })),
      suggestedProjectLocation: pendingResolution.aiSuggestedProjectName,
    });

    if (!normalizedMessage && pendingReplyInput.hadMedia) {
      return {
        handled: true,
        reply: buildPendingVoiceReplyPrompt(options.locale, choicePrompt),
        batchId: pendingResolution.batchId,
        deliveryStage: "pre_persistence",
      };
    }

    const numericChoice = Number.parseInt(normalizedMessage, 10);
    const exactChoiceMatches = optionsList.filter((option) => {
      if (normalizeCommandText(option.location) === normalizedMessage) {
        return true;
      }

      return normalizeCommandText(formatProjectChoiceOption(option)) === normalizedMessage;
    });
    const exactChoice = exactChoiceMatches.length === 1 ? exactChoiceMatches[0] : null;

    if (isNewProjectCommand(normalizedMessage)) {
      await options.ctx.runMutation((internal as any).whatsappProcessingData.updateSendBatch, {
        batchId: pendingResolution.batchId,
        status: "awaiting_project_name",
        candidateProjectIds: [],
        projectMatchReason: "member_requested_new_project",
      });
      await options.ctx.runMutation((internal as any).whatsappProcessingData.upsertPendingResolution, {
        organizationId: pendingResolution.organizationId,
        phoneE164: pendingResolution.phoneE164,
        memberId: pendingResolution.memberId,
        batchId: pendingResolution.batchId,
        state: "awaiting_project_name",
        customerId: pendingResolution.customerId,
        aiSuggestedProjectName: pendingResolution.aiSuggestedProjectName,
      });

      return {
        handled: true,
        reply: documentationProjectLocationPrompt({
          locale: options.locale,
          suggestedProjectLocation: pendingResolution.aiSuggestedProjectName,
        }),
        batchId: pendingResolution.batchId,
        deliveryStage: "pre_persistence",
      };
    }

    const exactOrNumericSelection =
      exactChoice ??
      (numericChoice >= 1 && numericChoice <= optionsList.length
        ? optionsList[numericChoice - 1]
        : null);

    let selectedOption = exactOrNumericSelection;
    let selectedOptionMatchReason: string | undefined;

    if (!selectedOption && pendingReplyInput.text) {
      try {
        const semanticChoiceHit = findDominantPendingChoiceHit(
          await searchPendingProjectChoiceOptionsByEmbedding(
            optionsList,
            pendingReplyInput.text,
          ),
        );

        if (semanticChoiceHit) {
          selectedOption = semanticChoiceHit.option;
          selectedOptionMatchReason = "semantic_pending_choice_match";
        }
      } catch (error) {
        console.error("WhatsApp pending project choice similarity search failed", {
          batchId: String(pendingResolution.batchId),
          phoneNumberE164: options.connection.phoneNumberE164,
          message: errorMessageFromUnknown(error),
        });
      }
    }

    if (!selectedOption) {
      return {
        handled: true,
        reply: choicePrompt,
        batchId: pendingResolution.batchId,
        deliveryStage: "pre_persistence",
      };
    }

    try {
      const result = (await options.ctx.runAction(
        (internal as any).whatsappProcessing.finalizeBatchToProject,
        {
          batchId: pendingResolution.batchId,
          projectId: selectedOption.projectId,
          locale: options.locale,
          matchReason: selectedOptionMatchReason,
        },
      )) as { message: string };

      return {
        handled: true,
        reply: result.message,
        batchId: pendingResolution.batchId,
        deliveryStage: "post_persistence",
      };
    } catch (error) {
      console.error("WhatsApp pending project choice resolution failed", {
        batchId: String(pendingResolution.batchId),
        phoneNumberE164: options.connection.phoneNumberE164,
        message: errorMessageFromUnknown(error),
      });
      return {
        handled: true,
        reply: processingFallbackMessage(options.locale),
      };
    }
  }

  const projectLocationPrompt = documentationProjectLocationPrompt({
    locale: options.locale,
    suggestedProjectLocation: pendingResolution.aiSuggestedProjectName,
  });
  if (!pendingReplyInput.text && pendingReplyInput.hadMedia) {
    return {
      handled: true,
      reply: buildPendingVoiceReplyPrompt(options.locale, projectLocationPrompt),
      batchId: pendingResolution.batchId,
      deliveryStage: "pre_persistence",
    };
  }

  const projectLocation = normalizeProjectLocationCandidate(pendingReplyInput.text);
  if (!projectLocation) {
    return {
      handled: true,
      reply: documentationProjectLocationLengthMessage(options.locale),
      batchId: pendingResolution.batchId,
      deliveryStage: "pre_persistence",
    };
  }

  try {
    const result = (await options.ctx.runAction(
      (internal as any).whatsappProcessing.createProjectAndFinalizeBatch,
      {
        batchId: pendingResolution.batchId,
        location: projectLocation,
        customerId: pendingResolution.customerId,
        locale: options.locale,
      },
    )) as { status: "saved" | "awaiting_choice"; message: string };

    return {
      handled: true,
      reply: result.message,
      batchId: pendingResolution.batchId,
      deliveryStage:
        result.status === "awaiting_choice" ? "pre_persistence" : "post_persistence",
    };
  } catch (error) {
    console.error("WhatsApp pending project naming failed", {
      batchId: String(pendingResolution.batchId),
      phoneNumberE164: options.connection.phoneNumberE164,
      message: errorMessageFromUnknown(error),
    });
    return {
      handled: true,
      reply: processingFallbackMessage(options.locale),
    };
  }
}

async function startDocumentationBatch(options: {
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: AppLocale;
  payload: TwilioInboundPayload;
  connection: WhatsAppConnectionDoc;
}) {
  const batchResult = (await options.ctx.runMutation(
    (internal as any).whatsappProcessingData.createSendBatchFromBuffer,
    {
      connectionId: options.connection._id,
      organizationId: options.connection.organizationId,
      memberId: options.connection.memberId,
      userId: options.connection.userId,
      phoneE164: options.connection.phoneNumberE164,
      commandMessageSid: options.payload.messageSid,
      commandFrom: options.payload.from,
      commandTo: options.payload.to,
    },
  )) as {
    batchId?: Id<"whatsappSendBatches">;
    messageCount: number;
    status: "queued" | "empty" | "busy";
    activeStatus?:
      | "queued"
      | "processing"
      | "awaiting_project_choice"
      | "awaiting_project_name"
      | "completed"
      | "failed";
  };

  if (batchResult.status === "busy") {
    return {
      status: "busy" as const,
      message:
        batchResult.activeStatus === "queued" || batchResult.activeStatus === "processing"
          ? documentationInProgressMessage(options.locale)
          : documentationBusyMessage(options.locale),
      count: batchResult.messageCount,
    };
  }

  if (batchResult.status === "empty") {
    return {
      status: "empty" as const,
      message: documentationEmptyMessage(options.locale),
      count: batchResult.messageCount,
    };
  }

  return {
    status: "queued" as const,
    message: documentationCapturedMessage({
      locale: options.locale,
      count: batchResult.messageCount,
    }),
    count: batchResult.messageCount,
  };
}

async function scheduleDocumentationReminder(options: {
  ctx: {
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    scheduler: {
      runAfter: (
        delayMs: number,
        functionReference: any,
        args: Record<string, unknown>,
      ) => Promise<Id<"_scheduled_functions">>;
    };
  };
  bufferId: Id<"whatsappTurnBuffers">;
  connection: WhatsAppConnectionDoc;
  locale: AppLocale;
}) {
  const reminderJobId = await options.ctx.scheduler.runAfter(
    WHATSAPP_THREAD_READINESS_BUFFER_MS,
    (internal as any).whatsapp.sendDocumentationReminder,
    {
      bufferId: options.bufferId,
      connectionId: options.connection._id,
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
    },
  );

  await options.ctx.runMutation(internal.whatsappData.updateTurnBufferStatus, {
    bufferId: options.bufferId,
    status: "buffering",
    documentationReminderJobId: reminderJobId,
  });
}

export async function processConnectedInbound(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
    scheduler: {
      runAfter: (
        delayMs: number,
        functionReference: any,
        args: Record<string, unknown>,
      ) => Promise<Id<"_scheduled_functions">>;
    };
    storage: {
      store: (blob: Blob) => Promise<Id<"_storage">>;
    };
  };
  payload: TwilioInboundPayload;
  locale: AppLocale;
  phoneNumberE164: string;
  connection: WhatsAppConnectionDoc;
}) {
  const threadId = getMastraWhatsAppThreadId({
    organizationId: options.connection.organizationId,
    memberId: options.connection.memberId,
  });

  const commandText = normalizeCommandText(options.payload.body);
  const explicitSendCommand = isSendCommand(commandText);
  let pendingReplyInputPromise: Promise<PendingReplyInput> | null = null;
  const getPendingReplyInput = () => {
    if (!pendingReplyInputPromise) {
      pendingReplyInputPromise = resolvePendingReplyInput({
        body: options.payload.body,
        locale: options.locale,
        media: options.payload.media,
      });
    }

    return pendingReplyInputPromise;
  };

  if (isSwitchCommand(commandText)) {
    const organizations = await resolveUserOrganizations(options.ctx, options.connection.userId);
    if (organizations.length <= 1) {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text:
          options.locale === "de"
            ? "Es gibt keine weitere Organisation zum Wechseln."
            : "There is no additional organization to switch to.",
        connectionId: options.connection._id,
      });
      return;
    }

    await options.ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
      phoneNumberE164: options.phoneNumberE164,
      status: "active",
      stage: "awaiting_switch_selection",
      locale: options.locale,
      email: undefined,
      userId: options.connection.userId,
      organizationId: options.connection.organizationId,
      memberId: options.connection.memberId,
      pendingOrganizations: organizations,
      otpAttempts: 0,
      expiresAt: Date.now() + WHATSAPP_ONBOARDING_TTL_MS,
    });

    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: switchPromptMessage({
        locale: options.locale,
        organizations: organizations.map((organization) => ({
          name: organization.organizationName,
        })),
      }),
      connectionId: options.connection._id,
    });

    return;
  }

  if (isUnlinkCommand(commandText)) {
    await options.ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
      phoneNumberE164: options.phoneNumberE164,
      status: "active",
      stage: "awaiting_unlink_confirmation",
      locale: options.locale,
      email: undefined,
      userId: options.connection.userId,
      organizationId: options.connection.organizationId,
      memberId: options.connection.memberId,
      pendingOrganizations: undefined,
      otpAttempts: 0,
      expiresAt: Date.now() + WHATSAPP_ONBOARDING_TTL_MS,
    });

    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: unlinkConfirmationMessage(options.locale),
      connectionId: options.connection._id,
    });

    return;
  }

  const existingTurnBuffer = (await options.ctx.runQuery(
    internal.whatsappData.getTurnBufferByConnection,
    {
      connectionId: options.connection._id,
    },
  )) as WhatsAppTurnBufferDoc | null;

  const awaitingReminderConfirmation =
    existingTurnBuffer?.status === "awaiting_confirmation" ||
    existingTurnBuffer?.status === "awaiting_documentation_confirmation";

  if (awaitingReminderConfirmation) {
    const pendingReplyInput = await getPendingReplyInput();
    const effectiveCommandText = normalizeCommandText(pendingReplyInput.text);

    if (explicitSendCommand || isAffirmativeAnswer(effectiveCommandText)) {
      await persistInboundDocumentationMessage({
        ctx: options.ctx,
        locale: options.locale,
        payload: options.payload,
        phoneNumberE164: options.phoneNumberE164,
        connection: options.connection,
        threadId,
        bodyText: explicitSendCommand
          ? extractDocumentationTextFromSendCommand(options.payload.body)
          : isAffirmativeAnswer(options.payload.body)
            ? ""
            : options.payload.body,
      });

      const batchResult = await startDocumentationBatch({
        ctx: options.ctx,
        locale: options.locale,
        payload: options.payload,
        connection: options.connection,
      });

      const text =
        batchResult.status === "queued"
          ? documentationStartedMessage(options.locale)
          : batchResult.message;

      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text,
        connectionId: options.connection._id,
      });

      return;
    }

    if (isNegativeCommand(effectiveCommandText)) {
      await options.ctx.runMutation(internal.whatsappData.updateTurnBufferStatus, {
        bufferId: existingTurnBuffer._id,
        status: "buffering",
        readyPromptSentAt: undefined,
        documentationPromptSentAt: undefined,
        documentationReminderJobId: undefined,
      });

      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: waitForMoreMessage(options.locale),
        connectionId: options.connection._id,
      });

      return;
    }
  }

  const pendingProjectResolutionResult = await handlePendingProjectResolution({
    ctx: options.ctx,
    locale: options.locale,
    resolvePendingReplyInput: getPendingReplyInput,
    connection: options.connection,
  });

  if (pendingProjectResolutionResult.handled) {
    await sendPendingHandlingReply({
      ctx: options.ctx,
      locale: options.locale,
      connection: options.connection,
      result: pendingProjectResolutionResult,
    });
    return;
  }

  const activeSendBatch = (await options.ctx.runQuery(
    (internal as any).whatsappProcessingData.getLatestActiveSendBatchByPhone,
    {
      organizationId: options.connection.organizationId,
      phoneE164: options.connection.phoneNumberE164,
    },
  )) as {
    _id: Id<"whatsappSendBatches">;
    status:
      | "queued"
      | "processing"
      | "awaiting_project_choice"
      | "awaiting_project_name"
      | "completed"
      | "failed";
  } | null;

  if (
    activeSendBatch &&
    (activeSendBatch.status === "queued" || activeSendBatch.status === "processing")
  ) {
    const pendingReplyInput = await getPendingReplyInput();
    const effectiveCommandText = normalizeCommandText(
      pendingReplyInput.text || options.payload.body,
    );

    if (explicitSendCommand || isAffirmativeAnswer(effectiveCommandText)) {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: documentationInProgressMessage(options.locale),
        connectionId: options.connection._id,
      });
      return;
    }
  }

  if (explicitSendCommand) {
    await persistInboundDocumentationMessage({
      ctx: options.ctx,
      locale: options.locale,
      payload: options.payload,
      phoneNumberE164: options.phoneNumberE164,
      connection: options.connection,
      threadId,
      bodyText: extractDocumentationTextFromSendCommand(options.payload.body),
    });

    const batchResult = await startDocumentationBatch({
      ctx: options.ctx,
      locale: options.locale,
      payload: options.payload,
      connection: options.connection,
    });

    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: batchResult.message,
      connectionId: options.connection._id,
    });

    return;
  }

  const messageId = await persistInboundDocumentationMessage({
    ctx: options.ctx,
    locale: options.locale,
    payload: options.payload,
    phoneNumberE164: options.phoneNumberE164,
    connection: options.connection,
    threadId,
    bodyText: options.payload.body,
  });

  if (!messageId) {
    return;
  }

  const turnBuffer = (await options.ctx.runQuery(
    internal.whatsappData.getTurnBufferByConnection,
    {
      connectionId: options.connection._id,
    },
  )) as WhatsAppTurnBufferDoc | null;

  if (!turnBuffer) {
    return;
  }

  await scheduleDocumentationReminder({
    ctx: options.ctx,
    bufferId: turnBuffer._id,
    connection: options.connection,
    locale: options.locale,
  });
}

async function sendTypingIndicatorForInboundPayload(options: {
  payload: TwilioInboundPayload;
  phoneNumberE164: string;
}) {
  if (!options.payload.messageSid || options.payload.media.length > 0) {
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return;
  }

  try {
    await sendTwilioWhatsAppTypingIndicator({
      accountSid,
      authToken,
      messageId: options.payload.messageSid,
    });
  } catch (error) {
    console.warn("Failed to start WhatsApp typing indicator", {
      phoneNumberE164: options.phoneNumberE164,
      message: errorMessageFromUnknown(error),
    });
  }
}

export async function sendBufferedReminder(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  bufferId: Id<"whatsappTurnBuffers">;
  connectionId: Id<"whatsappConnections">;
  phoneNumberE164: string;
  locale: AppLocale;
  now?: number;
}) {
  const now = options.now ?? Date.now();
  const turnBuffer = (await options.ctx.runQuery(internal.whatsappData.getTurnBufferByConnection, {
    connectionId: options.connectionId,
  })) as WhatsAppTurnBufferDoc | null;

  if (!turnBuffer || turnBuffer._id !== options.bufferId || turnBuffer.status !== "buffering") {
    return null;
  }

  if (
    turnBuffer.bufferedMessageIds.length === 0 ||
    now - turnBuffer.lastBufferedAt < WHATSAPP_THREAD_READINESS_BUFFER_MS
  ) {
    return null;
  }

  await options.ctx.runMutation(internal.whatsappData.updateTurnBufferStatus, {
    bufferId: turnBuffer._id,
    status: "awaiting_confirmation",
    readyPromptSentAt: now,
    documentationPromptSentAt: undefined,
    documentationReminderJobId: undefined,
  });

  await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
    phoneNumberE164: options.phoneNumberE164,
    locale: options.locale,
    text: readyQuestionMessage(options.locale),
    connectionId: options.connectionId,
  });

  return null;
}

export const sendDocumentationReminder = internalAction({
  args: {
    bufferId: v.id("whatsappTurnBuffers"),
    connectionId: v.id("whatsappConnections"),
    phoneNumberE164: v.string(),
    locale: vAppLocale,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await sendBufferedReminder({
      ctx,
      bufferId: args.bufferId,
      connectionId: args.connectionId,
      phoneNumberE164: args.phoneNumberE164,
      locale: args.locale,
    });
  },
});

export const processInboundPayload = internalAction({
  args: {
    phoneNumberE164: v.string(),
    payload: v.object({
      from: v.string(),
      to: v.string(),
      body: v.string(),
      messageSid: v.string(),
      profileName: v.optional(v.string()),
      media: v.array(
        v.object({
          mediaUrl: v.string(),
          contentType: v.string(),
          fileName: v.optional(v.string()),
        }),
      ),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sendTypingIndicatorForInboundPayload({
      payload: args.payload,
      phoneNumberE164: args.phoneNumberE164,
    });

    const activeConnection = (await ctx.runQuery(
      internal.whatsappData.getActiveConnectionByPhone,
      {
        phoneNumberE164: args.phoneNumberE164,
      },
    )) as WhatsAppConnectionDoc | null;

    const locale = await resolveInboundLocale({
      runQuery: ctx.runQuery,
      phoneNumberE164: args.phoneNumberE164,
      userId: activeConnection?.userId,
    });

    if (!activeConnection) {
      await ctx.runAction((internal as any).whatsapp.processOnboardingInbound, {
        phoneNumberE164: args.phoneNumberE164,
        locale,
        payload: args.payload,
      });
      return null;
    }

    await processConnectedInbound({
      ctx,
      payload: args.payload,
      locale,
      phoneNumberE164: args.phoneNumberE164,
      connection: activeConnection,
    });

    return null;
  },
});

export const handleTwilioWebhook = action({
  args: {
    requestUrl: v.string(),
    signature: v.union(v.string(), v.null()),
    params: v.array(v.object({ key: v.string(), value: v.string() })),
  },
  handler: async (ctx, args) => {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      throw new Error("Twilio auth token is not configured");
    }

    const isValidSignature = await validateTwilioSignature({
      requestUrl: args.requestUrl,
      authToken,
      signature: args.signature,
      params: args.params.map((entry) => [entry.key, entry.value]),
    });

    if (!isValidSignature) {
      throw new Error("Invalid Twilio signature");
    }

    const formData = new FormData();
    args.params.forEach((entry) => {
      formData.append(entry.key, entry.value);
    });

    const payload = parseTwilioInboundPayload(formData);
    if (!payload.from) {
      return {
        ignored: true,
      };
    }

    const normalizedPhone = normalizePhoneNumber(payload.from);
    if (!normalizedPhone) {
      return {
        ignored: true,
      };
    }

    await ctx.scheduler.runAfter(0, (internal as any).whatsapp.processInboundPayload, {
      phoneNumberE164: normalizedPhone.e164,
      payload,
    });

    return {
      handled: true,
    };
  },
});

export const processOnboardingInbound = internalAction({
  args: {
    phoneNumberE164: v.string(),
    locale: vAppLocale,
    payload: v.object({
      from: v.string(),
      to: v.string(),
      body: v.string(),
      messageSid: v.string(),
      profileName: v.optional(v.string()),
      media: v.array(
        v.object({
          mediaUrl: v.string(),
          contentType: v.string(),
          fileName: v.optional(v.string()),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const existingSession = (await ctx.runQuery(internal.whatsappData.getOnboardingSessionByPhone, {
      phoneNumberE164: args.phoneNumberE164,
    })) as OnboardingSessionDoc | null;

    const now = Date.now();

    if (!existingSession || existingSession.status !== "active" || existingSession.expiresAt <= now) {
      await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
        phoneNumberE164: args.phoneNumberE164,
        status: "active",
        stage: "awaiting_email",
        locale: args.locale,
        email: undefined,
        userId: undefined,
        organizationId: undefined,
        memberId: undefined,
        pendingOrganizations: undefined,
        otpAttempts: 0,
        expiresAt: now + WHATSAPP_ONBOARDING_TTL_MS,
      });

      for (const message of onboardingGreetingMessages(args.locale)) {
        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: args.locale,
          text: message,
        });
      }
      return;
    }

    if (existingSession.stage === "awaiting_switch_selection") {
      const selectionIndex = Number(args.payload.body.trim()) - 1;
      const selected = existingSession.pendingOrganizations?.[selectionIndex];
      if (!selected) {
        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: unsupportedCommandMessage(existingSession.locale),
        });
        return;
      }

      await ctx.runMutation(internal.whatsappData.upsertConnectionForMember, {
        organizationId: selected.organizationId,
        memberId: selected.memberId,
        userId: existingSession.userId!,
        phoneNumberE164: args.phoneNumberE164,
      });

      await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
        phoneNumberE164: args.phoneNumberE164,
        status: "completed",
        stage: "ready",
        locale: existingSession.locale,
        email: existingSession.email,
        userId: existingSession.userId,
        organizationId: selected.organizationId,
        memberId: selected.memberId,
        pendingOrganizations: undefined,
        otpAttempts: existingSession.otpAttempts,
        expiresAt: now + WHATSAPP_ONBOARDING_TTL_MS,
      });

      await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: args.phoneNumberE164,
        locale: existingSession.locale,
        text: switchSuccessMessage({
          locale: existingSession.locale,
          organizationName: selected.organizationName,
        }),
      });
      return;
    }

    if (existingSession.stage === "awaiting_unlink_confirmation") {
      if (isAffirmativeAnswer(args.payload.body)) {
        if (existingSession.organizationId && existingSession.memberId) {
          await ctx.runMutation(internal.whatsappData.disconnectConnectionByMember, {
            organizationId: existingSession.organizationId,
            memberId: existingSession.memberId,
          });
        }

        await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
          phoneNumberE164: args.phoneNumberE164,
          status: "completed",
          stage: "ready",
          locale: existingSession.locale,
          email: existingSession.email,
          userId: existingSession.userId,
          organizationId: existingSession.organizationId,
          memberId: existingSession.memberId,
          pendingOrganizations: undefined,
          otpAttempts: existingSession.otpAttempts,
          expiresAt: now + WHATSAPP_ONBOARDING_TTL_MS,
        });

        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: unlinkSuccessMessage(existingSession.locale),
        });
      } else {
        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: waitForMoreMessage(existingSession.locale),
        });
      }

      return;
    }

    if (existingSession.stage === "awaiting_email") {
      const email = extractEmailCandidate(args.payload.body);
      if (!email) {
        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: invalidEmailMessage(existingSession.locale),
        });
        return;
      }

      const existingUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [
          {
            field: "email",
            operator: "eq",
            value: email,
          },
        ],
      })) as UserDoc | null;

      const locale = await resolveInboundLocale({
        runQuery: ctx.runQuery,
        phoneNumberE164: args.phoneNumberE164,
        userId: existingUser?._id,
      });

      await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
        phoneNumberE164: args.phoneNumberE164,
        status: "active",
        stage: "awaiting_password",
        locale,
        email,
        userId: existingUser?._id ?? existingSession.userId,
        organizationId: existingSession.organizationId,
        memberId: existingSession.memberId,
        pendingOrganizations: undefined,
        otpAttempts: 0,
        expiresAt: now + WHATSAPP_ONBOARDING_TTL_MS,
      });

      await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: args.phoneNumberE164,
        locale,
        text: askPasswordMessage({
          locale,
          email,
          isExistingUser: !!existingUser,
        }),
      });
      return;
    }

    if (existingSession.stage === "awaiting_password") {
      const password = args.payload.body;
      if (!existingSession.email || !password.trim()) {
        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: invalidPasswordMessage(existingSession.locale),
        });
        return;
      }

      const userFromDirectoryBeforeAuth = (await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        {
          model: "user",
          where: [
            {
              field: "email",
              operator: "eq",
              value: existingSession.email,
            },
          ],
        },
      )) as UserDoc | null;
      const shouldSignIn = !!(existingSession.userId ?? userFromDirectoryBeforeAuth?._id);
      const auth = createAuth(ctx as any);

      try {
        const authResult = shouldSignIn
          ? await callAuthApi(auth, "signInEmail", {
              body: {
                email: existingSession.email,
                password,
              },
              headers: new Headers(),
            })
          : await callAuthApi(auth, "signUpEmail", {
              body: {
                email: existingSession.email,
                password,
                name: WHATSAPP_ONBOARDING_PLACEHOLDER_NAME,
              },
              headers: new Headers(),
            });

        const userFromAuth = normalizeUserInfo(authResult);
        const userFromDirectory = userFromAuth
          ? null
          : ((await ctx.runQuery(components.betterAuth.adapter.findOne, {
              model: "user",
              where: [
                {
                  field: "email",
                  operator: "eq",
                  value: existingSession.email,
                },
              ],
            })) as UserDoc | null);
        const user = userFromAuth ?? normalizeUserInfo(userFromDirectory);
        if (!user) {
          throw new Error("Unable to resolve authenticated user");
        }

        await autoAcceptInvitationsForEmail({
          runQuery: ctx.runQuery,
          userId: user.id,
          email: existingSession.email,
        });

        let organizations = await resolveUserOrganizations(ctx, user.id);
        if (organizations.length === 0) {
          const createdOrg = await createOrganizationForUser({
            runQuery: ctx.runQuery,
            user: {
              _id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
            },
          });
          organizations = [createdOrg];
        }

        const selectedOrganization = organizations[0]!;
        await ctx.runMutation(internal.whatsappData.upsertConnectionForMember, {
          organizationId: selectedOrganization.organizationId,
          memberId: selectedOrganization.memberId,
          userId: user.id,
          phoneNumberE164: args.phoneNumberE164,
        });

        const hasMultipleOrganizations = organizations.length > 1;
        const locale = await resolveInboundLocale({
          runQuery: ctx.runQuery,
          phoneNumberE164: args.phoneNumberE164,
          userId: user.id,
        });

        await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
          phoneNumberE164: args.phoneNumberE164,
          status: "completed",
          stage: "ready",
          locale,
          email: existingSession.email,
          userId: user.id,
          organizationId: selectedOrganization.organizationId,
          memberId: selectedOrganization.memberId,
          pendingOrganizations: hasMultipleOrganizations ? organizations : undefined,
          otpAttempts: existingSession.otpAttempts,
          expiresAt: now + WHATSAPP_ONBOARDING_TTL_MS,
        });

        const onboardingText = onboardingCompletedMessage({
          locale,
          organizationName: selectedOrganization.organizationName,
        });

        const switchHint = hasMultipleOrganizations
          ? `\n\n${onboardingSwitchHintMessage(locale)}`
          : "";

        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale,
          text: `${onboardingText}${switchHint}`,
        });
      } catch (error) {
        console.error("WhatsApp onboarding email/password auth failed", {
          phoneNumberE164: args.phoneNumberE164,
          message: errorMessageFromUnknown(error),
        });

        const nextAttempts = existingSession.otpAttempts + 1;
        const shouldExpire = nextAttempts >= MAX_ONBOARDING_AUTH_ATTEMPTS;

        await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
          phoneNumberE164: args.phoneNumberE164,
          status: shouldExpire ? "expired" : "active",
          stage: shouldExpire ? "awaiting_email" : "awaiting_password",
          locale: existingSession.locale,
          email: shouldExpire ? undefined : existingSession.email,
          userId: shouldExpire
            ? undefined
            : userFromDirectoryBeforeAuth?._id ?? existingSession.userId,
          organizationId: existingSession.organizationId,
          memberId: existingSession.memberId,
          pendingOrganizations: undefined,
          otpAttempts: nextAttempts,
          expiresAt: now + WHATSAPP_ONBOARDING_TTL_MS,
        });

        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: shouldExpire
            ? onboardingPasswordAttemptsExceededMessage(existingSession.locale)
            : invalidPasswordMessage(existingSession.locale),
        });
      }
    }
  },
});

export const sendSystemMessage = internalAction({
  args: {
    phoneNumberE164: v.string(),
    locale: vAppLocale,
    text: v.string(),
    connectionId: v.optional(v.id("whatsappConnections")),
  },
  handler: async (ctx, args) => {
    const connection = args.connectionId
      ? ((await ctx.runQuery(internal.whatsappData.getConnectionById, {
          connectionId: args.connectionId,
        })) as WhatsAppConnectionDoc | null)
      : null;

    const result = await sendOutboundMessage({
      text: args.text,
      phoneNumberE164: args.phoneNumberE164,
      locale: args.locale,
      connection,
      runMutation: ctx.runMutation,
    });

    if (!result.ok) {
      console.error("WhatsApp outbound message failed", {
        phoneNumberE164: args.phoneNumberE164,
        connectionId: args.connectionId ?? null,
        error: result.error,
      });
    }

    return result;
  },
});
