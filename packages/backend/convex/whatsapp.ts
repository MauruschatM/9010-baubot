'use node';

import { createTranslator, type AppLocale } from "@mvp-template/i18n";
import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { v } from "convex/values";

import { vAppLocale } from "./lib/locales";
import { cosineSimilarity, embedTextsWithVoyage } from "./lib/voyage";
import { z } from "zod";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { buildWorkspaceAgentTools } from "./agentRuntime";
import {
  compileAgentContextPacket,
  formatContextPacketForInstructions,
} from "../mastra/agentContext/compiler";
import { createAuth } from "./auth";
import {
  createWorkspaceAgent,
  DEFAULT_AI_GATEWAY_MODEL,
} from "../mastra/agent";
import {
  getMastraResourceId,
  getMastraWhatsAppThreadId,
} from "./mastraComponent/constants";
import {
  extractAttachmentNames,
  serializeContentForConvex,
  toGenerationContent,
  toDisplayText,
} from "./mastraComponent/serialization";
import {
  WHATSAPP_AGENT_MODEL,
  WHATSAPP_CHANNEL,
  WHATSAPP_OUTBOUND_CHUNK_DELAY_MS,
  WHATSAPP_OUTBOUND_CHUNK_HARD_LIMIT_CHARS,
  WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS,
  WHATSAPP_OUTBOUND_MAX_CHUNKS,
  WHATSAPP_ONBOARDING_TTL_MS,
  WHATSAPP_READY_PROMPT_COOLDOWN_MS,
  WHATSAPP_THREAD_READINESS_BUFFER_MS,
  WHATSAPP_TURN_DETECTION_MODEL,
  WHATSAPP_TYPING_FALLBACK_DELAY_MS,
} from "./whatsapp/constants";
import {
  askPasswordMessage,
  clarificationMissingAnswerMessage,
  clarificationQuestionMessage,
  documentationBusyMessage,
  documentationCapturedMessage,
  documentationEmptyMessage,
  documentationInProgressMessage,
  documentationProjectChoiceMessage,
  documentationProjectLocationLengthMessage,
  documentationProjectLocationPrompt,
  formatProjectChoiceOption,
  documentationReminderMessage,
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
  transcriptionPrefix,
  unlinkConfirmationMessage,
  unlinkSuccessMessage,
  unsupportedCommandMessage,
  waitForMoreMessage,
  workingOnThatMessage,
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
import { detectTurnReadiness } from "./whatsapp/turnDetection";
import {
  getConfiguredTwilioWhatsAppFromNumber,
  parseTwilioInboundPayload,
  sendTwilioWhatsAppMessage,
  sendTwilioWhatsAppTypingIndicator,
  validateTwilioSignature,
} from "./whatsapp/twilio";
import type {
  StoredWhatsAppMedia,
  TurnDetectionDecision,
  TwilioInboundPayload,
} from "./whatsapp/types";
import {
  ensureServiceSessionForUser,
  getSessionHeadersForUser,
} from "./serviceSessions";

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

type WhatsAppMessageDoc = {
  _id: Id<"whatsappMessages">;
  providerMessageSid?: string;
  direction: "inbound" | "outbound" | "system";
  phoneNumberE164: string;
  connectionId?: Id<"whatsappConnections">;
  organizationId?: string;
  userId?: string;
  memberId?: string;
  threadId?: string;
  text: string;
  media: StoredWhatsAppMedia[];
  turnStatus: "buffered" | "sent_to_agent" | "ignored";
  documentationStatus?: "pending" | "batched" | "ignored";
  createdAt: number;
  sentToAgentAt?: number;
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

type ChatAttachment = {
  name?: string;
  contentType: string;
  storageId: Id<"_storage">;
};

type ResolvedChatAttachment = {
  name: string | undefined;
  contentType: string;
  storageId: Id<"_storage">;
  fileUrl: string | null;
  base64Data: string;
};

const PENDING_CHOICE_MATCH_THRESHOLD = 0.87;
const PENDING_CHOICE_MATCH_GAP = 0.05;

type PersistedMessage = {
  messageId: string;
  role: "system" | "user" | "assistant" | "tool";
  type: "text" | "tool-call" | "tool-result";
  content: unknown;
  text: string;
  attachmentNames: string[];
  createdAt: number;
};

type GenerationHistoryMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  type: "text" | "tool-call" | "tool-result";
  content: unknown;
  createdAt: number;
};

type ToolCallRecord = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

type ToolResultRecord = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
};

type AuthApiClient = {
  api?: unknown;
};

type OrganizationSelection = {
  organizationId: string;
  organizationName: string;
  memberId: string;
};

type RunAgentForBufferedTurnResult = {
  text: string | null;
  responseKind: "answer" | "clarification" | "approval_required";
  clarificationSessionId: string | null;
  pendingActionId: string | null;
};

const PAGE_SIZE = 200;
const MAX_ATTACHMENTS = 6;
const MAX_MESSAGE_TEXT = 2500;
const MAX_ONBOARDING_AUTH_ATTEMPTS = 6;
const WHATSAPP_ONBOARDING_PLACEHOLDER_NAME = " ";
const STREAM_FLUSH_INTERVAL_MS = 180;
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;
const CLARIFICATION_TTL_MS = 15 * 60 * 1000;

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

export function shouldDeferMediaOnlyTurn(options: {
  currentMessageHasMedia: boolean;
  hasAnyText: boolean;
  transcriptionText: string | null;
}) {
  return (
    options.currentMessageHasMedia &&
    !options.hasAnyText &&
    !(options.transcriptionText?.trim() ?? "")
  );
}

export function shouldDeliverBufferedTurnResponse(
  messages: Array<Pick<WhatsAppMessageDoc, "turnStatus" | "documentationStatus">>,
) {
  return (
    messages.length === 0 ||
    messages.every(
      (message) =>
        message.turnStatus === "buffered" && message.documentationStatus !== "batched",
    )
  );
}

async function sourceMessagesStillAvailableForAgentResponse(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  sourceMessageIds: Id<"whatsappMessages">[];
}) {
  if (options.sourceMessageIds.length === 0) {
    return true;
  }

  const messages = (await options.ctx.runQuery(internal.whatsappData.getMessagesByIds, {
    messageIds: options.sourceMessageIds,
  })) as WhatsAppMessageDoc[];

  return (
    messages.length === options.sourceMessageIds.length &&
    shouldDeliverBufferedTurnResponse(messages)
  );
}

