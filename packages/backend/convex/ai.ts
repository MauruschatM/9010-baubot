'use node';

import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_DATA_URL_LENGTH,
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
};

type InvitationDoc = {
  email: string;
  role?: string | null;
  status: string;
};

type ChatAttachment = {
  name?: string;
  contentType: string;
  dataUrl: string;
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

const PAGE_SIZE = 200;
const STREAM_FLUSH_INTERVAL_MS = 180;
const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

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
      dataUrl: attachment.dataUrl.trim(),
    }))
    .filter(
      (attachment) =>
        attachment.contentType.length > 0 &&
        attachment.dataUrl.startsWith("data:") &&
        attachment.dataUrl.length > 0 &&
        attachment.dataUrl.length <= MAX_ATTACHMENT_DATA_URL_LENGTH,
    )
    .slice(0, MAX_ATTACHMENTS);
}

function extractBase64FromDataUrl(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 0) {
    return null;
  }

  const metadata = dataUrl.slice(0, separatorIndex).toLowerCase();
  const payload = dataUrl.slice(separatorIndex + 1);
  if (!payload) {
    return null;
  }

  if (metadata.includes(";base64")) {
    return payload;
  }

  return Buffer.from(decodeURIComponent(payload), "utf8").toString("base64");
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
  attachments: ChatAttachment[];
}) {
  const parts: RequestPart[] = [];

  if (options.prompt) {
    parts.push({
      type: "text",
      text: options.prompt,
    });
  }

  for (const attachment of options.attachments) {
    const base64Data = extractBase64FromDataUrl(attachment.dataUrl);
    if (!base64Data) {
      continue;
    }

    if (attachment.contentType.startsWith("image/")) {
      parts.push({
        type: "image",
        image: base64Data,
        mimeType: attachment.contentType,
      });
      continue;
    }

    parts.push({
      type: "file",
      data: base64Data,
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

export const chat = action({
  args: {
    organizationId: v.string(),
    prompt: v.string(),
    locale: v.optional(v.union(v.literal("en"), v.literal("de"))),
    attachments: v.optional(
      v.array(
        v.object({
          name: v.optional(v.string()),
          contentType: v.string(),
          dataUrl: v.string(),
        }),
      ),
    ),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    text: v.union(v.string(), v.null()),
    model: v.string(),
    threadId: v.string(),
    runId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error("AI gateway is not configured");
    }

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

    if ((args.attachments?.length ?? 0) > MAX_ATTACHMENTS) {
      throw new Error(`You can attach up to ${MAX_ATTACHMENTS} files`);
    }

    const prompt = normalizePrompt(args.prompt);
    const attachments = normalizeAttachments(
      (args.attachments ?? []) as ChatAttachment[],
    );

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

    const userMessage = buildUserMessage({
      prompt,
      attachments,
    });

    const userPersistedMessage = buildPersistedMessage({
      messageId: createMessageId(`${threadId}:user`),
      role: "user",
      type: "text",
      content: userMessage.content,
      text:
        typeof userMessage.content === "string"
          ? userMessage.content
          :
              prompt ||
              attachments.map((attachment) => attachment.name ?? "Attachment").join(", "),
      attachmentNames: attachments.map((attachment) => attachment.name ?? "Attachment"),
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

    const modelId = process.env.AI_GATEWAY_MODEL ?? DEFAULT_AI_GATEWAY_MODEL;

    const agent = createWorkspaceAgent({
      organizationId: args.organizationId,
      modelId,
      locale,
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
            actor: agentId?.includes("organization") ? "organization" : "main",
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

      if (finalText.length > 0) {
        newMessages.push(
          buildPersistedMessage({
            messageId: createMessageId(`${threadId}:assistant`),
            role: "assistant",
            type: "text",
            content: finalText,
            text: finalText,
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
        text: finalText || null,
        model: modelId,
        threadId,
        runId,
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
