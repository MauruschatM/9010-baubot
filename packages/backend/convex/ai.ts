'use node';

import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import {
  compileAgentContextPacket,
  formatContextPacketForInstructions,
} from "./agentContext/compiler";
import { runClarificationGate } from "./agentContext/gates";
import type {
  AgentContextPageContext,
  AgentResponseKind,
  ClarificationQuestion,
} from "./agentContext/types";
import { authComponent, createAuth } from "./auth";
import {
  MAX_ATTACHMENTS,
  MAX_PROMPT_LENGTH,
  getMastraResourceId,
  getMastraThreadId,
  type MastraChatMessageType,
  type MastraChatRole,
  type MastraChatStreamActor,
  type MastraChatStreamPhase,
} from "./mastraComponent/constants";
import {
  extractAttachmentNames,
  serializeContentForConvex,
  toGenerationContent,
  toDisplayText,
} from "./mastraComponent/serialization";
import {
  createWorkspaceAgent,
  DEFAULT_AI_GATEWAY_MODEL,
} from "./mastra/agent";
import type {
  OrganizationInvitation,
  OrganizationMember,
  OrganizationSummary,
  UserSettingsSummary,
  WorkspaceSnapshot,
} from "./mastra/tools";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
};

type UserDoc = {
  _id: string;
  name: string;
  email: string;
  image?: string | null;
};

type InvitationDoc = {
  email: string;
  role?: string | null;
  status: string;
};

type ChatAttachment = {
  name?: string;
  contentType: string;
  storageId: Id<"_storage">;
};

type ChatPageContext = {
  routeId: string;
  routePath: string;
  title: string;
  searchQuery?: string;
  members?: {
    totalCount: number;
    filteredCount: number;
    pendingInvitationCount: number;
    currentMemberRole?: string;
    visibleMembers: Array<{
      name: string;
      email: string;
      role: string;
    }>;
    visibleInvitations: Array<{
      email: string;
      role: string;
    }>;
  };
};

type RequestPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      image: string;
      mimeType?: string;
    }
  | {
      type: "file";
      data: string;
      mimeType: string;
      filename?: string;
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
  role: MastraChatRole;
  type: MastraChatMessageType;
  content: unknown;
  text: string;
  attachmentNames: string[];
  createdAt: number;
};

