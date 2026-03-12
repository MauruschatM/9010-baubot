'use node';

import { createTranslator, type AppLocale } from "@mvp-template/i18n";
import { v } from "convex/values";

import { vAppLocale } from "./lib/locales";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import {
  buildWorkspaceAgentTools,
  executePendingAction,
} from "./agentRuntime";
import {
  compileAgentContextPacket,
  formatContextPacketForInstructions,
} from "../mastra/agentContext/compiler";
import { runClarificationGate } from "../mastra/agentContext/gates";
import type {
  AgentContextPageContext,
  AgentResponseKind,
  ClarificationQuestion,
} from "../mastra/agentContext/types";
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
} from "../mastra/agent";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
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
  searchQuery?: string | null;
  members?: {
    totalCount: number;
    filteredCount: number;
    pendingInvitationCount: number;
    currentMemberRole?: string | null;
    visibleMembers: Array<{
      name: string;
      email?: string | null;
      phoneNumberE164?: string | null;
      memberType?: "standard" | "phone_only";
      role: string;
    }>;
    visibleInvitations: Array<{
      email: string;
      role: string;
    }>;
  } | null;
  customers?: {
    totalCount: number;
    currentCustomer?: {
      id: string;
      name: string;
      email?: string | null;
      phone?: string | null;
    } | null;
    visibleCustomers: Array<{
      id: string;
      name: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      activeProjectCount: number;
      doneProjectCount: number;
    }>;
  } | null;
  projects?: {
    totalCount: number;
    activeCount: number;
    doneCount: number;
    currentProject?: {
      id: string;
      location: string;
      status: string;
    } | null;
    visibleProjects: Array<{
      id: string;
      location: string;
      status: string;
      hasUnreviewedChanges: boolean;
      hasNachtrag: boolean;
    }>;
  } | null;
  archive?: {
    archivedCustomerCount: number;
    archivedProjectCount: number;
    visibleArchivedCustomers: Array<{
      id: string;
      name: string;
      deletedAt: number;
    }>;
    visibleArchivedProjects: Array<{
      id: string;
      location: string;
      status: string;
      deletedAt: number;
    }>;
  } | null;
  shell?: {
    organizationName?: string | null;
    companyEmail?: string | null;
    companyEmailLocale?: string | null;
    agentProfileName?: string | null;
    agentStyleId?: string | null;
    whatsappPhoneNumberE164?: string | null;
    myWhatsAppPhoneNumberE164?: string | null;
    myWhatsAppConnected?: boolean | null;
  } | null;
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