async function cancelPendingClarificationForThread(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  threadId: string;
}) {
  const session = (await options.ctx.runQuery(
    internal.aiState.getLatestPendingClarificationByThread,
    {
      threadId: options.threadId,
    },
  )) as {
    id: Id<"aiClarificationSessions">;
    status: "pending" | "answered" | "canceled" | "expired";
  } | null;

  if (!session || session.status !== "pending") {
    return;
  }

  await options.ctx.runMutation(internal.aiState.resolveClarificationSession, {
    clarificationSessionId: session.id,
    status: "canceled",
  });
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

function createMessageId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}:${Date.now()}:${suffix}`;
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

function normalizeAttachments(attachments: ChatAttachment[]) {
  return attachments
    .map((attachment) => ({
      name: attachment.name?.trim() || undefined,
      contentType: attachment.contentType.trim(),
      storageId: attachment.storageId,
    }))
    .filter(
      (attachment) =>
        attachment.contentType.length > 0 &&
        typeof attachment.storageId === "string" &&
        attachment.storageId.trim().length > 0,
    )
    .slice(0, MAX_ATTACHMENTS);
}

async function resolveAttachmentsFromStorage(
  ctx: {
    storage: {
      get: (storageId: Id<"_storage">) => Promise<Blob | null>;
      getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
    };
  },
  attachments: ChatAttachment[],
) {
  const resolvedAttachments = await Promise.all(
    attachments.map(async (attachment) => {
      const [fileBlob, fileUrl] = await Promise.all([
        ctx.storage.get(attachment.storageId),
        ctx.storage.getUrl(attachment.storageId),
      ]);

      if (!fileBlob) {
        return null;
      }

      const base64Data = Buffer.from(await fileBlob.arrayBuffer()).toString("base64");
      if (!base64Data) {
        return null;
      }

      return {
        name: attachment.name,
        contentType: attachment.contentType,
        storageId: attachment.storageId,
        fileUrl,
        base64Data,
      } satisfies ResolvedChatAttachment;
    }),
  );

  return resolvedAttachments.filter(
    (attachment): attachment is ResolvedChatAttachment => !!attachment,
  );
}

function buildUserMessage(options: {
  prompt: string;
  attachments: ResolvedChatAttachment[];
}) {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mimeType?: string }
    | { type: "file"; data: string; mimeType: string; filename?: string }
  > = [];

  if (options.prompt) {
    parts.push({
      type: "text",
      text: options.prompt,
    });
  }

  for (const attachment of options.attachments) {
    if (attachment.contentType.startsWith("image/")) {
      parts.push({
        type: "image",
        image: attachment.base64Data,
        mimeType: attachment.contentType,
      });
      continue;
    }

    parts.push({
      type: "file",
      data: attachment.base64Data,
      mimeType: attachment.contentType,
      filename: attachment.name,
    });
  }

  if (parts.length === 0) {
    throw new Error("Please send at least one message or attachment");
  }

  if (parts.length === 1 && parts[0]?.type === "text") {
    return {
      role: "user" as const,
      content: parts[0].text,
    };
  }

  return {
    role: "user" as const,
    content: parts,
  };
}

function buildPersistedUserMessageContent(options: {
  prompt: string;
  attachments: ResolvedChatAttachment[];
}) {
  const parts: Array<Record<string, unknown>> = [];

  if (options.prompt) {
    parts.push({
      type: "text",
      text: options.prompt,
    });
  }

  for (const attachment of options.attachments) {
    if (attachment.contentType.startsWith("image/")) {
      const persistedImageSource =
        attachment.fileUrl ??
        `data:${attachment.contentType};base64,${attachment.base64Data}`;
      parts.push({
        type: "image",
        image: persistedImageSource,
        url: attachment.fileUrl ?? undefined,
        mimeType: attachment.contentType,
        filename: attachment.name,
        storageId: attachment.storageId,
      });
      continue;
    }

    parts.push({
      type: "file",
      mimeType: attachment.contentType,
      filename: attachment.name,
      url: attachment.fileUrl ?? undefined,
      data: attachment.fileUrl ? undefined : attachment.base64Data,
      storageId: attachment.storageId,
    });
  }

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1 && isRecord(parts[0]) && parts[0].type === "text") {
    return typeof parts[0].text === "string" ? parts[0].text : "";
  }

  return parts;
}

function buildPersistedMessage(input: {
  messageId: string;
  role: "system" | "user" | "assistant" | "tool";
  type: "text" | "tool-call" | "tool-result";
  content: unknown;
  createdAt?: number;
  text?: string;
  attachmentNames?: string[];
}): PersistedMessage {
  const normalizedContent = serializeContentForConvex(input.content);
  const normalizedText =
    input.text ??
    toDisplayText({
      type: input.type,
      content: normalizedContent,
    });

  return {
    messageId: input.messageId,
    role: input.role,
    type: input.type,
    content: normalizedContent,
    text: normalizedText,
    attachmentNames: input.attachmentNames ?? extractAttachmentNames(normalizedContent),
    createdAt: input.createdAt ?? Date.now(),
  };
}

function extractToolCalls(value: unknown): ToolCallRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const toolCalls: ToolCallRecord[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      return;
    }

    const payload = isRecord(entry.payload) ? entry.payload : entry;
    const toolName = getRecordString(payload, "toolName") ?? "tool";
    const toolCallId =
      getRecordString(payload, "toolCallId") ??
      getRecordString(payload, "id") ??
      `tool-call-${index}`;

    toolCalls.push({
      toolCallId,
      toolName,
      args: payload.args ?? payload.input ?? {},
    });
  });

  return toolCalls;
}

function extractToolResults(value: unknown): ToolResultRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const toolResults: ToolResultRecord[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      return;
    }

    const payload = isRecord(entry.payload) ? entry.payload : entry;
    const toolName = getRecordString(payload, "toolName") ?? "tool";
    const toolCallId =
      getRecordString(payload, "toolCallId") ??
      getRecordString(payload, "id") ??
      `tool-result-${index}`;

    toolResults.push({
      toolCallId,
      toolName,
      result: payload.result ?? payload.output ?? null,
      isError: typeof payload.isError === "boolean" ? payload.isError : undefined,
    });
  });

  return toolResults;
}

function hasClarificationRequestedStatus(result: unknown) {
  if (!isRecord(result)) {
    return false;
  }

  const status = getRecordString(result, "status");
  return status === "clarification_requested" || status === "question_requested";
}

function hasApprovalRequiredStatus(result: unknown) {
  if (!isRecord(result)) {
    return false;
  }

  return (
    getRecordString(result, "status") === "requires_confirmation" &&
    typeof getRecordString(result, "pendingActionId") === "string"
  );
}

function detectResponseKindFromToolResults(toolResults: ToolResultRecord[]) {
  const hasApprovalRequired = toolResults.some((toolResult) =>
    hasApprovalRequiredStatus(toolResult.result),
  );

  if (hasApprovalRequired) {
    return "approval_required" as const;
  }

  const hasClarificationRequested = toolResults.some((toolResult) =>
    hasClarificationRequestedStatus(toolResult.result),
  );

  if (hasClarificationRequested) {
    return "clarification" as const;
  }

  return "answer" as const;
}

function getApprovalPendingActionId(toolResults: ToolResultRecord[]) {
  for (const toolResult of toolResults) {
    if (!hasApprovalRequiredStatus(toolResult.result) || !isRecord(toolResult.result)) {
      continue;
    }

    const pendingActionId = getRecordString(toolResult.result, "pendingActionId");
    if (pendingActionId) {
      return pendingActionId;
    }
  }

  return null;
}

function resolveStreamActor(value?: string | null) {
  if (!value) {
    return "main" as const;
  }

  if (value.includes("organization")) {
    return "organization" as const;
  }
  if (value.includes("customer")) {
    return "customer" as const;
  }
  if (value.includes("project")) {
    return "project" as const;
  }
  if (value.includes("user")) {
    return "user" as const;
  }

  return "main" as const;
}

function extractClarificationQuestionsFromResult(result: Record<string, unknown>) {
  const questions: string[] = [];
  const singleQuestion = getRecordString(result, "question");
  if (singleQuestion) {
    questions.push(singleQuestion);
  }

  const rawQuestions = result.questions;
  if (Array.isArray(rawQuestions)) {
    rawQuestions.forEach((entry) => {
      if (typeof entry !== "string") {
        return;
      }

      const normalized = entry.trim();
      if (normalized.length === 0) {
        return;
      }

      if (!questions.includes(normalized)) {
        questions.push(normalized);
      }
    });
  }

  return questions.slice(0, 3);
}

function getClarificationToolRequest(toolResults: ToolResultRecord[]) {
  for (const toolResult of toolResults) {
    if (!hasClarificationRequestedStatus(toolResult.result) || !isRecord(toolResult.result)) {
      continue;
    }

    const questions = extractClarificationQuestionsFromResult(toolResult.result);
    if (questions.length === 0) {
      continue;
    }

    return {
      questions,
      reason: getRecordString(toolResult.result, "reason"),
    };
  }

  return null;
}

function buildClarificationTemplateFromTool(options: {
  locale: AppLocale;
  questions: string[];
  reason?: string | null;
}) {
  const normalizedQuestions = options.questions
    .map((question) => question.trim())
    .filter((question, index, allQuestions) => {
      return question.length > 0 && allQuestions.indexOf(question) === index;
    })
    .slice(0, 3);

  const t = createTranslator(options.locale);
  const fallbackQuestion = t("app.chat.clarification.fallbackQuestion");

  const clarificationPrompts =
    normalizedQuestions.length > 0 ? normalizedQuestions : [fallbackQuestion];

  return {
    title: t("app.chat.clarification.title"),
    description:
      options.reason ?? t("app.chat.clarification.description"),
    assistantMessage:
      clarificationPrompts.length === 1
        ? clarificationPrompts[0]!
        : t("app.chat.clarification.assistantMessageMultiple"),
    questions: clarificationPrompts.map((prompt, index) => ({
      id: `details_${index + 1}`,
      prompt,
      options: [
        {
          id: "provide_details",
          label: t("app.chat.clarification.options.provideDetailsLabel"),
          description: t("app.chat.clarification.options.provideDetailsDescription"),
        },
        {
          id: "use_current_data",
          label: t("app.chat.clarification.options.useCurrentDataLabel"),
          description: t("app.chat.clarification.options.useCurrentDataDescription"),
        },
        {
          id: "cancel_request",
          label: t("app.chat.clarification.options.cancelRequestLabel"),
          description: t("app.chat.clarification.options.cancelRequestDescription"),
        },
      ],
      allowOther: true,
      required: true,
    })),
  };
}

function getChunkType(chunk: unknown) {
  if (!isRecord(chunk)) {
    return null;
  }

  return getRecordString(chunk, "type");
}

function getChunkPayload(chunk: unknown) {
  if (!isRecord(chunk) || !isRecord(chunk.payload)) {
    return null;
  }

  return chunk.payload;
}

function getTextDeltaFromChunk(chunk: unknown, payload: Record<string, unknown> | null) {
  if (payload) {
    const payloadText =
      getRecordString(payload, "text") ?? getRecordString(payload, "textDelta");
    if (payloadText) {
      return payloadText;
    }
  }

  if (isRecord(chunk)) {
    return getRecordString(chunk, "textDelta") ?? "";
  }

  return "";
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Failed to run chat";
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

function buildClarificationAnswersFromMessage(options: {
  questions: Array<{
    id: string;
    required: boolean;
    options: Array<{ id: string; label: string; description: string }>;
  }>;
  messageText: string;
}) {
  const lines = options.messageText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const answers: Record<string, string> = {};

  const parseLine = (line: string) => {
    const normalized = line.replace(/^q/i, "");
    const questionMatch = normalized.match(/^(\d+)[:.)\-\s]+(.*)$/);
    if (!questionMatch) {
      return null;
    }

    const questionNumber = Number(questionMatch[1]);
    const remainder = questionMatch[2]?.trim() ?? "";
    if (!Number.isFinite(questionNumber) || questionNumber <= 0) {
      return null;
    }

    return {
      questionIndex: questionNumber - 1,
      payload: remainder,
    };
  };

  for (const line of lines) {
    const parsedLine = parseLine(line);
    if (!parsedLine) {
      continue;
    }

    const question = options.questions[parsedLine.questionIndex];
    if (!question) {
      continue;
    }

    const optionMatch = parsedLine.payload.match(/^(\d+)\s*(.*)$/);
    if (optionMatch) {
      const optionIndex = Number(optionMatch[1]) - 1;
      const option = question.options[optionIndex];
      const freeText = optionMatch[2]?.trim();
      if (option) {
        answers[question.id] = freeText
          ? `${option.label}: ${freeText}`
          : option.label;
        continue;
      }
    }

    if (parsedLine.payload.length > 0) {
      answers[question.id] = parsedLine.payload;
    }
  }

  if (Object.keys(answers).length === 0 && options.questions.length === 1) {
    const onlyQuestion = options.questions[0]!;
    const optionMatch = options.messageText.trim().match(/^(\d+)\s*(.*)$/);
    if (optionMatch) {
      const option = onlyQuestion.options[Number(optionMatch[1]) - 1];
      const freeText = optionMatch[2]?.trim();
      if (option) {
        answers[onlyQuestion.id] = freeText
          ? `${option.label}: ${freeText}`
          : option.label;
      }
    } else {
      answers[onlyQuestion.id] = options.messageText.trim();
    }
  }

  for (const question of options.questions) {
    if (!question.required) {
      continue;
    }

    const answer = answers[question.id]?.trim();
    if (!answer) {
      return null;
    }
  }

  return answers;
}

function buildResumePromptFromClarification(options: {
  originalPrompt: string;
  normalizedAnswers: Record<string, string>;
  locale: AppLocale;
}) {
  const sortedEntries = Object.entries(options.normalizedAnswers).sort((entryA, entryB) =>
    entryA[0].localeCompare(entryB[0]),
  );

  if (sortedEntries.length === 0) {
    return options.originalPrompt;
  }

  const detailsLines = sortedEntries.map(
    ([questionId, value]) => `- ${questionId}: ${value}`,
  );

  if (options.locale === "de") {
    return `${options.originalPrompt}\n\nZusätzliche Bestätigung:\n${detailsLines.join("\n")}`;
  }

  return `${options.originalPrompt}\n\nAdditional confirmation:\n${detailsLines.join("\n")}`;
}

function buildBufferedPrompt(options: {
  locale: AppLocale;
  messages: WhatsAppMessageDoc[];
  routingContextText?: string | null;
}) {
  const promptParts: string[] = [];

  if (options.routingContextText) {
    promptParts.push(options.routingContextText);
  }

  for (const message of options.messages) {
    const normalizedText = message.text.trim();
    if (normalizedText.length > 0) {
      promptParts.push(normalizedText);
    }

    for (const media of message.media) {
      if (!media.transcription) {
        continue;
      }

      const mediaType = media.contentType.startsWith("video/") ? "video" : "audio";
      promptParts.push(
        `[${transcriptionPrefix(options.locale, mediaType)}] ${media.transcription}`,
      );
    }
  }

  const combinedPrompt = promptParts.join("\n\n").trim();
  return combinedPrompt.length > 0 ? combinedPrompt : "Please analyze the attached files.";
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

export async function processPendingClarification(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: AppLocale;
  resolvePendingReplyInput: () => Promise<PendingReplyInput>;
  threadId: string;
  organizationId: string;
  userId: string;
  memberId: string;
}): Promise<PendingHandlingResult> {
  const session = (await options.ctx.runQuery(
    internal.aiState.getLatestPendingClarificationByThread,
    {
      threadId: options.threadId,
    },
  )) as {
    id: Id<"aiClarificationSessions">;
    status: "pending" | "answered" | "canceled" | "expired";
    prompt: string;
    assistantMessage: string;
    questions: Array<{
      id: string;
      prompt: string;
      options: Array<{ id: string; label: string; description: string }>;
      required: boolean;
    }>;
    expiresAt: number;
  } | null;

  if (!session || session.status !== "pending") {
    return {
      handled: false,
    };
  }

  if (session.expiresAt <= Date.now()) {
    await options.ctx.runMutation(internal.aiState.resolveClarificationSession, {
      clarificationSessionId: session.id,
      status: "expired",
    });

    return {
      handled: true,
      reply:
        options.locale === "de"
          ? "Rückfrage ist abgelaufen. Bitte stelle die Anfrage erneut."
          : "Clarification expired. Please ask again.",
    };
  }

  const pendingReplyInput = await options.resolvePendingReplyInput();
  const answers = buildClarificationAnswersFromMessage({
    questions: session.questions,
    messageText: pendingReplyInput.text,
  });

  if (!answers) {
    const firstQuestion = session.questions[0];
    if (!firstQuestion) {
      return {
        handled: true,
        reply:
          pendingReplyInput.hadMedia && !pendingReplyInput.text
            ? pendingVoiceReplyTypingFallbackMessage(options.locale)
            : clarificationMissingAnswerMessage(options.locale),
      };
    }

    const clarificationPrompt = clarificationQuestionMessage({
      locale: options.locale,
      title:
        options.locale === "de"
          ? "Bitte Rückfrage beantworten"
          : "Please answer the clarification",
      prompt: firstQuestion.prompt,
      options: firstQuestion.options,
      questionIndex: 0,
      questionCount: session.questions.length,
    });

    return {
      handled: true,
      reply:
        pendingReplyInput.hadMedia && !pendingReplyInput.text
          ? buildPendingVoiceReplyPrompt(options.locale, clarificationPrompt)
          : [clarificationMissingAnswerMessage(options.locale), clarificationPrompt].join("\n\n"),
    };
  }

  const resumePrompt = buildResumePromptFromClarification({
    originalPrompt: session.prompt,
    normalizedAnswers: answers,
    locale: options.locale,
  });

  await options.ctx.runMutation(internal.aiState.resolveClarificationSession, {
    clarificationSessionId: session.id,
    status: "answered",
    answers,
    resumePrompt,
  });

  await options.ctx.runAction((internal as any).whatsapp.runAgentForBufferedTurn, {
    organizationId: options.organizationId,
    userId: options.userId,
    memberId: options.memberId,
    threadId: options.threadId,
    locale: options.locale,
    prompt: resumePrompt,
    attachments: [],
    sourceMessageIds: [],
  });

  return {
    handled: true,
    reply: null,
  };
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

async function runBufferedTurnWithIndicator(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: AppLocale;
  args: {
    organizationId: string;
    userId: string;
    memberId: string;
    threadId: string;
    locale: AppLocale;
    prompt: string;
    attachments: ChatAttachment[];
    sourceMessageIds: Id<"whatsappMessages">[];
  };
  connection: WhatsAppConnectionDoc;
}) {
  const runPromise = options.ctx.runAction((internal as any).whatsapp.runAgentForBufferedTurn, options.args);

  const firstResult = await Promise.race([
    runPromise.then((result) => ({ kind: "result" as const, result })),
    new Promise<{ kind: "processing" }>((resolve) => {
      setTimeout(() => resolve({ kind: "processing" }), WHATSAPP_TYPING_FALLBACK_DELAY_MS);
    }),
  ]);

  if (firstResult.kind === "processing") {
    const canDeliverIndicator = await sourceMessagesStillAvailableForAgentResponse({
      ctx: options.ctx,
      sourceMessageIds: options.args.sourceMessageIds,
    });

    if (canDeliverIndicator) {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: workingOnThatMessage(options.locale),
        connectionId: options.connection._id,
      });
    }

    return await runPromise;
  }

  return firstResult.result;
}

async function processConnectedInbound(options: {
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

  if (explicitSendCommand) {
    await cancelPendingClarificationForThread({
      ctx: options.ctx,
      threadId,
    });
  }

  const pendingClarificationResult = explicitSendCommand
    ? {
        handled: false,
      }
    : await processPendingClarification({
        ctx: options.ctx,
        locale: options.locale,
        resolvePendingReplyInput: getPendingReplyInput,
        threadId,
        organizationId: options.connection.organizationId,
        userId: options.connection.userId,
        memberId: options.connection.memberId,
      });

  if (pendingClarificationResult.handled) {
    await sendPendingHandlingReply({
      ctx: options.ctx,
      locale: options.locale,
      connection: options.connection,
      result: pendingClarificationResult,
    });
    return;
  }

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

  if (existingTurnBuffer?.status === "awaiting_documentation_confirmation") {
    const pendingReplyInput = await getPendingReplyInput();
    const effectiveCommandText = normalizeCommandText(pendingReplyInput.text);

    if (isAffirmativeAnswer(effectiveCommandText)) {
      await persistInboundDocumentationMessage({
        ctx: options.ctx,
        locale: options.locale,
        payload: options.payload,
        phoneNumberE164: options.phoneNumberE164,
        connection: options.connection,
        threadId,
        bodyText: isAffirmativeAnswer(options.payload.body) ? "" : options.payload.body,
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

    if (pendingReplyInput.hadMedia && !pendingReplyInput.text) {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: buildPendingVoiceReplyPrompt(
          options.locale,
          documentationReminderMessage(options.locale),
        ),
        connectionId: options.connection._id,
      });

      return;
    }
  }

  let forceSendCommandText = commandText;
  if (existingTurnBuffer?.status === "awaiting_confirmation") {
    const pendingReplyInput = await getPendingReplyInput();
    forceSendCommandText = normalizeCommandText(pendingReplyInput.text);

    if (isNegativeCommand(forceSendCommandText)) {
      await options.ctx.runMutation(internal.whatsappData.updateTurnBufferStatus, {
        bufferId: existingTurnBuffer._id,
        status: "buffering",
        readyPromptSentAt: undefined,
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

    if (pendingReplyInput.hadMedia && !pendingReplyInput.text) {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: buildPendingVoiceReplyPrompt(options.locale, readyQuestionMessage(options.locale)),
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

  const mediaEntries = await buildStoredInboundMediaEntries({
    locale: options.locale,
    media: options.payload.media,
    store: options.ctx.storage.store,
  });

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
      threadId,
      text: clampMessageText(options.payload.body),
      media: mediaEntries,
      turnStatus: "buffered",
    },
  )) as { id: Id<"whatsappMessages"> };

  const turnBuffer = (await options.ctx.runMutation(internal.whatsappData.addMessageToTurnBuffer, {
    connectionId: options.connection._id,
    organizationId: options.connection.organizationId,
    userId: options.connection.userId,
    memberId: options.connection.memberId,
    threadId,
    messageId: insertedMessage.id,
  })) as WhatsAppTurnBufferDoc;

  const shouldForceSend = isAffirmativeAnswer(forceSendCommandText);

  const bufferedMessages = (await options.ctx.runQuery(internal.whatsappData.getMessagesByIds, {
    messageIds: turnBuffer.bufferedMessageIds,
  })) as WhatsAppMessageDoc[];

  const normalizedBufferedMessages = bufferedMessages
    .slice()
    .sort((messageA, messageB) => messageA.createdAt - messageB.createdAt);

  const aggregatedTranscription = normalizedBufferedMessages
    .flatMap((message) => message.media)
    .map((media) => media.transcription)
    .filter((value): value is string => !!value)
    .join("\n")
    .trim();

  const hasMedia = normalizedBufferedMessages.some((message) => message.media.length > 0);
  const hasAnyText = normalizedBufferedMessages.some(
    (message) => message.text.trim().length > 0,
  );

  if (
    shouldDeferMediaOnlyTurn({
      currentMessageHasMedia: options.payload.media.length > 0,
      hasAnyText,
      transcriptionText: aggregatedTranscription || null,
    })
  ) {
    await scheduleDocumentationReminder({
      ctx: options.ctx,
      bufferId: turnBuffer._id,
      connection: options.connection,
      locale: options.locale,
    });
    return;
  }

  const decision: TurnDetectionDecision = shouldForceSend
    ? {
        shouldSendNow: true,
        shouldAskReadyConfirmation: false,
        reason: "explicit_confirmation",
      }
    : await detectTurnReadiness({
        locale: options.locale,
        text: options.payload.body,
        hasMedia,
        mediaOnly: hasMedia && !hasAnyText,
        transcriptionText: aggregatedTranscription || null,
        messageCountInBuffer: normalizedBufferedMessages.length,
      });

  const shouldPromptForReady =
    decision.shouldAskReadyConfirmation &&
    !decision.shouldSendNow &&
    (!turnBuffer.readyPromptSentAt ||
      Date.now() - turnBuffer.readyPromptSentAt >= WHATSAPP_READY_PROMPT_COOLDOWN_MS);

  if (!decision.shouldSendNow) {
    if (shouldPromptForReady) {
      await options.ctx.runMutation(internal.whatsappData.updateTurnBufferStatus, {
        bufferId: turnBuffer._id,
        status: "awaiting_confirmation",
        readyPromptSentAt: Date.now(),
      });

      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: readyQuestionMessage(options.locale),
        connectionId: options.connection._id,
      });
    }

    return;
  }

  const routingContextResult = (await options.ctx.runAction(
    (internal as any).whatsappProcessing.lookupRoutingContext,
    {
      organizationId: options.connection.organizationId,
      queryText: normalizedBufferedMessages
        .flatMap((message) => [
          message.text,
          ...message.media.map((media) => media.transcription ?? ""),
        ])
        .join("\n"),
    },
  )) as {
    contextText: string | null;
  };

  const prompt = buildBufferedPrompt({
    locale: options.locale,
    messages: normalizedBufferedMessages,
    routingContextText: routingContextResult.contextText,
  });

  const attachments: ChatAttachment[] = normalizedBufferedMessages
    .flatMap((message) => message.media)
    .map((media) => ({
      name: media.fileName,
      contentType: media.contentType,
      storageId: media.storageId,
    }));

  const result = (await runBufferedTurnWithIndicator({
    ctx: options.ctx,
    locale: options.locale,
    connection: options.connection,
    args: {
      organizationId: options.connection.organizationId,
      userId: options.connection.userId,
      memberId: options.connection.memberId,
      threadId,
      locale: options.locale,
      prompt,
      attachments,
      sourceMessageIds: normalizedBufferedMessages.map((message) => message._id),
    },
  })) as {
    text: string | null;
    responseKind: "answer" | "clarification" | "approval_required";
    clarificationSessionId: string | null;
    pendingActionId: string | null;
  };

  const sourceMessageIds = normalizedBufferedMessages.map((message) => message._id);
  const canDeliverAgentResponse = await sourceMessagesStillAvailableForAgentResponse({
    ctx: options.ctx,
    sourceMessageIds,
  });

  if (!canDeliverAgentResponse) {
    return;
  }

  let clarificationText: string | null = null;

  if (result.responseKind === "clarification" && result.clarificationSessionId) {
    const clarificationSession = (await options.ctx.runQuery(
      internal.aiState.getClarificationSessionById,
      {
        clarificationSessionId: result.clarificationSessionId as Id<"aiClarificationSessions">,
      },
    )) as {
      title: string;
      questions: Array<{
        prompt: string;
        options: Array<{ id: string; label: string; description: string }>;
      }>;
    } | null;

    if (clarificationSession) {
      clarificationText = clarificationSession.questions
        .map((question, index) => {
          return clarificationQuestionMessage({
            locale: options.locale,
            title: clarificationSession.title,
            prompt: question.prompt,
            options: question.options,
            questionIndex: index,
            questionCount: clarificationSession.questions.length,
          });
        })
        .join("\n\n");
    }
  }

  const outboundText = clarificationText ?? result.text;
  if (outboundText) {
    const canDeliverOutboundText = await sourceMessagesStillAvailableForAgentResponse({
      ctx: options.ctx,
      sourceMessageIds,
    });

    if (!canDeliverOutboundText) {
      return;
    }

    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: outboundText,
      connectionId: options.connection._id,
    });
  }

  const canMarkMessages = await sourceMessagesStillAvailableForAgentResponse({
    ctx: options.ctx,
    sourceMessageIds,
  });

  if (!canMarkMessages) {
    return;
  }

  await options.ctx.runMutation(internal.whatsappData.markMessagesSentToAgent, {
    messageIds: sourceMessageIds,
  });
  await options.ctx.runMutation(internal.whatsappData.clearTurnBufferByConnection, {
    connectionId: options.connection._id,
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

export const sendDocumentationReminder = internalAction({
  args: {
    bufferId: v.id("whatsappTurnBuffers"),
    connectionId: v.id("whatsappConnections"),
    phoneNumberE164: v.string(),
    locale: vAppLocale,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turnBuffer = (await ctx.runQuery(internal.whatsappData.getTurnBufferByConnection, {
      connectionId: args.connectionId,
    })) as WhatsAppTurnBufferDoc | null;

    if (!turnBuffer || turnBuffer._id !== args.bufferId || turnBuffer.status !== "buffering") {
      return null;
    }

    const bufferedMessages = (await ctx.runQuery(internal.whatsappData.getMessagesByIds, {
      messageIds: turnBuffer.bufferedMessageIds,
    })) as WhatsAppMessageDoc[];
    const normalizedBufferedMessages = bufferedMessages
      .slice()
      .sort((messageA, messageB) => messageA.createdAt - messageB.createdAt);
    const latestBufferedMessage =
      normalizedBufferedMessages[normalizedBufferedMessages.length - 1] ?? null;

    if (
      !latestBufferedMessage ||
      latestBufferedMessage.media.length === 0 ||
      Date.now() - turnBuffer.lastBufferedAt < WHATSAPP_THREAD_READINESS_BUFFER_MS
    ) {
      return null;
    }

    await ctx.runMutation(internal.whatsappData.updateTurnBufferStatus, {
      bufferId: turnBuffer._id,
      status: "awaiting_documentation_confirmation",
      readyPromptSentAt: undefined,
      documentationPromptSentAt: Date.now(),
      documentationReminderJobId: undefined,
    });

    await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: args.phoneNumberE164,
      locale: args.locale,
      text: documentationReminderMessage(args.locale),
      connectionId: args.connectionId,
    });

    return null;
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

export const runAgentForBufferedTurn: any = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    memberId: v.string(),
    threadId: v.string(),
    locale: vAppLocale,
    prompt: v.string(),
    attachments: v.array(
      v.object({
        name: v.optional(v.string()),
        contentType: v.string(),
        storageId: v.id("_storage"),
      }),
    ),
    sourceMessageIds: v.array(v.id("whatsappMessages")),
  },
  returns: v.object({
    text: v.union(v.string(), v.null()),
    responseKind: v.union(
      v.literal("answer"),
      v.literal("clarification"),
      v.literal("approval_required"),
    ),
    clarificationSessionId: v.union(v.string(), v.null()),
    pendingActionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<RunAgentForBufferedTurnResult> => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error("AI gateway is not configured");
    }

    const modelId = process.env.AI_GATEWAY_MODEL ?? WHATSAPP_AGENT_MODEL ?? DEFAULT_AI_GATEWAY_MODEL;
    const locale = toLocale(args.locale);

    const member = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: args.memberId,
        },
      ],
    })) as MemberDoc | null;

    if (!member || member.organizationId !== args.organizationId || member.userId !== args.userId) {
      throw new Error("Invalid member context");
    }

    const userResult = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: args.userId,
        },
      ],
    })) as UserDoc | null;

    if (!userResult) {
      throw new Error("User not found");
    }

    const normalizedPrompt = clampMessageText(args.prompt);
    const attachments = normalizeAttachments(args.attachments as ChatAttachment[]);
    const resolvedAttachments = await resolveAttachmentsFromStorage(ctx, attachments);
    if (resolvedAttachments.length !== attachments.length) {
      throw new Error("One or more attachments are no longer available");
    }

    const thread = (await ctx.runQuery(internal.aiState.getChatThreadById, {
      threadId: args.threadId,
    })) as {
      organizationId: string;
      userId: string;
      resourceId: string;
      channel: "web" | "whatsapp";
      memberId: string | null;
    } | null;

    if (
      thread &&
      (thread.organizationId !== args.organizationId ||
        thread.userId !== args.userId ||
        (thread.channel ?? "web") !== "whatsapp")
    ) {
      throw new Error("Invalid chat thread id");
    }

    const resourceId =
      thread?.resourceId ??
      getMastraResourceId({
        organizationId: args.organizationId,
        userId: args.userId,
      });

    const userMessage = buildUserMessage({
      prompt: normalizedPrompt,
      attachments: resolvedAttachments,
    });
    const persistedUserContent = buildPersistedUserMessageContent({
      prompt: normalizedPrompt,
      attachments: resolvedAttachments,
    });

    const userPersistedMessage = buildPersistedMessage({
      messageId: createMessageId(`${args.threadId}:user`),
      role: "user",
      type: "text",
      content: persistedUserContent,
      text:
        typeof userMessage.content === "string"
          ? userMessage.content
          : normalizedPrompt ||
            resolvedAttachments.map((attachment) => attachment.name ?? "Attachment").join(", "),
      attachmentNames: resolvedAttachments.map((attachment) => attachment.name ?? "Attachment"),
    });

    await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
      threadId: args.threadId,
      resourceId,
      organizationId: args.organizationId,
      userId: args.userId,
      channel: WHATSAPP_CHANNEL,
      memberId: args.memberId,
      messages: [userPersistedMessage],
    });

    const historyMessages = (await ctx.runQuery(internal.aiState.getMessagesForGeneration, {
      threadId: args.threadId,
    })) as GenerationHistoryMessage[];

    const auth = createAuth(ctx as any);
    await ensureServiceSessionForUser(ctx, {
      userId: args.userId,
      organizationId: args.organizationId,
      userAgent: "whatsapp-run-agent",
    });
    const headers = await getSessionHeadersForUser(
      ctx,
      args.userId,
      args.organizationId,
    );

    const {
      permissionFlags,
      readWorkspaceSnapshot,
      organizationAdminTools,
      customerTools,
      projectTools,
      userAccountTools,
    } = await buildWorkspaceAgentTools({
      auth,
      headers,
      channel: "whatsapp",
      ctx,
      locale,
      memberRole: member.role,
      organizationId: args.organizationId,
      prompt: normalizedPrompt,
      resourceId,
      threadId: args.threadId,
      userId: args.userId,
      createPendingAction: async ({ actionType, payload }) => {
        return await ctx.runMutation(internal.aiState.upsertPendingAction, {
          threadId: args.threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: args.userId,
          actionType,
          payload,
          expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
        });
      },
    });

    const contextPacket = compileAgentContextPacket({
      locale,
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: args.userId,
      currentMemberRole: member.role,
      prompt: normalizedPrompt,
      attachmentNames: resolvedAttachments.map((attachment) => attachment.name ?? "Attachment"),
      attachments: resolvedAttachments.map((attachment) => ({
        name: attachment.name ?? "Attachment",
        contentType: attachment.contentType,
        storageId: attachment.storageId,
        fileUrl: attachment.fileUrl,
      })),
      pageContext: null,
      permissions: permissionFlags,
      historyMessages,
    });

    const agent = createWorkspaceAgent({
      channel: "whatsapp",
      organizationId: args.organizationId,
      modelId,
      locale,
      responseFormat: "whatsapp",
      contextPacket: formatContextPacketForInstructions(contextPacket),
      readWorkspaceSnapshot,
      organizationAdminTools,
      customerTools,
      projectTools,
      userAccountTools,
    });

    await ctx.runMutation(internal.aiState.setChatThreadState, {
      threadId: args.threadId,
      resourceId,
      organizationId: args.organizationId,
      userId: args.userId,
      status: "running",
      lastError: null,
      lastRunId: null,
      streamingText: "",
      streamPhase: "thinking",
      streamActor: "main",
      activeToolLabel: null,
    });

    let streamedText = "";
    let streamPhase: "idle" | "thinking" | "delegating" | "tool" | "responding" =
      "thinking";
    let streamActor: "main" | "organization" | "customer" | "project" | "user" =
      "main";
    let activeToolLabel: string | null = null;

    const setStreamState = (nextState: {
      phase?: "idle" | "thinking" | "delegating" | "tool" | "responding";
      actor?: "main" | "organization" | "customer" | "project" | "user";
      toolLabel?: string | null;
    }) => {
      let changed = false;

      if (nextState.phase && nextState.phase !== streamPhase) {
        streamPhase = nextState.phase;
        changed = true;
      }

      if (nextState.actor && nextState.actor !== streamActor) {
        streamActor = nextState.actor;
        changed = true;
      }

      if (nextState.toolLabel !== undefined && nextState.toolLabel !== activeToolLabel) {
        activeToolLabel = nextState.toolLabel;
        changed = true;
      }

      return changed;
    };

    try {
      const stream = await agent.stream(
        historyMessages.map((message: GenerationHistoryMessage) => ({
          role: message.role,
          content: toGenerationContent({
            type: message.type,
            content: message.content,
          }),
        })) as Parameters<typeof agent.stream>[0],
      );

      let lastFlushAt = 0;
      const flushStreamState = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastFlushAt < STREAM_FLUSH_INTERVAL_MS) {
          return;
        }

        lastFlushAt = now;
        await ctx.runMutation(internal.aiState.setChatThreadState, {
          threadId: args.threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: args.userId,
          status: "running",
          lastError: null,
          lastRunId: null,
          streamingText: streamedText,
          streamPhase,
          streamActor,
          activeToolLabel,
        });
      };

      for await (const chunk of stream.fullStream) {
        const type = getChunkType(chunk);
        const payload = getChunkPayload(chunk);
        let shouldForceFlush = false;

        if (type === "text-delta") {
          const textDelta = getTextDeltaFromChunk(chunk, payload);
          if (textDelta) {
            streamedText += textDelta;
          }

          shouldForceFlush = setStreamState({
            phase: "responding",
            actor: "main",
            toolLabel: null,
          });
        } else if (type === "tool-call") {
          const toolName = payload
            ? getRecordString(payload, "toolName")
            : isRecord(chunk)
              ? getRecordString(chunk, "toolName")
              : null;

          const delegatedActor = resolveStreamActor(toolName);
          if (delegatedActor !== "main") {
            shouldForceFlush = setStreamState({
              phase: "delegating",
              actor: delegatedActor,
              toolLabel: null,
            });
          } else {
            shouldForceFlush = setStreamState({
              phase: "tool",
              toolLabel: toolName,
            });
          }
        } else if (type === "tool-result") {
          const toolName = payload
            ? getRecordString(payload, "toolName")
            : isRecord(chunk)
              ? getRecordString(chunk, "toolName")
              : null;

          const delegatedActor = resolveStreamActor(toolName);
          if (delegatedActor !== "main") {
            shouldForceFlush = setStreamState({
              phase: "thinking",
              actor: delegatedActor,
              toolLabel: null,
            });
          } else {
            shouldForceFlush = setStreamState({
              phase: "thinking",
              toolLabel: null,
            });
          }
        } else if (type === "routing-agent-start") {
          shouldForceFlush = setStreamState({
            phase: "delegating",
            actor: "main",
            toolLabel: null,
          });
        } else if (type === "agent-execution-start") {
          const agentId = payload
            ? getRecordString(payload, "agentId")
            : isRecord(chunk)
              ? getRecordString(chunk, "agentId")
              : null;

          shouldForceFlush = setStreamState({
            phase: "thinking",
            actor: resolveStreamActor(agentId),
            toolLabel: null,
          });
        } else if (type === "step-start") {
          shouldForceFlush = setStreamState({
            phase: streamedText.length > 0 ? "responding" : "thinking",
          });
        }

        await flushStreamState(shouldForceFlush);
      }

      await flushStreamState(true);

      const fullOutput = await stream.getFullOutput();
      const textFromOutput =
        typeof fullOutput.text === "string" ? fullOutput.text.trim() : "";
      const finalText = textFromOutput || streamedText.trim();

      const toolCalls = extractToolCalls(fullOutput.toolCalls);
      const toolResults = extractToolResults(fullOutput.toolResults);
      const responseKindFromTools = detectResponseKindFromToolResults(toolResults);
      const pendingActionId = getApprovalPendingActionId(toolResults);
      const clarificationToolRequest = getClarificationToolRequest(toolResults);
      let clarificationSessionId: string | null = null;
      let responseKind: "answer" | "clarification" | "approval_required" = responseKindFromTools;
      let finalTextForPersist = finalText;

      if (clarificationToolRequest) {
        const clarificationTemplate = buildClarificationTemplateFromTool({
          locale,
          questions: clarificationToolRequest.questions,
          reason: clarificationToolRequest.reason,
        });

        const clarificationSession = (await ctx.runMutation(
          internal.aiState.upsertPendingClarificationSession,
          {
            threadId: args.threadId,
            resourceId,
            organizationId: args.organizationId,
            userId: args.userId,
            intent: "generic",
            contextVersion: contextPacket.version,
            prompt: normalizedPrompt,
            title: clarificationTemplate.title,
            description: clarificationTemplate.description,
            assistantMessage: clarificationTemplate.assistantMessage,
            questions: clarificationTemplate.questions,
            expiresAt: Date.now() + CLARIFICATION_TTL_MS,
          },
        )) as { clarificationSessionId: string };

        clarificationSessionId = clarificationSession.clarificationSessionId;
        responseKind = "clarification";
        if (!finalTextForPersist.trim()) {
          finalTextForPersist = clarificationTemplate.assistantMessage;
        }
      }

      const newMessages: PersistedMessage[] = [];

      if (toolCalls.length > 0) {
        newMessages.push(
          buildPersistedMessage({
            messageId: createMessageId(`${args.threadId}:tool-call`),
            role: "assistant",
            type: "tool-call",
            content: toolCalls.map((toolCall) => ({
              type: "tool-call",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              args: toolCall.args,
            })),
          }),
        );
      }

      if (toolResults.length > 0) {
        newMessages.push(
          buildPersistedMessage({
            messageId: createMessageId(`${args.threadId}:tool-result`),
            role: "tool",
            type: "tool-result",
            content: toolResults.map((toolResult) => ({
              type: "tool-result",
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName,
              result: toolResult.result,
              isError: toolResult.isError,
            })),
          }),
        );
      }

      if (finalTextForPersist.length > 0) {
        newMessages.push(
          buildPersistedMessage({
            messageId: createMessageId(`${args.threadId}:assistant`),
            role: "assistant",
            type: "text",
            content: finalTextForPersist,
            text: finalTextForPersist,
          }),
        );
      }

      if (newMessages.length > 0) {
        await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
          threadId: args.threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: args.userId,
          channel: WHATSAPP_CHANNEL,
          memberId: args.memberId,
          messages: newMessages,
        });
      }

      await ctx.runMutation(internal.aiState.setChatThreadState, {
        threadId: args.threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: args.userId,
        status: "idle",
        lastError: null,
        lastRunId: null,
        streamingText: null,
        streamPhase: "idle",
        streamActor: "main",
        activeToolLabel: null,
      });

      return {
        text: finalTextForPersist || null,
        responseKind,
        clarificationSessionId,
        pendingActionId,
      };
    } catch (error) {
      await ctx.runMutation(internal.aiState.setChatThreadState, {
        threadId: args.threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: args.userId,
        status: "error",
        lastError: errorMessageFromUnknown(error),
        lastRunId: null,
        streamingText: streamedText.trim() || null,
        streamPhase: "idle",
        streamActor: "main",
        activeToolLabel: null,
      });

      throw error;
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

export const detectTurnIntent = internalAction({
  args: {
    locale: vAppLocale,
    text: v.string(),
    hasMedia: v.boolean(),
    mediaOnly: v.boolean(),
    transcriptionText: v.union(v.string(), v.null()),
    messageCountInBuffer: v.number(),
  },
  handler: async (_ctx, args) => {
    return await detectTurnReadiness({
      locale: args.locale,
      text: args.text,
      hasMedia: args.hasMedia,
      mediaOnly: args.mediaOnly,
      transcriptionText: args.transcriptionText,
      messageCountInBuffer: args.messageCountInBuffer,
    });
  },
});

export const suggestClarificationUi = internalAction({
  args: {
    locale: vAppLocale,
    title: v.string(),
    prompt: v.string(),
    options: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        description: v.string(),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    const turnModel = process.env.AI_GATEWAY_TURN_MODEL ?? WHATSAPP_TURN_DETECTION_MODEL;
    const schema = z.object({
      shortInstruction: z.string(),
      exampleAnswer: z.string(),
    });

    const response = await generateObject({
      model: gateway(turnModel),
      schema,
      prompt:
        args.locale === "de"
          ? `Erzeuge eine sehr kurze Anleitung für eine WhatsApp-Rückfrage mit numerischen Optionen. Titel: ${args.title}. Frage: ${args.prompt}. Optionen: ${args.options
              .map((option, index) => `${index + 1}. ${option.label}`)
              .join(" | ")}`
          : `Create a very short instruction for a WhatsApp clarification question with numeric options. Title: ${args.title}. Prompt: ${args.prompt}. Options: ${args.options
              .map((option, index) => `${index + 1}. ${option.label}`)
              .join(" | ")}`,
    });

    return response.object;
  },
});
