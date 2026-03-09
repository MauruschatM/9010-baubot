'use node';

import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { v } from "convex/values";
import { z } from "zod";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import {
  compileAgentContextPacket,
  formatContextPacketForInstructions,
} from "../mastra/agentContext/compiler";
import { createAuth } from "./auth";
import {
  createWorkspaceAgent,
  DEFAULT_AI_GATEWAY_MODEL,
} from "../mastra/agent";
import type {
  ConnectedWhatsAppRecipient,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationSummary,
  ProactiveWhatsAppSendResult,
  UserSettingsSummary,
  WorkspaceSnapshot,
} from "../mastra/tools";
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
  WHATSAPP_TURN_DETECTION_MODEL,
  WHATSAPP_TYPING_FALLBACK_DELAY_MS,
} from "./whatsapp/constants";
import {
  clarificationMissingAnswerMessage,
  clarificationQuestionMessage,
  invalidEmailMessage,
  invalidOtpMessage,
  onboardingCompletedMessage,
  onboardingGreetingMessages,
  onboardingOtpAttemptsExceededMessage,
  onboardingSwitchHintMessage,
  processingFallbackMessage,
  readyQuestionMessage,
  switchPromptMessage,
  switchSuccessMessage,
  transcriptionPrefix,
  unlinkConfirmationMessage,
  unlinkSuccessMessage,
  unsupportedCommandMessage,
  waitForMoreMessage,
  askOtpMessage,
} from "./whatsapp/messages";
import {
  extractEmailCandidate,
  extractOtpCandidate,
  inferLocaleFromPhoneNumber,
  hasExplicitProactiveSendIntent,
  isAffirmativeAnswer,
  isNegativeCommand,
  isSendCommand,
  isSwitchCommand,
  isUnlinkCommand,
  normalizeCommandText,
  normalizePhoneNumber,
  slugFromOrganizationSeed,
} from "./whatsapp/normalize";
import { transcribeWhatsAppMedia } from "./whatsapp/transcription";
import { detectTurnReadiness } from "./whatsapp/turnDetection";
import {
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

type SessionDoc = {
  _id: string;
  userId: string;
  token: string;
  expiresAt: number | string | Date;
  updatedAt?: number;
  activeOrganizationId?: string | null;
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
  status: "buffering" | "awaiting_confirmation";
  bufferedMessageIds: Id<"whatsappMessages">[];
  firstBufferedAt: number;
  lastBufferedAt: number;
  readyPromptSentAt?: number;
  updatedAt: number;
};

type OnboardingSessionDoc = {
  _id: Id<"whatsappOnboardingSessions">;
  phoneNumberE164: string;
  status: "active" | "completed" | "expired";
  stage:
    | "awaiting_email"
    | "awaiting_otp"
    | "awaiting_switch_selection"
    | "awaiting_unlink_confirmation"
    | "ready";
  locale: "en" | "de";
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

type ToolPermissionFlags = {
  canUpdateOrganization: boolean;
  canInviteMembers: boolean;
  canUpdateMembers: boolean;
  canRemoveMembers: boolean;
  canCancelInvitations: boolean;
  canDeleteOrganization: boolean;
  canLeaveOrganization: boolean;
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
const MAX_ONBOARDING_OTP_ATTEMPTS = 6;
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

function normalizeDateLike(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  return 0;
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
    getRecordString(result, "actionType") === "delete-organization"
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
  locale: "en" | "de";
  questions: string[];
  reason?: string | null;
}) {
  const normalizedQuestions = options.questions
    .map((question) => question.trim())
    .filter((question, index, allQuestions) => {
      return question.length > 0 && allQuestions.indexOf(question) === index;
    })
    .slice(0, 3);

  const fallbackQuestion =
    options.locale === "de"
      ? "Welche fehlenden Details soll ich für dich ergänzen?"
      : "Which missing details should I add before I continue?";

  const clarificationPrompts =
    normalizedQuestions.length > 0 ? normalizedQuestions : [fallbackQuestion];

  if (options.locale === "de") {
    return {
      title: "Rückfrage erforderlich",
      description:
        options.reason ??
        "Bitte beantworte die Rückfrage, damit ich den Auftrag fortsetzen kann.",
      assistantMessage:
        clarificationPrompts.length === 1
          ? clarificationPrompts[0]!
          : "Ich brauche noch ein paar kurze Angaben, bevor ich fortfahre.",
      questions: clarificationPrompts.map((prompt, index) => ({
        id: `details_${index + 1}`,
        prompt,
        options: [
          {
            id: "provide_details",
            label: "Details angeben (Empfohlen)",
            description:
              "Fehlende Details im Freitextfeld ergänzen, damit ich fortfahren kann.",
          },
          {
            id: "use_current_data",
            label: "Aktuelle Daten nutzen",
            description:
              "Mit den derzeit bekannten Daten fortfahren, falls ausreichend.",
          },
          {
            id: "cancel_request",
            label: "Vorgang abbrechen",
            description: "Diesen Vorgang nicht fortsetzen.",
          },
        ],
        allowOther: true,
        required: true,
      })),
    };
  }

  return {
    title: "Clarification needed",
    description:
      options.reason ??
      "Please answer the question so I can continue with your request.",
    assistantMessage:
      clarificationPrompts.length === 1
        ? clarificationPrompts[0]!
        : "I need a few quick details before I continue.",
    questions: clarificationPrompts.map((prompt, index) => ({
      id: `details_${index + 1}`,
      prompt,
      options: [
        {
          id: "provide_details",
          label: "Provide details (Recommended)",
          description:
            "Add the missing detail in the free-text field so I can continue.",
        },
        {
          id: "use_current_data",
          label: "Use current data",
          description: "Proceed with the currently available data if sufficient.",
        },
        {
          id: "cancel_request",
          label: "Cancel request",
          description: "Do not continue with this operation.",
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

function normalizeMember(member: unknown): OrganizationMember | null {
  if (!isRecord(member)) {
    return null;
  }

  const id = getRecordString(member, "id");
  const userId = getRecordString(member, "userId");
  const role = getRecordString(member, "role") ?? "member";
  const user = isRecord(member.user) ? member.user : null;
  const email =
    (user && getRecordString(user, "email")) ??
    getRecordString(member, "email") ??
    "";
  const name =
    (user && getRecordString(user, "name")) ?? getRecordString(member, "name") ?? email;

  if (!id || !userId) {
    return null;
  }

  return {
    id,
    userId,
    role,
    email,
    name,
  };
}

function normalizeInvitation(invitation: unknown): OrganizationInvitation | null {
  if (!isRecord(invitation)) {
    return null;
  }

  const id = getRecordString(invitation, "id");
  const email = getRecordString(invitation, "email") ?? "";
  const role = getRecordString(invitation, "role") ?? "member";
  const status = getRecordString(invitation, "status") ?? "pending";

  if (!id) {
    return null;
  }

  return {
    id,
    email,
    role,
    status,
  };
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

async function hasOrganizationPermission(options: {
  auth: AuthApiClient;
  headers: Headers;
  organizationId: string;
  permissions: Record<string, string[]>;
}) {
  try {
    const response = await callAuthApi(options.auth, "hasPermission", {
      body: {
        organizationId: options.organizationId,
        permissions: options.permissions,
      },
      headers: options.headers,
    });

    return isRecord(response) && response.success === true;
  } catch {
    return false;
  }
}

async function getToolPermissionFlags(options: {
  auth: AuthApiClient;
  headers: Headers;
  organizationId: string;
}) {
  const [
    canUpdateOrganization,
    canInviteMembers,
    canUpdateMembers,
    canRemoveMembers,
    canCancelInvitations,
    canDeleteOrganization,
  ] = await Promise.all([
    hasOrganizationPermission({
      ...options,
      permissions: {
        organization: ["update"],
      },
    }),
    hasOrganizationPermission({
      ...options,
      permissions: {
        invitation: ["create"],
      },
    }),
    hasOrganizationPermission({
      ...options,
      permissions: {
        member: ["update"],
      },
    }),
    hasOrganizationPermission({
      ...options,
      permissions: {
        member: ["delete"],
      },
    }),
    hasOrganizationPermission({
      ...options,
      permissions: {
        invitation: ["cancel"],
      },
    }),
    hasOrganizationPermission({
      ...options,
      permissions: {
        organization: ["delete"],
      },
    }),
  ]);

  return {
    canUpdateOrganization,
    canInviteMembers,
    canUpdateMembers,
    canRemoveMembers,
    canCancelInvitations,
    canDeleteOrganization,
    canLeaveOrganization: true,
  } satisfies ToolPermissionFlags;
}

async function getSessionHeadersForUser(ctx: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, userId: string) {
  const sessionsResult = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "session",
    where: [
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: 20,
    },
  })) as { page?: SessionDoc[] };

  const sessions = (sessionsResult.page ?? []) as SessionDoc[];
  const now = Date.now();

  const activeSession = sessions
    .filter((session) => {
      const expiresAt = normalizeDateLike(session.expiresAt);
      return session.token && expiresAt > now;
    })
    .sort((sessionA, sessionB) => {
      const updatedAtA = sessionA.updatedAt ?? 0;
      const updatedAtB = sessionB.updatedAt ?? 0;
      return updatedAtB - updatedAtA;
    })[0];

  const headers = new Headers();
  if (activeSession?.token) {
    headers.set("cookie", `better-auth.session_token=${activeSession.token}`);
  }

  return headers;
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
  locale: "en" | "de";
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
  locale: "en" | "de";
  messages: WhatsAppMessageDoc[];
}) {
  const promptParts: string[] = [];

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

async function sendOutboundMessage(options: {
  text: string;
  phoneNumberE164: string;
  locale: "en" | "de";
  connection: WhatsAppConnectionDoc | null;
  runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return;
  }

  const body = options.text.trim();
  if (!body) {
    return;
  }

  const chunks = splitOutboundTextForWhatsApp(body);
  if (chunks.length === 0) {
    return;
  }

  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunkIndex > 0) {
      await sleep(WHATSAPP_OUTBOUND_CHUNK_DELAY_MS);
    }

    const twilioResponse = await sendTwilioWhatsAppMessage({
      accountSid,
      authToken,
      fromNumber,
      toNumber: options.phoneNumberE164,
      body: chunk,
    });

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

async function processPendingClarification(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: "en" | "de";
  messageText: string;
  threadId: string;
  organizationId: string;
  userId: string;
  memberId: string;
}) {
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

  const answers = buildClarificationAnswersFromMessage({
    questions: session.questions,
    messageText: options.messageText,
  });

  if (!answers) {
    const firstQuestion = session.questions[0];
    if (!firstQuestion) {
      return {
        handled: true,
        reply: clarificationMissingAnswerMessage(options.locale),
      };
    }

    return {
      handled: true,
      reply: [
        clarificationMissingAnswerMessage(options.locale),
        clarificationQuestionMessage({
          locale: options.locale,
          title:
            options.locale === "de"
              ? "Bitte Rückfrage beantworten"
              : "Please answer the clarification",
          prompt: firstQuestion.prompt,
          options: firstQuestion.options,
          questionIndex: 0,
          questionCount: session.questions.length,
        }),
      ].join("\n\n"),
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

async function runBufferedTurnWithIndicator(options: {
  ctx: {
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  locale: "en" | "de";
  args: {
    organizationId: string;
    userId: string;
    memberId: string;
    threadId: string;
    locale: "en" | "de";
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
    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: processingFallbackMessage(options.locale),
      connectionId: options.connection._id,
    });

    return await runPromise;
  }

  return firstResult.result;
}

async function processConnectedInbound(options: {
  ctx: {
    runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
    runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
    storage: {
      store: (blob: Blob) => Promise<Id<"_storage">>;
    };
  };
  payload: TwilioInboundPayload;
  locale: "en" | "de";
  phoneNumberE164: string;
  connection: WhatsAppConnectionDoc;
}) {
  const threadId = getMastraWhatsAppThreadId({
    organizationId: options.connection.organizationId,
    memberId: options.connection.memberId,
  });

  const commandText = normalizeCommandText(options.payload.body);

  const pendingClarificationResult = await processPendingClarification({
    ctx: options.ctx,
    locale: options.locale,
    messageText: options.payload.body,
    threadId,
    organizationId: options.connection.organizationId,
    userId: options.connection.userId,
    memberId: options.connection.memberId,
  });

  if (pendingClarificationResult.handled) {
    if (pendingClarificationResult.reply) {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: pendingClarificationResult.reply,
        connectionId: options.connection._id,
      });
    }

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

  const mediaEntries: StoredWhatsAppMedia[] = [];
  for (const mediaItem of options.payload.media) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        continue;
      }

      const mediaResponse = await fetch(mediaItem.mediaUrl, {
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        },
      });
      if (!mediaResponse.ok) {
        continue;
      }

      const mediaBlob = await mediaResponse.blob();
      const mediaBytes = new Uint8Array(await mediaBlob.arrayBuffer());
      const storageId = await options.ctx.storage.store(mediaBlob);
      const transcription = await transcribeWhatsAppMedia({
        fileBytes: mediaBytes,
        contentType: mediaItem.contentType,
        locale: options.locale,
      });

      mediaEntries.push({
        storageId,
        contentType: mediaItem.contentType,
        fileName: mediaItem.fileName,
        mediaUrl: mediaItem.mediaUrl,
        transcription: transcription ?? undefined,
        transcriptionModel: transcription ? "groq:whisper-large-v3" : undefined,
      });
    } catch {
      // Skip failed media item.
    }
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

  if (turnBuffer.status === "awaiting_confirmation" && isNegativeCommand(commandText)) {
    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: waitForMoreMessage(options.locale),
      connectionId: options.connection._id,
    });
    return;
  }

  const shouldForceSend = isSendCommand(commandText) || isAffirmativeAnswer(commandText);

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

  const decision: TurnDetectionDecision = shouldForceSend
    ? {
        shouldSendNow: true,
        shouldAskReadyConfirmation: false,
        reason: "explicit_send_command",
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

  const prompt = buildBufferedPrompt({
    locale: options.locale,
    messages: normalizedBufferedMessages,
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

  if (result.text) {
    await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
      phoneNumberE164: options.connection.phoneNumberE164,
      locale: options.locale,
      text: result.text,
      connectionId: options.connection._id,
    });
  }

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
      const clarificationText = clarificationSession.questions
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

      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: options.connection.phoneNumberE164,
        locale: options.locale,
        text: clarificationText,
        connectionId: options.connection._id,
      });
    }
  }

  await options.ctx.runMutation(internal.whatsappData.markMessagesSentToAgent, {
    messageIds: normalizedBufferedMessages.map((message) => message._id),
  });
  await options.ctx.runMutation(internal.whatsappData.clearTurnBufferByConnection, {
    connectionId: options.connection._id,
  });
}

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

    // Start WhatsApp typing indicator as early as possible after receiving a user message.
    if (payload.messageSid) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (accountSid && authToken) {
        try {
          await sendTwilioWhatsAppTypingIndicator({
            accountSid,
            authToken,
            messageId: payload.messageSid,
          });
        } catch (error) {
          console.warn("Failed to start WhatsApp typing indicator", {
            phoneNumberE164: normalizedPhone.e164,
            message: errorMessageFromUnknown(error),
          });
        }
      }
    }

    const activeConnection = (await ctx.runQuery(
      internal.whatsappData.getActiveConnectionByPhone,
      {
        phoneNumberE164: normalizedPhone.e164,
      },
    )) as WhatsAppConnectionDoc | null;

    const locale = await resolveInboundLocale({
      runQuery: ctx.runQuery,
      phoneNumberE164: normalizedPhone.e164,
      userId: activeConnection?.userId,
    });

    if (!activeConnection) {
      await ctx.runAction((internal as any).whatsapp.processOnboardingInbound, {
        phoneNumberE164: normalizedPhone.e164,
        locale,
        payload,
      });
      return {
        handled: true,
      };
    }

    await processConnectedInbound({
      ctx,
      payload,
      locale,
      phoneNumberE164: normalizedPhone.e164,
      connection: activeConnection,
    });

    return {
      handled: true,
    };
  },
});