function normalizeOptionalPageContextText(value?: string | null) {
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

function normalizePageContextMemberType(
  value?: string | null,
): "standard" | "phone_only" {
  return value === "phone_only" ? "phone_only" : "standard";
}

function normalizeBooleanOrNull(value?: boolean | null) {
  return typeof value === "boolean" ? value : null;
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
            email: normalizeOptionalPageContextText(member.email ?? undefined),
            phoneNumberE164: normalizeOptionalPageContextText(
              member.phoneNumberE164 ?? undefined,
            ),
            memberType: normalizePageContextMemberType(member.memberType),
            role: normalizePageContextText(member.role),
          }))
          .filter(
            (member) =>
              member.name.length > 0 ||
              member.email !== null ||
              member.phoneNumberE164 !== null,
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
  const customers = pageContext.customers
    ? {
        totalCount: normalizeNonNegativeInteger(pageContext.customers.totalCount),
        currentCustomer: pageContext.customers.currentCustomer
          ? {
              id: normalizePageContextText(pageContext.customers.currentCustomer.id),
              name: normalizePageContextText(pageContext.customers.currentCustomer.name),
              email: normalizeOptionalPageContextText(
                pageContext.customers.currentCustomer.email ?? undefined,
              ),
              phone: normalizeOptionalPageContextText(
                pageContext.customers.currentCustomer.phone ?? undefined,
              ),
            }
          : null,
        visibleCustomers: pageContext.customers.visibleCustomers
          .slice(0, MAX_PAGE_CONTEXT_ITEMS)
          .map((customer) => ({
            id: normalizePageContextText(customer.id),
            name: normalizePageContextText(customer.name),
            contactName: normalizeOptionalPageContextText(customer.contactName ?? undefined),
            email: normalizeOptionalPageContextText(customer.email ?? undefined),
            phone: normalizeOptionalPageContextText(customer.phone ?? undefined),
            activeProjectCount: normalizeNonNegativeInteger(customer.activeProjectCount),
            doneProjectCount: normalizeNonNegativeInteger(customer.doneProjectCount),
          }))
          .filter((customer) => customer.id.length > 0 || customer.name.length > 0),
      }
    : null;
  const projects = pageContext.projects
    ? {
        totalCount: normalizeNonNegativeInteger(pageContext.projects.totalCount),
        activeCount: normalizeNonNegativeInteger(pageContext.projects.activeCount),
        doneCount: normalizeNonNegativeInteger(pageContext.projects.doneCount),
        currentProject: pageContext.projects.currentProject
          ? {
              id: normalizePageContextText(pageContext.projects.currentProject.id),
              location: normalizePageContextText(pageContext.projects.currentProject.location),
              status: normalizePageContextText(pageContext.projects.currentProject.status),
            }
          : null,
        visibleProjects: pageContext.projects.visibleProjects
          .slice(0, MAX_PAGE_CONTEXT_ITEMS)
          .map((project) => ({
            id: normalizePageContextText(project.id),
            location: normalizePageContextText(project.location),
            status: normalizePageContextText(project.status),
            hasUnreviewedChanges: Boolean(project.hasUnreviewedChanges),
            hasNachtrag: Boolean(project.hasNachtrag),
          }))
          .filter((project) => project.id.length > 0 || project.location.length > 0),
      }
    : null;
  const archive = pageContext.archive
    ? {
        archivedCustomerCount: normalizeNonNegativeInteger(
          pageContext.archive.archivedCustomerCount,
        ),
        archivedProjectCount: normalizeNonNegativeInteger(
          pageContext.archive.archivedProjectCount,
        ),
        visibleArchivedCustomers: pageContext.archive.visibleArchivedCustomers
          .slice(0, MAX_PAGE_CONTEXT_ITEMS)
          .map((customer) => ({
            id: normalizePageContextText(customer.id),
            name: normalizePageContextText(customer.name),
            deletedAt: normalizeNonNegativeInteger(customer.deletedAt),
          }))
          .filter((customer) => customer.id.length > 0 || customer.name.length > 0),
        visibleArchivedProjects: pageContext.archive.visibleArchivedProjects
          .slice(0, MAX_PAGE_CONTEXT_ITEMS)
          .map((project) => ({
            id: normalizePageContextText(project.id),
            location: normalizePageContextText(project.location),
            status: normalizePageContextText(project.status),
            deletedAt: normalizeNonNegativeInteger(project.deletedAt),
          }))
          .filter((project) => project.id.length > 0 || project.location.length > 0),
      }
    : null;
  const shell = pageContext.shell
    ? {
        organizationName: normalizeOptionalPageContextText(
          pageContext.shell.organizationName ?? undefined,
        ),
        companyEmail: normalizeOptionalPageContextText(
          pageContext.shell.companyEmail ?? undefined,
        ),
        companyEmailLocale: normalizeOptionalPageContextText(
          pageContext.shell.companyEmailLocale ?? undefined,
        ),
        agentProfileName: normalizeOptionalPageContextText(
          pageContext.shell.agentProfileName ?? undefined,
        ),
        agentStyleId: normalizeOptionalPageContextText(
          pageContext.shell.agentStyleId ?? undefined,
        ),
        whatsappPhoneNumberE164: normalizeOptionalPageContextText(
          pageContext.shell.whatsappPhoneNumberE164 ?? undefined,
        ),
        myWhatsAppPhoneNumberE164: normalizeOptionalPageContextText(
          pageContext.shell.myWhatsAppPhoneNumberE164 ?? undefined,
        ),
        myWhatsAppConnected: normalizeBooleanOrNull(pageContext.shell.myWhatsAppConnected),
      }
    : null;

  return {
    routeId,
    routePath,
    title,
    searchQuery: normalizeOptionalPageContextText(pageContext.searchQuery),
    members,
    customers,
    projects,
    archive,
    shell,
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

function toPendingActionErrorText(options: {
  locale: AppLocale;
  errorMessage?: string;
}) {
  if (options.locale === "de") {
    return options.errorMessage
      ? `Aktion fehlgeschlagen: ${options.errorMessage}`
      : "Aktion konnte nicht ausgeführt werden.";
  }

  return options.errorMessage
    ? `Action failed: ${options.errorMessage}`
    : "The action could not be completed.";
}

function toPendingActionExpiredText(locale: AppLocale) {
  return locale === "de"
    ? "Bestätigung ist abgelaufen. Bitte erneut anfordern."
    : "Confirmation expired. Please request it again.";
}

function toPendingActionMissingText(locale: AppLocale) {
  return locale === "de"
    ? "Keine offene Bestätigung gefunden."
    : "No pending confirmation was found.";
}

function toClarificationCanceledText(locale: AppLocale) {
  if (locale === "de") {
    return "Rückfrage abgebrochen. Du kannst jederzeit eine neue Anfrage senden.";
  }

  return "Clarification was canceled. You can send a new request anytime.";
}

function toClarificationExpiredText(locale: AppLocale) {
  if (locale === "de") {
    return "Rückfrage ist abgelaufen. Bitte Anfrage erneut senden.";
  }

  return "Clarification expired. Please submit your request again.";
}

function toClarificationMissingText(locale: AppLocale) {
  if (locale === "de") {
    return "Keine offene Rückfrage gefunden.";
  }

  return "No pending clarification was found.";
}

function toClarificationAnsweredText(locale: AppLocale) {
  if (locale === "de") {
    return "Danke, ich fahre mit diesen Angaben fort.";
  }

  return "Thanks, I will continue with these details.";
}

function toClarificationErrorText(locale: AppLocale, errorMessage?: string) {
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
    typeof getRecordString(result, "pendingActionId") === "string"
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

function normalizeClarificationAnswers(options: {
  answers: ClarificationAnswerInput[];
  locale: AppLocale;
  questions: ClarificationQuestion[];
}) {
  const t = createTranslator(options.locale);
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
        throw new Error(t("app.chat.clarification.completeRequired"));
      }
      continue;
    }

    if (!selectedOption && normalizedOtherText && !question.allowOther) {
      throw new Error(t("app.chat.clarification.unsupportedAnswer"));
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

function resolveStreamActor(value?: string | null): MastraChatStreamActor {
  if (!value) {
    return "main";
  }

  if (value.includes("organization")) {
    return "organization";
  }
  if (value.includes("customer")) {
    return "customer";
  }
  if (value.includes("project")) {
    return "project";
  }
  if (value.includes("user")) {
    return "user";
  }

  return "main";
}

export const chat: any = action({
  args: {
    organizationId: v.string(),
    prompt: v.string(),
    locale: v.optional(vAppLocale),
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
        searchQuery: v.optional(v.union(v.string(), v.null())),
        members: v.optional(
          v.union(
            v.object({
              totalCount: v.number(),
              filteredCount: v.number(),
              pendingInvitationCount: v.number(),
              currentMemberRole: v.optional(v.union(v.string(), v.null())),
              visibleMembers: v.array(
                v.object({
                  name: v.string(),
                  email: v.optional(v.union(v.string(), v.null())),
                  phoneNumberE164: v.optional(v.union(v.string(), v.null())),
                  memberType: v.optional(
                    v.union(v.literal("standard"), v.literal("phone_only")),
                  ),
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
            v.null(),
          ),
        ),
        customers: v.optional(
          v.union(
            v.object({
              totalCount: v.number(),
              currentCustomer: v.optional(
                v.union(
                  v.object({
                    id: v.string(),
                    name: v.string(),
                    email: v.optional(v.union(v.string(), v.null())),
                    phone: v.optional(v.union(v.string(), v.null())),
                  }),
                  v.null(),
                ),
              ),
              visibleCustomers: v.array(
                v.object({
                  id: v.string(),
                  name: v.string(),
                  contactName: v.optional(v.union(v.string(), v.null())),
                  email: v.optional(v.union(v.string(), v.null())),
                  phone: v.optional(v.union(v.string(), v.null())),
                  activeProjectCount: v.number(),
                  doneProjectCount: v.number(),
                }),
              ),
            }),
            v.null(),
          ),
        ),
        projects: v.optional(
          v.union(
            v.object({
              totalCount: v.number(),
              activeCount: v.number(),
              doneCount: v.number(),
              currentProject: v.optional(
                v.union(
                  v.object({
                    id: v.string(),
                    location: v.string(),
                    status: v.string(),
                  }),
                  v.null(),
                ),
              ),
              visibleProjects: v.array(
                v.object({
                  id: v.string(),
                  location: v.string(),
                  status: v.string(),
                  hasUnreviewedChanges: v.boolean(),
                  hasNachtrag: v.boolean(),
                }),
              ),
            }),
            v.null(),
          ),
        ),
        archive: v.optional(
          v.union(
            v.object({
              archivedCustomerCount: v.number(),
              archivedProjectCount: v.number(),
              visibleArchivedCustomers: v.array(
                v.object({
                  id: v.string(),
                  name: v.string(),
                  deletedAt: v.number(),
                }),
              ),
              visibleArchivedProjects: v.array(
                v.object({
                  id: v.string(),
                  location: v.string(),
                  status: v.string(),
                  deletedAt: v.number(),
                }),
              ),
            }),
            v.null(),
          ),
        ),
        shell: v.optional(
          v.union(
            v.object({
              organizationName: v.optional(v.union(v.string(), v.null())),
              companyEmail: v.optional(v.union(v.string(), v.null())),
              companyEmailLocale: v.optional(v.union(v.string(), v.null())),
              agentProfileName: v.optional(v.union(v.string(), v.null())),
              agentStyleId: v.optional(v.union(v.string(), v.null())),
              whatsappPhoneNumberE164: v.optional(v.union(v.string(), v.null())),
              myWhatsAppPhoneNumberE164: v.optional(v.union(v.string(), v.null())),
              myWhatsAppConnected: v.optional(v.union(v.boolean(), v.null())),
            }),
            v.null(),
          ),
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
      channel: "web",
      ctx,
      locale,
      memberRole: membership.role,
      organizationId: args.organizationId,
      prompt,
      resourceId,
      threadId,
      userId: authUser._id,
      createPendingAction: async ({ actionType, payload }) => {
        return await ctx.runMutation(internal.aiState.upsertPendingAction, {
          threadId,
          resourceId,
          organizationId: args.organizationId,
          userId: authUser._id,
          actionType,
          payload,
          expiresAt: Date.now() + PENDING_ACTION_TTL_MS,
        });
      },
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

    const agent = createWorkspaceAgent({
      channel: "web",
      organizationId: args.organizationId,
      modelId,
      locale,
      responseFormat: "panel_markdown",
      contextPacket: formatContextPacketForInstructions(contextPacket),
      readWorkspaceSnapshot,
      organizationAdminTools,
      customerTools,
      projectTools,
      userAccountTools,
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
    locale: v.optional(vAppLocale),
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
        locale,
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
    locale: v.optional(vAppLocale),
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
    locale: v.optional(vAppLocale),
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
    locale: v.optional(vAppLocale),
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
  handler: async (ctx, args): Promise<{
    status: "confirmed" | "expired" | "missing" | "error";
    text: string;
  }> => {
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
        text: pendingAction?.payload.missingMessage ?? toPendingActionMissingText(locale),
      };
    }

    if (pendingAction.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: pendingAction.payload.expiredMessage ?? toPendingActionExpiredText(locale),
      };
    }

    try {
      const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
      const text = await executePendingAction({
        actionType: pendingAction.actionType,
        auth,
        ctx,
        headers,
        locale,
        payload: pendingAction.payload,
        userId: authUser._id,
      });

      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "confirmed",
      });

      return {
        status: "confirmed" as const,
        text,
      };
    } catch (error) {
      return {
        status: "error" as const,
        text: toPendingActionErrorText({
          locale,
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
    locale: v.optional(vAppLocale),
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
  handler: async (ctx, args): Promise<{
    status: "canceled" | "expired" | "missing" | "error";
    text: string;
  }> => {
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
        text: pendingAction?.payload.missingMessage ?? toPendingActionMissingText(locale),
      };
    }

    if (pendingAction.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "expired",
      });

      return {
        status: "expired" as const,
        text: pendingAction.payload.expiredMessage ?? toPendingActionExpiredText(locale),
      };
    }

    try {
      await ctx.runMutation(internal.aiState.resolvePendingAction, {
        pendingActionId: args.pendingActionId,
        status: "canceled",
      });

      const threadId = pendingAction.threadId;
      const resourceId = pendingAction.resourceId;

      const text =
        pendingAction.payload.canceledMessage ?? toPendingActionMissingText(locale);

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
        text: toPendingActionErrorText({
          locale,
          errorMessage: errorMessageFromUnknown(error),
        }),
      };
    }
  },
});