type GenerationHistoryMessage = {
  id: string;
  role: MastraChatRole;
  type: MastraChatMessageType;
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

type ClarificationAnswerInput = {
  questionId: string;
  optionId?: string;
  otherText?: string;
};

type ChatActionResult = {
  text: string | null;
  model: string;
  threadId: string;
  runId: string | null;
  responseKind: AgentResponseKind;
  clarificationSessionId: string | null;
  pendingActionId: string | null;
};

const PAGE_SIZE = 200;
const STREAM_FLUSH_INTERVAL_MS = 180;
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;
const CLARIFICATION_TTL_MS = 15 * 60 * 1000;
const MAX_PAGE_CONTEXT_ITEMS = 12;
const MAX_PAGE_CONTEXT_TEXT_LENGTH = 140;

function normalizePrompt(prompt: string) {
  return prompt.trim().slice(0, MAX_PROMPT_LENGTH);
}

function createMessageId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}:${Date.now()}:${suffix}`;
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

function normalizePageContextText(value: string) {
  return value.trim().slice(0, MAX_PAGE_CONTEXT_TEXT_LENGTH);
}

function normalizeOptionalPageContextText(value?: string) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = normalizePageContextText(value);
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeNonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function normalizePageContext(
  pageContext?: ChatPageContext,
): AgentContextPageContext | null {
  if (!pageContext) {
    return null;
  }

  const routeId = normalizePageContextText(pageContext.routeId);
  const routePath = normalizePageContextText(pageContext.routePath);
  const title = normalizePageContextText(pageContext.title);
  if (!routeId || !routePath || !title) {
    return null;
  }

  const members = pageContext.members
    ? {
        totalCount: normalizeNonNegativeInteger(pageContext.members.totalCount),
        filteredCount: normalizeNonNegativeInteger(pageContext.members.filteredCount),
        pendingInvitationCount: normalizeNonNegativeInteger(
          pageContext.members.pendingInvitationCount,
        ),
        currentMemberRole: normalizeOptionalPageContextText(
          pageContext.members.currentMemberRole,
        ),
        visibleMembers: pageContext.members.visibleMembers
          .slice(0, MAX_PAGE_CONTEXT_ITEMS)
          .map((member) => ({
            name: normalizePageContextText(member.name),
            email: normalizePageContextText(member.email),
            role: normalizePageContextText(member.role),
          }))
          .filter(
            (member) => member.name.length > 0 || member.email.length > 0,
          ),
        visibleInvitations: pageContext.members.visibleInvitations
          .slice(0, MAX_PAGE_CONTEXT_ITEMS)
          .map((invitation) => ({
            email: normalizePageContextText(invitation.email),
            role: normalizePageContextText(invitation.role),
          }))
          .filter((invitation) => invitation.email.length > 0),
      }
    : null;

  return {
    routeId,
    routePath,
    title,
    searchQuery: normalizeOptionalPageContextText(pageContext.searchQuery),
    members,
  };
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

function buildUserMessage(options: {
  prompt: string;
  attachments: ResolvedChatAttachment[];
}) {
  const parts: RequestPart[] = [];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRecordString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const maybeValue = value[key];
  if (typeof maybeValue !== "string") {
    return null;
  }

  const trimmed = maybeValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPersistedMessage(input: {
  messageId: string;
  role: MastraChatRole;
  type: MastraChatMessageType;
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

function toLocale(value: string | undefined) {
  return value === "de" ? "de" : "en";
}

function toDeleteActionText(options: {
  locale: "en" | "de";
  status: "confirmed" | "canceled" | "expired" | "missing" | "error";
  errorMessage?: string;
}) {
  if (options.locale === "de") {
    if (options.status === "confirmed") {
      return "Organisation wurde gelöscht.";
    }
    if (options.status === "canceled") {
      return "Löschen der Organisation wurde abgebrochen.";
    }
    if (options.status === "expired") {
      return "Bestätigung ist abgelaufen. Bitte erneut anfordern.";
    }
    if (options.status === "missing") {
      return "Keine offene Bestätigung gefunden.";
    }
    if (options.status === "error") {
      return options.errorMessage
        ? `Löschen fehlgeschlagen: ${options.errorMessage}`
        : "Löschen der Organisation ist fehlgeschlagen.";
    }
  }

  if (options.status === "confirmed") {
    return "Organization has been deleted.";
  }
  if (options.status === "canceled") {
    return "Organization deletion was canceled.";
  }
  if (options.status === "expired") {
    return "Confirmation expired. Please request it again.";
  }
  if (options.status === "missing") {
    return "No pending confirmation was found.";
  }
  return options.errorMessage
    ? `Delete failed: ${options.errorMessage}`
    : "Organization deletion failed.";
}

function toClarificationCanceledText(locale: "en" | "de") {
  if (locale === "de") {
    return "Rückfrage abgebrochen. Du kannst jederzeit eine neue Anfrage senden.";
  }

  return "Clarification was canceled. You can send a new request anytime.";
}

function toClarificationExpiredText(locale: "en" | "de") {
  if (locale === "de") {
    return "Rückfrage ist abgelaufen. Bitte Anfrage erneut senden.";
  }

  return "Clarification expired. Please submit your request again.";
}

function toClarificationMissingText(locale: "en" | "de") {
  if (locale === "de") {
    return "Keine offene Rückfrage gefunden.";
  }

  return "No pending clarification was found.";
}

function toClarificationAnsweredText(locale: "en" | "de") {
  if (locale === "de") {
    return "Danke, ich fahre mit diesen Angaben fort.";
  }

  return "Thanks, I will continue with these details.";
}

function toClarificationErrorText(locale: "en" | "de", errorMessage?: string) {
  if (locale === "de") {
    return errorMessage
      ? `Rückfrage konnte nicht verarbeitet werden: ${errorMessage}`
      : "Rückfrage konnte nicht verarbeitet werden.";
  }

  return errorMessage
    ? `Clarification could not be processed: ${errorMessage}`
    : "Clarification could not be processed.";
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

function detectResponseKindFromToolResults(
  toolResults: ToolResultRecord[],
): AgentResponseKind {
  const hasApprovalRequired = toolResults.some((toolResult) =>
    hasApprovalRequiredStatus(toolResult.result),
  );

  if (hasApprovalRequired) {
    return "approval_required";
  }

  const hasClarificationRequested = toolResults.some((toolResult) =>
    hasClarificationRequestedStatus(toolResult.result),
  );

  if (hasClarificationRequested) {
    return "clarification";
  }

  return "answer";
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

function normalizeClarificationAnswers(options: {
  answers: ClarificationAnswerInput[];
  questions: ClarificationQuestion[];
}) {
  const answersByQuestionId = new Map(
    options.answers.map((answer) => [answer.questionId, answer]),
  );

  const normalizedAnswers: Record<string, string> = {};

  for (const question of options.questions) {
    const answer = answersByQuestionId.get(question.id);
    const selectedOption = question.options.find(
      (option) => option.id === answer?.optionId,
    );
    const normalizedOtherText = answer?.otherText?.trim() ?? "";

    if (!selectedOption && !normalizedOtherText) {
      if (question.required) {
        throw new Error("Please answer all clarification questions");
      }
      continue;
    }

    if (!selectedOption && normalizedOtherText && !question.allowOther) {
      throw new Error("An unsupported clarification answer was provided");
    }

    if (selectedOption && normalizedOtherText) {
      normalizedAnswers[question.id] = `${selectedOption.label}: ${normalizedOtherText}`;
      continue;
    }

    if (selectedOption) {
      normalizedAnswers[question.id] = selectedOption.label;
      continue;
    }

    normalizedAnswers[question.id] = normalizedOtherText;
  }

  return normalizedAnswers;
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

  const id = getRecordString(value, "id");
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

  const id = getRecordString(value, "_id") ?? getRecordString(value, "id");
  const name = getRecordString(value, "name");
  const email = getRecordString(value, "email");
  const imageRaw = value.image;
  const image = typeof imageRaw === "string" ? imageRaw : null;

  if (!id || !name || !email) {
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

export const chat: any = action({
  args: {
    organizationId: v.string(),
    prompt: v.string(),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
    attachments: v.optional(
      v.array(
        v.object({
          name: v.optional(v.string()),
          contentType: v.string(),
          storageId: v.id("_storage"),
        }),
      ),
    ),
    pageContext: v.optional(
      v.object({
        routeId: v.string(),
        routePath: v.string(),
        title: v.string(),
        searchQuery: v.optional(v.string()),
        members: v.optional(
          v.object({
            totalCount: v.number(),
            filteredCount: v.number(),
            pendingInvitationCount: v.number(),
            currentMemberRole: v.optional(v.string()),
            visibleMembers: v.array(
              v.object({
                name: v.string(),
                email: v.string(),
                role: v.string(),
              }),
            ),
            visibleInvitations: v.array(
              v.object({
                email: v.string(),
                role: v.string(),
              }),
            ),
          }),
        ),
      }),
    ),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    text: v.union(v.string(), v.null()),
    model: v.string(),
    threadId: v.string(),
    runId: v.union(v.string(), v.null()),
    responseKind: v.union(
      v.literal("answer"),
      v.literal("clarification"),
      v.literal("approval_required"),
    ),
    clarificationSessionId: v.union(v.string(), v.null()),
    pendingActionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<ChatActionResult> => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error("AI gateway is not configured");
    }

    const locale = toLocale(args.locale);
    const modelId = process.env.AI_GATEWAY_MODEL ?? DEFAULT_AI_GATEWAY_MODEL;

    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    if ((args.attachments?.length ?? 0) > MAX_ATTACHMENTS) {
      throw new Error(`You can attach up to ${MAX_ATTACHMENTS} files`);
    }

    const prompt = normalizePrompt(args.prompt);
    const attachments = normalizeAttachments(
      (args.attachments ?? []) as ChatAttachment[],
    );
    const resolvedAttachments = await resolveAttachmentsFromStorage(ctx, attachments);
    if (resolvedAttachments.length !== attachments.length) {
      throw new Error("One or more attachments are no longer available");
    }
    const pageContext = normalizePageContext(
      args.pageContext as ChatPageContext | undefined,
    );

    const attachmentContextEntries = resolvedAttachments.map((attachment) => ({
      name: attachment.name ?? "Attachment",
      contentType: attachment.contentType,
      storageId: attachment.storageId,
      fileUrl: attachment.fileUrl,
    }));

    const defaultThreadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const threadId = args.threadId ?? defaultThreadId;
    const existingThread = await ctx.runQuery(internal.aiState.getChatThreadById, {
      threadId,
    });
    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== authUser._id)
    ) {
      throw new Error("Invalid chat thread id");
    }

    const resourceId =
      existingThread?.resourceId ??
      getMastraResourceId({
        organizationId: args.organizationId,
        userId: authUser._id,
      });

    const pendingClarificationSession = await ctx.runQuery(
      internal.aiState.getLatestPendingClarificationByThread,
      {
        threadId,
      },
    );

    if (
      pendingClarificationSession &&
      pendingClarificationSession.status === "pending" &&
      pendingClarificationSession.expiresAt > Date.now()
    ) {
      return {
        text: pendingClarificationSession.assistantMessage,
        model: modelId,
        threadId,
        runId: null,
        responseKind: "clarification" as const,
        clarificationSessionId: pendingClarificationSession.id,
        pendingActionId: null,
      };
    }

    if (
      pendingClarificationSession &&
      pendingClarificationSession.status === "pending" &&
      pendingClarificationSession.expiresAt <= Date.now()
    ) {
      await ctx.runMutation(internal.aiState.resolveClarificationSession, {
        clarificationSessionId: pendingClarificationSession.id,
        status: "expired",
      });
    }

    const userMessage = buildUserMessage({
      prompt,
      attachments: resolvedAttachments,
    });
    const persistedUserContent = buildPersistedUserMessageContent({
      prompt,
      attachments: resolvedAttachments,
    });

    const userPersistedMessage = buildPersistedMessage({
      messageId: createMessageId(`${threadId}:user`),
      role: "user",
      type: "text",
      content: persistedUserContent,
      text:
        typeof userMessage.content === "string"
          ? userMessage.content
          :
              prompt ||
              attachmentContextEntries.map((attachment) => attachment.name).join(", "),
      attachmentNames: attachmentContextEntries.map((attachment) => attachment.name),
    });

    await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
      threadId,
      resourceId,
      organizationId: args.organizationId,
      userId: authUser._id,
      messages: [userPersistedMessage],
    });

    const historyMessages = (await ctx.runQuery(
      internal.aiState.getMessagesForGeneration,
      {
        threadId,
      },
    )) as GenerationHistoryMessage[];

    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    const permissionFlags = await getToolPermissionFlags({
      auth,
      headers,
      organizationId: args.organizationId,
    });

    const contextPacket = compileAgentContextPacket({
      locale,
      organizationId: args.organizationId,
      threadId,
      userId: authUser._id,
      currentMemberRole: membership.role,
      prompt,
      attachmentNames: attachmentContextEntries.map((attachment) => attachment.name),
      attachments: attachmentContextEntries,
      pageContext,
      permissions: permissionFlags,
      historyMessages,
    });

    const clarificationDecision = runClarificationGate(contextPacket);
    if (clarificationDecision.kind === "clarification") {
      const session = await ctx.runMutation(
        internal.aiState.upsertPendingClarificationSession,
        {
          threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: authUser._id,
          intent: clarificationDecision.intent,
          contextVersion: contextPacket.version,
          prompt,
          title: clarificationDecision.template.title,
          description: clarificationDecision.template.description,
          assistantMessage: clarificationDecision.template.assistantMessage,
          questions: clarificationDecision.template.questions,
          expiresAt: Date.now() + CLARIFICATION_TTL_MS,
        },
      );

      const assistantMessage = buildPersistedMessage({
        messageId: createMessageId(`${threadId}:assistant`),
        role: "assistant",
        type: "text",
        content: clarificationDecision.template.assistantMessage,
        text: clarificationDecision.template.assistantMessage,
      });

      await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
        threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: authUser._id,
        messages: [assistantMessage],
      });

      await ctx.runMutation(internal.aiState.setChatThreadState, {
        threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: authUser._id,
        status: "idle",
        lastError: null,
        lastRunId: null,
        streamingText: null,
        streamPhase: "idle",
        streamActor: "main",
        activeToolLabel: null,
      });

      return {
        text: clarificationDecision.template.assistantMessage,
        model: modelId,
        threadId,
        runId: null,
        responseKind: "clarification" as const,
        clarificationSessionId: session.clarificationSessionId,
        pendingActionId: null,
      };
    }

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
        .map((member) => normalizeMember(member))
        .filter((member): member is OrganizationMember => !!member);
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
        name:
          locale === "de" ? "Aktive Organisation" : "Active organization",
        slug: args.organizationId,
        logo: null,
      };

      return {
        organization,
        currentMemberRole: membership.role,
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
      const userIds = [...new Set(members.map((member) => member.userId))];

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
      const userById = new Map(users.map((user) => [user._id, user]));

      const invitationsResult = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
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
        },
      );

      const invitations = (invitationsResult.page ?? []) as InvitationDoc[];

      return {
        organizationId: args.organizationId,
        memberCount: members.length,
        invitationCount: invitations.length,
        members: members.map((member) => {
          const user = userById.get(member.userId);

          return {
            name: user?.name ?? "Unknown user",
            email: user?.email ?? "unknown@example.com",
            role: member.role,
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
              value: authUser._id,
            },
          ],
        }),
        ctx.runQuery(internal.preferences.getLocaleForUser, {
          userId: authUser._id,
        }),
        ctx.runQuery(internal.preferences.getThemeForUser, {
          userId: authUser._id,
        }),
      ]);

      const normalizedUser = normalizeUserInfo(userResult) ?? {
        id: authUser._id,
        name: authUser.name?.trim() || (locale === "de" ? "Benutzer" : "User"),
        email: authUser.email,
        image: typeof authUser.image === "string" ? authUser.image : null,
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
          throw new Error(
            locale === "de"
              ? "Der Name muss mindestens 2 Zeichen lang sein."
              : "Name must be at least 2 characters.",
          );
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
          userId: authUser._id,
          locale: input.language === "system" ? null : input.language,
        });
      }

      if (input.theme !== undefined) {
        hasPreferenceUpdate = true;
        await ctx.runMutation(internal.preferences.setThemeForUser, {
          userId: authUser._id,
          theme: input.theme === "system" ? null : input.theme,
        });
      }

      if (Object.keys(userUpdateData).length === 0 && !hasPreferenceUpdate) {
        throw new Error(
          locale === "de"
            ? "Mindestens ein Feld zum Aktualisieren angeben."
            : "Provide at least one field to update.",
        );
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
                threadId,
                resourceId,
                organizationId: args.organizationId,
                userId: authUser._id,
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
      contextPacket: formatContextPacketForInstructions(contextPacket),
      readWorkspaceSnapshot,
      organizationTools: {
        getOrganizationSummary,
        listOrganizationMembers,
        listOrganizationInvitations,
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
                throw new Error(
                  locale === "de"
                    ? "Mindestens ein Feld zum Aktualisieren angeben."
                    : "Provide at least one field to update.",
                );
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
                throw new Error(
                  locale === "de"
                    ? "Organisation konnte nicht aktualisiert werden."
                    : "Failed to update organization.",
                );
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
                throw new Error(
                  locale === "de"
                    ? "Einladung konnte nicht erstellt werden."
                    : "Failed to create invitation.",
                );
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

              const member = normalizeMember(updated);
              if (!member) {
                throw new Error(
                  locale === "de"
                    ? "Rolle konnte nicht aktualisiert werden."
                    : "Failed to update member role.",
                );
              }

              return member;
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
              const member = normalizeMember(memberPayload);
              if (!member) {
                throw new Error(
                  locale === "de"
                    ? "Mitglied konnte nicht entfernt werden."
                    : "Failed to remove member.",
                );
              }

              return member;
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
                throw new Error(
                  locale === "de"
                    ? "Einladung konnte nicht widerrufen werden."
                    : "Failed to cancel invitation.",
                );
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
      threadId,
      resourceId,
      organizationId: args.organizationId,
      userId: authUser._id,
      status: "running",
      lastError: null,
      lastRunId: null,
      streamingText: "",
      streamPhase: "thinking",
      streamActor: "main",
      activeToolLabel: null,
    });

    let streamedText = "";
    let streamPhase: MastraChatStreamPhase = "thinking";
    let streamActor: MastraChatStreamActor = "main";
    let activeToolLabel: string | null = null;

    const setStreamState = (nextState: {
      phase?: MastraChatStreamPhase;
      actor?: MastraChatStreamActor;
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
          threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: authUser._id,
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
      let responseKind: AgentResponseKind = responseKindFromTools;
      let finalTextForPersist = finalText;

      if (clarificationToolRequest) {
        const clarificationTemplate = buildClarificationTemplateFromTool({
          locale,
          questions: clarificationToolRequest.questions,
          reason: clarificationToolRequest.reason,
        });

        const clarificationSession = await ctx.runMutation(
          internal.aiState.upsertPendingClarificationSession,
          {
            threadId,
            resourceId,
            organizationId: args.organizationId,
            userId: authUser._id,
            intent: "generic",
            contextVersion: contextPacket.version,
            prompt,
            title: clarificationTemplate.title,
            description: clarificationTemplate.description,
            assistantMessage: clarificationTemplate.assistantMessage,
            questions: clarificationTemplate.questions,
            expiresAt: Date.now() + CLARIFICATION_TTL_MS,
          },
        );

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
            messageId: createMessageId(`${threadId}:tool-call`),
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
            messageId: createMessageId(`${threadId}:tool-result`),
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
            messageId: createMessageId(`${threadId}:assistant`),
            role: "assistant",
            type: "text",
            content: finalTextForPersist,
            text: finalTextForPersist,
          }),
        );
      }

      if (newMessages.length > 0) {
        await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
          threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: authUser._id,
          messages: newMessages,
        });
      }

      const runId =
        isRecord(fullOutput.response) &&
        typeof fullOutput.response.id === "string"
          ? fullOutput.response.id
          : null;

      await ctx.runMutation(internal.aiState.setChatThreadState, {
        threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: authUser._id,
        status: "idle",
        lastError: null,
        lastRunId: runId,
        streamingText: null,
        streamPhase: "idle",
        streamActor: "main",
        activeToolLabel: null,
      });

      return {
        text: finalTextForPersist || null,
        model: modelId,
        threadId,
        runId,
        responseKind,
        clarificationSessionId,
        pendingActionId,
      };
    } catch (error) {
      await ctx.runMutation(internal.aiState.setChatThreadState, {
        threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: authUser._id,
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

export const submitClarificationAnswers: any = action({
  args: {
    organizationId: v.string(),
    clarificationSessionId: v.id("aiClarificationSessions"),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
    answers: v.array(
      v.object({
        questionId: v.string(),
        optionId: v.optional(v.string()),
        otherText: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    status: v.union(
      v.literal("answered"),
      v.literal("expired"),
      v.literal("missing"),
      v.literal("error"),
    ),
    text: v.string(),
    resumePrompt: v.union(v.string(), v.null()),
    threadId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const locale = toLocale(args.locale);
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const session = await ctx.runQuery(internal.aiState.getClarificationSessionById, {
      clarificationSessionId: args.clarificationSessionId,
    });

    if (
      !session ||
      session.organizationId !== args.organizationId ||
      session.userId !== authUser._id ||
      session.status !== "pending"
    ) {
      return {
        status: "missing" as const,
        text: toClarificationMissingText(locale),
        resumePrompt: null,
        threadId: null,
      };
    }

    if (session.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolveClarificationSession, {
        clarificationSessionId: args.clarificationSessionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: toClarificationExpiredText(locale),
        resumePrompt: null,
        threadId: session.threadId,
      };
    }

    try {
      const normalizedAnswers = normalizeClarificationAnswers({
        answers: args.answers as ClarificationAnswerInput[],
        questions: session.questions as ClarificationQuestion[],
      });

      const resumePrompt = buildResumePromptFromClarification({
        originalPrompt: session.prompt,
        normalizedAnswers,
        locale,
      });

      await ctx.runMutation(internal.aiState.resolveClarificationSession, {
        clarificationSessionId: args.clarificationSessionId,
        status: "answered",
        answers: normalizedAnswers,
        resumePrompt,
      });

      return {
        status: "answered" as const,
        text: toClarificationAnsweredText(locale),
        resumePrompt,
        threadId: session.threadId,
      };
    } catch (error) {
      return {
        status: "error" as const,
        text: toClarificationErrorText(locale, errorMessageFromUnknown(error)),
        resumePrompt: null,
        threadId: session.threadId,
      };
    }
  },
});

export const cancelClarificationSession = action({
  args: {
    organizationId: v.string(),
    clarificationSessionId: v.id("aiClarificationSessions"),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
  },
  returns: v.object({
    status: v.union(
      v.literal("canceled"),
      v.literal("expired"),
      v.literal("missing"),
      v.literal("error"),
    ),
    text: v.string(),
  }),
  handler: async (ctx, args) => {
    const locale = toLocale(args.locale);
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const session = await ctx.runQuery(internal.aiState.getClarificationSessionById, {
      clarificationSessionId: args.clarificationSessionId,
    });

    if (
      !session ||
      session.organizationId !== args.organizationId ||
      session.userId !== authUser._id ||
      session.status !== "pending"
    ) {
      return {
        status: "missing" as const,
        text: toClarificationMissingText(locale),
      };
    }

    if (session.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolveClarificationSession, {
        clarificationSessionId: args.clarificationSessionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: toClarificationExpiredText(locale),
      };
    }

    try {
      await ctx.runMutation(internal.aiState.resolveClarificationSession, {
        clarificationSessionId: args.clarificationSessionId,
        status: "canceled",
      });

      const text = toClarificationCanceledText(locale);
      await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
        threadId: session.threadId,
        resourceId: session.resourceId,
        organizationId: args.organizationId,
        userId: authUser._id,
        messages: [
          buildPersistedMessage({
            messageId: createMessageId(`${session.threadId}:assistant`),
            role: "assistant",
            type: "text",
            content: text,
            text,
          }),
        ],
      });

      return {
        status: "canceled" as const,
        text,
      };
    } catch (error) {
      return {
        status: "error" as const,
        text: toClarificationErrorText(locale, errorMessageFromUnknown(error)),
      };
    }
  },
});

export const resumeFromClarification: any = action({
  args: {
    organizationId: v.string(),
    clarificationSessionId: v.id("aiClarificationSessions"),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
  },
  returns: v.object({
    status: v.union(
      v.literal("resumed"),
      v.literal("expired"),
      v.literal("missing"),
      v.literal("error"),
    ),
    text: v.string(),
    resumePrompt: v.union(v.string(), v.null()),
    threadId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const locale = toLocale(args.locale);
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const session = await ctx.runQuery(internal.aiState.getClarificationSessionById, {
      clarificationSessionId: args.clarificationSessionId,
    });

    if (
      !session ||
      session.organizationId !== args.organizationId ||
      session.userId !== authUser._id
    ) {
      return {
        status: "missing" as const,
        text: toClarificationMissingText(locale),
        resumePrompt: null,
        threadId: null,
      };
    }

    if (session.status === "pending" && session.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolveClarificationSession, {
        clarificationSessionId: args.clarificationSessionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: toClarificationExpiredText(locale),
        resumePrompt: null,
        threadId: session.threadId,
      };
    }

    if (session.status !== "answered") {
      return {
        status: "missing" as const,
        text: toClarificationMissingText(locale),
        resumePrompt: null,
        threadId: session.threadId,
      };
    }

    try {
      return {
        status: "resumed" as const,
        text: toClarificationAnsweredText(locale),
        resumePrompt: session.resumePrompt ?? session.prompt,
        threadId: session.threadId,
      };
    } catch (error) {
      return {
        status: "error" as const,
        text: toClarificationErrorText(locale, errorMessageFromUnknown(error)),
        resumePrompt: null,
        threadId: session.threadId,
      };
    }
  },
});

export const confirmPendingAction = action({
  args: {
    organizationId: v.string(),
    pendingActionId: v.id("aiPendingActions"),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
  },
  returns: v.object({
    status: v.union(
      v.literal("confirmed"),
      v.literal("expired"),
      v.literal("missing"),
      v.literal("error"),
    ),
    text: v.string(),
  }),
  handler: async (ctx, args) => {
    const locale = toLocale(args.locale);
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const pendingAction = await ctx.runQuery(internal.aiState.getPendingActionById, {
      pendingActionId: args.pendingActionId,
    });

    if (
      !pendingAction ||
      pendingAction.organizationId !== args.organizationId ||
      pendingAction.userId !== authUser._id ||
      pendingAction.status !== "pending"
    ) {
      return {
        status: "missing" as const,
        text: toDeleteActionText({
          locale,
          status: "missing",
        }),
      };
    }

    if (pendingAction.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: toDeleteActionText({
          locale,
          status: "expired",
        }),
      };
    }

    try {
      const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
      await callAuthApi(auth, "deleteOrganization", {
        body: {
          organizationId: args.organizationId,
        },
        headers,
      });

      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "confirmed",
      });

      return {
        status: "confirmed" as const,
        text: toDeleteActionText({
          locale,
          status: "confirmed",
        }),
      };
    } catch (error) {
      return {
        status: "error" as const,
        text: toDeleteActionText({
          locale,
          status: "error",
          errorMessage: errorMessageFromUnknown(error),
        }),
      };
    }
  },
});

export const cancelPendingAction = action({
  args: {
    organizationId: v.string(),
    pendingActionId: v.id("aiPendingActions"),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
  },
  returns: v.object({
    status: v.union(
      v.literal("canceled"),
      v.literal("expired"),
      v.literal("missing"),
      v.literal("error"),
    ),
    text: v.string(),
  }),
  handler: async (ctx, args) => {
    const locale = toLocale(args.locale);
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "organizationId",
          operator: "eq",
          value: args.organizationId,
        },
        {
          field: "userId",
          operator: "eq",
          value: authUser._id,
        },
      ],
    })) as MemberDoc | null;

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const pendingAction = await ctx.runQuery(internal.aiState.getPendingActionById, {
      pendingActionId: args.pendingActionId,
    });

    if (
      !pendingAction ||
      pendingAction.organizationId !== args.organizationId ||
      pendingAction.userId !== authUser._id ||
      pendingAction.status !== "pending"
    ) {
      return {
        status: "missing" as const,
        text: toDeleteActionText({
          locale,
          status: "missing",
        }),
      };
    }

    if (pendingAction.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: toDeleteActionText({
          locale,
          status: "expired",
        }),
      };
    }

    try {
      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "canceled",
      });

      const threadId = pendingAction.threadId;
      const resourceId = pendingAction.resourceId;

      const text = toDeleteActionText({
        locale,
        status: "canceled",
      });

      await ctx.runMutation(internal.aiState.upsertGeneratedMessages, {
        threadId,
        resourceId,
        organizationId: args.organizationId,
        userId: authUser._id,
        messages: [
          buildPersistedMessage({
            messageId: createMessageId(`${threadId}:assistant`),
            role: "assistant",
            type: "text",
            content: text,
            text,
          }),
        ],
      });

      return {
        status: "canceled" as const,
        text,
      };
    } catch (error) {
      return {
        status: "error" as const,
        text: toDeleteActionText({
          locale,
          status: "error",
          errorMessage: errorMessageFromUnknown(error),
        }),
      };
    }
  },
});