export const processOnboardingInbound = internalAction({
  args: {
    phoneNumberE164: v.string(),
    locale: v.union(v.literal("en"), v.literal("de")),
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

      const auth = createAuth(ctx as any);
      await callAuthApi(auth, "sendVerificationOTP", {
        body: {
          email,
          type: "sign-in",
        },
        headers: new Headers(),
      });

      await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
        phoneNumberE164: args.phoneNumberE164,
        status: "active",
        stage: "awaiting_otp",
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
        text: askOtpMessage(locale, email),
      });
      return;
    }

    if (existingSession.stage === "awaiting_otp") {
      const normalizedOtpInput = normalizeCommandText(args.payload.body);
      if (existingSession.email && normalizedOtpInput.includes("send")) {
        const auth = createAuth(ctx as any);
        await callAuthApi(auth, "sendVerificationOTP", {
          body: {
            email: existingSession.email,
            type: "sign-in",
          },
          headers: new Headers(),
        });

        await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
          phoneNumberE164: args.phoneNumberE164,
          status: "active",
          stage: "awaiting_otp",
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
          text: askOtpMessage(existingSession.locale, existingSession.email),
        });
        return;
      }

      const otp = extractOtpCandidate(args.payload.body);
      if (!otp || !existingSession.email) {
        await ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
          phoneNumberE164: args.phoneNumberE164,
          locale: existingSession.locale,
          text: invalidOtpMessage(existingSession.locale),
        });
        return;
      }

      const auth = createAuth(ctx as any);

      try {
        const signInResult = await callAuthApi(auth, "signInEmailOTP", {
          body: {
            email: existingSession.email,
            otp,
          },
          headers: new Headers(),
        });

        const userFromSignIn = normalizeUserInfo(signInResult);
        const userFromDirectory = userFromSignIn
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
        const user = userFromSignIn ?? normalizeUserInfo(userFromDirectory);
        if (!user) {
          throw new Error("Unable to resolve signed-in user");
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
        console.error("WhatsApp onboarding OTP verification failed", {
          phoneNumberE164: args.phoneNumberE164,
          message: errorMessageFromUnknown(error),
        });

        const nextAttempts = existingSession.otpAttempts + 1;
        const shouldExpire = nextAttempts >= MAX_ONBOARDING_OTP_ATTEMPTS;

        await ctx.runMutation(internal.whatsappData.upsertOnboardingSession, {
          phoneNumberE164: args.phoneNumberE164,
          status: shouldExpire ? "expired" : "active",
          stage: shouldExpire ? "awaiting_email" : "awaiting_otp",
          locale: existingSession.locale,
          email: shouldExpire ? undefined : existingSession.email,
          userId: existingSession.userId,
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
            ? onboardingOtpAttemptsExceededMessage(existingSession.locale)
            : invalidOtpMessage(existingSession.locale),
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
    locale: v.union(v.literal("en"), v.literal("de")),
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
    const headers = await getSessionHeadersForUser(ctx, args.userId);

    const permissionFlags = await getToolPermissionFlags({
      auth,
      headers,
      organizationId: args.organizationId,
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

    const listOrganizationMembers = async (): Promise<OrganizationMember[]> => {
      const response = await callAuthApi(auth, "listMembers", {
        query: {
          organizationId: args.organizationId,
        },
        headers,
      });

      const records =
        isRecord(response) && Array.isArray(response.members)
          ? response.members
          : [];

      return records
        .map((entry) => normalizeMember(entry))
        .filter((entry): entry is OrganizationMember => !!entry);
    };

    const listOrganizationInvitations = async (input?: { status?: string }) => {
      const response = await callAuthApi(auth, "listInvitations", {
        query: {
          organizationId: args.organizationId,
        },
        headers,
      });

      const records = Array.isArray(response)
        ? response
        : isRecord(response) && Array.isArray(response.invitations)
          ? response.invitations
          : [];

      const invitations = records
        .map((invitation) => normalizeInvitation(invitation))
        .filter((invitation): invitation is OrganizationInvitation => !!invitation);

      if (!input?.status) {
        return invitations;
      }

      return invitations.filter((invitation) => invitation.status === input.status);
    };

    const getConnectedRecipientState = async () => {
      const [members, connections] = await Promise.all([
        listOrganizationMembers(),
        ctx.runQuery(internal.whatsappData.getActiveConnectionsByOrganization, {
          organizationId: args.organizationId,
        }) as Promise<WhatsAppConnectionDoc[]>,
      ]);

      const memberById = new Map(members.map((entry) => [entry.id, entry]));
      const connectionByMemberId = new Map<string, WhatsAppConnectionDoc>();
      const recipients: ConnectedWhatsAppRecipient[] = [];

      for (const connection of connections) {
        const member = memberById.get(connection.memberId);
        if (!member) {
          continue;
        }

        connectionByMemberId.set(connection.memberId, connection);
        recipients.push({
          memberId: connection.memberId,
          userId: member.userId,
          name: member.name,
          email: member.email,
          phoneNumberE164: connection.phoneNumberE164,
          isCurrentUser: member.userId === args.userId,
        });
      }

      recipients.sort((entryA, entryB) => {
        const nameComparison = entryA.name.localeCompare(entryB.name, undefined, {
          sensitivity: "base",
        });
        if (nameComparison !== 0) {
          return nameComparison;
        }
        return entryA.email.localeCompare(entryB.email, undefined, {
          sensitivity: "base",
        });
      });

      return {
        recipients,
        connectionByMemberId,
      };
    };

    const listConnectedWhatsAppNumbers = async (): Promise<ConnectedWhatsAppRecipient[]> => {
      const state = await getConnectedRecipientState();
      return state.recipients;
    };

    const sendProactiveWhatsAppMessage = async (input: {
      recipientMemberIds: string[];
      message: string;
    }): Promise<ProactiveWhatsAppSendResult> => {
      if (!hasExplicitProactiveSendIntent(normalizedPrompt)) {
        throw new Error(
          locale === "de"
            ? "Ich kann proaktive WhatsApp-Nachrichten nur senden, wenn du es in dieser Nachricht ausdrücklich verlangst."
            : "I can send proactive WhatsApp messages only when you explicitly ask for sending in this request.",
        );
      }

      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_WHATSAPP_FROM_NUMBER;
      if (!accountSid || !authToken || !fromNumber) {
        throw new Error(
          locale === "de"
            ? "WhatsApp-Versand ist nicht konfiguriert."
            : "WhatsApp outbound messaging is not configured.",
        );
      }

      const messageText = input.message.trim();
      if (!messageText) {
        throw new Error(
          locale === "de" ? "Nachricht darf nicht leer sein." : "Message cannot be empty.",
        );
      }

      const recipientMemberIds = [...new Set(
        input.recipientMemberIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      )];
      if (recipientMemberIds.length === 0) {
        throw new Error(
          locale === "de"
            ? "Mindestens ein Zielmitglied ist erforderlich."
            : "At least one recipient is required.",
        );
      }

      const { connectionByMemberId } = await getConnectedRecipientState();
      const results: ProactiveWhatsAppSendResult["results"] = [];

      for (const memberId of recipientMemberIds) {
        const connection = connectionByMemberId.get(memberId);
        if (!connection) {
          results.push({
            memberId,
            phoneNumberE164: "",
            status: "failed",
            reason:
              locale === "de"
                ? "Keine aktive WhatsApp-Verbindung gefunden."
                : "No active WhatsApp connection found.",
          });
          continue;
        }

        try {
          await sendOutboundMessage({
            text: messageText,
            phoneNumberE164: connection.phoneNumberE164,
            locale,
            connection,
            runMutation: ctx.runMutation,
          });

          results.push({
            memberId,
            phoneNumberE164: connection.phoneNumberE164,
            status: "sent",
          });
        } catch (error) {
          results.push({
            memberId,
            phoneNumberE164: connection.phoneNumberE164,
            status: "failed",
            reason: errorMessageFromUnknown(error),
          });
        }
      }

      const sentCount = results.filter((entry) => entry.status === "sent").length;
      const failedCount = results.length - sentCount;

      return {
        requestedRecipientCount: recipientMemberIds.length,
        sentCount,
        failedCount,
        results,
      };
    };

    const getOrganizationSummary = async (): Promise<OrganizationSummary> => {
      const [organizationResult, members, invitations] = await Promise.all([
        callAuthApi(auth, "getFullOrganization", {
          query: {
            organizationId: args.organizationId,
          },
          headers,
        }),
        listOrganizationMembers(),
        listOrganizationInvitations({ status: "pending" }),
      ]);

      const organization = normalizeOrganizationInfo(organizationResult) ?? {
        id: args.organizationId,
        name: locale === "de" ? "Aktive Organisation" : "Active organization",
        slug: args.organizationId,
        logo: null,
      };

      return {
        organization,
        currentMemberRole: member.role,
        memberCount: members.length,
        invitationCount: invitations.length,
        permissions: permissionFlags,
        members,
        pendingInvitations: invitations,
      };
    };

    const readWorkspaceSnapshot = async (): Promise<WorkspaceSnapshot> => {
      const membersResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "member",
        where: [
          {
            field: "organizationId",
            operator: "eq",
            value: args.organizationId,
          },
        ],
        paginationOpts: {
          cursor: null,
          numItems: PAGE_SIZE,
        },
      });

      const members = (membersResult.page ?? []) as MemberDoc[];
      const userIds = [...new Set(members.map((entry) => entry.userId))];

      const usersResult =
        userIds.length === 0
          ? { page: [] as UserDoc[] }
          : await ctx.runQuery(components.betterAuth.adapter.findMany, {
              model: "user",
              where: [
                {
                  field: "_id",
                  operator: "in",
                  value: userIds,
                },
              ],
              paginationOpts: {
                cursor: null,
                numItems: PAGE_SIZE,
              },
            });

      const users = (usersResult.page ?? []) as UserDoc[];
      const userById = new Map(users.map((entry) => [entry._id, entry]));

      const invitationsResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "invitation",
        where: [
          {
            field: "organizationId",
            operator: "eq",
            value: args.organizationId,
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
      });

      const invitations = (invitationsResult.page ?? []) as InvitationDoc[];

      return {
        organizationId: args.organizationId,
        memberCount: members.length,
        invitationCount: invitations.length,
        members: members.map((entry) => {
          const resolvedUser = userById.get(entry.userId);
          return {
            name: resolvedUser?.name ?? "Unknown user",
            email: resolvedUser?.email ?? "unknown@example.com",
            role: entry.role,
          };
        }),
        pendingInvitations: invitations.map((invitation) => ({
          email: invitation.email,
          role: invitation.role ?? "member",
        })),
      };
    };

    const getUserSettings = async (): Promise<UserSettingsSummary> => {
      const [userResult, localePreference, themePreference] = await Promise.all([
        ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [
            {
              field: "_id",
              operator: "eq",
              value: args.userId,
            },
          ],
        }),
        ctx.runQuery(internal.preferences.getLocaleForUser, {
          userId: args.userId,
        }),
        ctx.runQuery(internal.preferences.getThemeForUser, {
          userId: args.userId,
        }),
      ]);

      const normalizedUser = normalizeUserInfo(userResult) ?? {
        id: args.userId,
        name: userResult && isRecord(userResult) ? getRecordString(userResult, "name") ?? "User" : "User",
        email: userResult && isRecord(userResult) ? getRecordString(userResult, "email") ?? "unknown@example.com" : "unknown@example.com",
        image:
          userResult && isRecord(userResult) && typeof userResult.image === "string"
            ? userResult.image
            : null,
      };

      return {
        user: normalizedUser,
        preferences: {
          language: localePreference ?? "system",
          theme: themePreference ?? "system",
        },
      };
    };

    const updateUserSettings = async (input: {
      name?: string;
      image?: string | null;
      language?: "en" | "de" | "system";
      theme?: "light" | "dark" | "system";
    }): Promise<UserSettingsSummary> => {
      const userUpdateData: Record<string, string | null> = {};
      let hasPreferenceUpdate = false;

      if (typeof input.name === "string") {
        const normalizedName = input.name.trim();
        if (normalizedName.length < 2) {
          throw new Error(locale === "de" ? "Name zu kurz." : "Name too short.");
        }
        userUpdateData.name = normalizedName;
      }

      if (input.image !== undefined) {
        if (input.image === null) {
          userUpdateData.image = null;
        } else {
          const normalizedImage = input.image.trim();
          userUpdateData.image = normalizedImage.length > 0 ? normalizedImage : null;
        }
      }

      if (Object.keys(userUpdateData).length > 0) {
        await callAuthApi(auth, "updateUser", {
          body: userUpdateData,
          headers,
        });
      }

      if (input.language !== undefined) {
        hasPreferenceUpdate = true;
        await ctx.runMutation(internal.preferences.setLocaleForUser, {
          userId: args.userId,
          locale: input.language === "system" ? null : input.language,
        });
      }

      if (input.theme !== undefined) {
        hasPreferenceUpdate = true;
        await ctx.runMutation(internal.preferences.setThemeForUser, {
          userId: args.userId,
          theme: input.theme === "system" ? null : input.theme,
        });
      }

      if (Object.keys(userUpdateData).length === 0 && !hasPreferenceUpdate) {
        throw new Error(locale === "de" ? "Keine Aenderung angegeben." : "No update fields provided.");
      }

      return await getUserSettings();
    };

    const requestDeleteOrganizationConfirmation =
      permissionFlags.canDeleteOrganization
        ? async () => {
            const organizationResult = await callAuthApi(auth, "getFullOrganization", {
              query: {
                organizationId: args.organizationId,
              },
              headers,
            });
            const organization = normalizeOrganizationInfo(organizationResult);
            const pending = await ctx.runMutation(
              internal.aiState.upsertPendingDeleteOrganizationAction,
              {
                threadId: args.threadId,
                resourceId,
                organizationId: args.organizationId,
                userId: args.userId,
                payload: {
                  organizationId: args.organizationId,
                  organizationName: organization?.name,
                },
                expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
              },
            );

            return {
              pendingActionId: pending.pendingActionId,
              expiresAt: pending.expiresAt,
            };
          }
        : undefined;

    const agent = createWorkspaceAgent({
      organizationId: args.organizationId,
      modelId,
      locale,
      responseFormat: "whatsapp",
      contextPacket: formatContextPacketForInstructions(contextPacket),
      readWorkspaceSnapshot,
      organizationTools: {
        getOrganizationSummary,
        listOrganizationMembers,
        listOrganizationInvitations,
        listConnectedWhatsAppNumbers,
        sendProactiveWhatsAppMessage,
        updateOrganization: permissionFlags.canUpdateOrganization
          ? async (input) => {
              const data: Record<string, string> = {};

              if (typeof input.name === "string") {
                data.name = input.name.trim();
              }
              if (typeof input.slug === "string") {
                data.slug = input.slug.trim();
              }
              if (typeof input.logo === "string") {
                data.logo = input.logo.trim();
              }

              if (Object.keys(data).length === 0) {
                throw new Error(locale === "de" ? "Keine Felder angegeben." : "No fields provided.");
              }

              const updated = await callAuthApi(auth, "updateOrganization", {
                body: {
                  organizationId: args.organizationId,
                  data,
                },
                headers,
              });

              const organization = normalizeOrganizationInfo(updated);
              if (!organization) {
                throw new Error(locale === "de" ? "Update fehlgeschlagen." : "Failed to update organization.");
              }

              return organization;
            }
          : undefined,
        inviteOrganizationMember: permissionFlags.canInviteMembers
          ? async (input) => {
              const invited = await callAuthApi(auth, "createInvitation", {
                body: {
                  organizationId: args.organizationId,
                  email: input.email,
                  role: input.role,
                },
                headers,
              });

              const invitation = normalizeInvitation(invited);
              if (!invitation) {
                throw new Error(locale === "de" ? "Einladung fehlgeschlagen." : "Failed to create invitation.");
              }

              return invitation;
            }
          : undefined,
        updateOrganizationMemberRole: permissionFlags.canUpdateMembers
          ? async (input) => {
              const updated = await callAuthApi(auth, "updateMemberRole", {
                body: {
                  organizationId: args.organizationId,
                  memberId: input.memberId,
                  role: input.role,
                },
                headers,
              });

              const updatedMember = normalizeMember(updated);
              if (!updatedMember) {
                throw new Error(locale === "de" ? "Rollenupdate fehlgeschlagen." : "Failed to update member role.");
              }

              return updatedMember;
            }
          : undefined,
        removeOrganizationMember: permissionFlags.canRemoveMembers
          ? async (input) => {
              const removed = await callAuthApi(auth, "removeMember", {
                body: {
                  organizationId: args.organizationId,
                  memberIdOrEmail: input.memberIdOrEmail,
                },
                headers,
              });

              const memberPayload = isRecord(removed) && isRecord(removed.member)
                ? removed.member
                : removed;
              const removedMember = normalizeMember(memberPayload);
              if (!removedMember) {
                throw new Error(locale === "de" ? "Entfernen fehlgeschlagen." : "Failed to remove member.");
              }

              return removedMember;
            }
          : undefined,
        cancelOrganizationInvitation: permissionFlags.canCancelInvitations
          ? async (input) => {
              const canceled = await callAuthApi(auth, "cancelInvitation", {
                body: {
                  invitationId: input.invitationId,
                },
                headers,
              });

              const invitation = normalizeInvitation(canceled);
              if (!invitation) {
                throw new Error(locale === "de" ? "Widerruf fehlgeschlagen." : "Failed to cancel invitation.");
              }

              return invitation;
            }
          : undefined,
        leaveOrganization: permissionFlags.canLeaveOrganization
          ? async () => {
              await callAuthApi(auth, "leaveOrganization", {
                body: {
                  organizationId: args.organizationId,
                },
                headers,
              });

              return {
                organizationId: args.organizationId,
              };
            }
          : undefined,
        requestDeleteOrganizationConfirmation,
        deleteOrganization: permissionFlags.canDeleteOrganization
          ? async () => {
              await callAuthApi(auth, "deleteOrganization", {
                body: {
                  organizationId: args.organizationId,
                },
                headers,
              });

              return {
                organizationId: args.organizationId,
              };
            }
          : undefined,
      },
      userTools: {
        getUserSettings,
        updateUserSettings,
      },
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
    let streamActor: "main" | "organization" | "user" = "main";
    let activeToolLabel: string | null = null;

    const setStreamState = (nextState: {
      phase?: "idle" | "thinking" | "delegating" | "tool" | "responding";
      actor?: "main" | "organization" | "user";
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

          if (toolName?.startsWith("agent-organization")) {
            shouldForceFlush = setStreamState({
              phase: "delegating",
              actor: "organization",
              toolLabel: null,
            });
          } else if (toolName?.startsWith("agent-user")) {
            shouldForceFlush = setStreamState({
              phase: "delegating",
              actor: "user",
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

          if (toolName?.startsWith("agent-organization")) {
            shouldForceFlush = setStreamState({
              phase: "thinking",
              actor: "organization",
              toolLabel: null,
            });
          } else if (toolName?.startsWith("agent-user")) {
            shouldForceFlush = setStreamState({
              phase: "thinking",
              actor: "user",
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
            actor: agentId?.includes("organization")
              ? "organization"
              : agentId?.includes("user")
                ? "user"
                : "main",
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
    locale: v.union(v.literal("en"), v.literal("de")),
    text: v.string(),
    connectionId: v.optional(v.id("whatsappConnections")),
  },
  handler: async (ctx, args) => {
    const connection = args.connectionId
      ? ((await ctx.runQuery(internal.whatsappData.getConnectionById, {
          connectionId: args.connectionId,
        })) as WhatsAppConnectionDoc | null)
      : null;

    await sendOutboundMessage({
      text: args.text,
      phoneNumberE164: args.phoneNumberE164,
      locale: args.locale,
      connection,
      runMutation: ctx.runMutation,
    });
  },
});

export const detectTurnIntent = internalAction({
  args: {
    locale: v.union(v.literal("en"), v.literal("de")),
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
    locale: v.union(v.literal("en"), v.literal("de")),
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
