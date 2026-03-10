'use node';

import {
  type AppLocale,
  type LocalePreference,
} from "@mvp-template/i18n";

import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type PendingActionPayload,
  type PendingActionType,
} from "./aiPendingActions";
import { getConfiguredTwilioWhatsAppFromNumber } from "./whatsapp/twilio";
import { hasExplicitProactiveSendIntent } from "./whatsapp/normalize";
import { isPhoneOnlyMemberEmail } from "./memberProfiles";
import type {
  ArchivedCustomerSummary,
  ArchivedProjectSummary,
  ConnectedWhatsAppRecipient,
  DocumentationOverviewSearchResult,
  CreateCustomerToolsOptions,
  CreateOrganizationAdminToolsOptions,
  CreateProjectToolsOptions,
  CreateUserAccountToolsOptions,
  CustomerSummary,
  MyWhatsAppConnectionSummary,
  OrganizationAgentProfileSummary,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationSummary,
  ProjectSummary,
  ProjectTimelineBatchSummary,
  UserSettingsSummary,
  WhatsAppSetupSummary,
  WorkspaceSnapshot,
} from "../mastra/tools";

type AuthApiClient = {
  api?: unknown;
};

type ToolPermissionFlags = OrganizationSummary["permissions"];

type WhatsAppConnectionDoc = {
  _id: Id<"whatsappConnections">;
  organizationId: string;
  memberId: string;
  userId: string;
  phoneNumberE164: string;
  status: "active" | "disconnected";
};

type PendingActionRequest = {
  pendingActionId: string;
  expiresAt: number;
};

type AgentRuntimeContext = {
  runAction: (actionRef: any, args: Record<string, unknown>) => Promise<unknown>;
  runMutation: (mutationRef: any, args: Record<string, unknown>) => Promise<unknown>;
  runQuery: (queryRef: any, args: Record<string, unknown>) => Promise<unknown>;
};

type BuildWorkspaceAgentToolsOptions = {
  auth: AuthApiClient;
  headers: Headers;
  channel: "web" | "whatsapp";
  ctx: AgentRuntimeContext;
  locale: AppLocale;
  memberRole: string;
  organizationId: string;
  prompt: string;
  resourceId: string;
  threadId: string;
  userId: string;
  createPendingAction: (input: {
    actionType: PendingActionType;
    payload: PendingActionPayload;
  }) => Promise<PendingActionRequest>;
};

type ExecutePendingActionOptions = {
  actionType: PendingActionType;
  auth: AuthApiClient;
  ctx: AgentRuntimeContext;
  headers: Headers;
  locale: AppLocale;
  payload: PendingActionPayload;
  userId: string;
};

const PAGE_SIZE = 200;

type TimelineMediaSummary = {
  mediaAssetId: Id<"whatsappMediaAssets">;
  kind: "image" | "audio" | "video" | "file";
};

type TimelineSummaryRow = {
  _id: Id<"projectTimelineItems">;
  batchId: Id<"whatsappSendBatches">;
  sourceType: "whatsapp_message" | "whatsapp_batch_summary";
  addedAt: number;
  addedByName?: string;
  summary?: string;
  batchTitle?: string;
  batchOverview?: string;
  hasNachtrag?: boolean;
  nachtragNeedsClarification?: boolean;
  media: TimelineMediaSummary[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMember(member: unknown): OrganizationMember | null {
  if (!isRecord(member)) {
    return null;
  }

  const id = getRecordString(member, "id");
  const userId = getRecordString(member, "userId");
  const role = getRecordString(member, "role") ?? "member";
  const user = isRecord(member.user) ? member.user : null;
  const rawEmail =
    (user && getRecordString(user, "email")) ??
    getRecordString(member, "email") ??
    null;
  const email = isPhoneOnlyMemberEmail(rawEmail) ? null : rawEmail;
  const phoneNumberE164 = getRecordString(member, "phoneNumberE164");
  const memberType =
    getRecordString(member, "memberType") === "phone_only"
      ? "phone_only"
      : "standard";
  const name =
    getRecordString(member, "displayName") ??
    (user && getRecordString(user, "name")) ??
    getRecordString(member, "name") ??
    email ??
    phoneNumberE164 ??
    "";

  if (!id || !userId) {
    return null;
  }

  return {
    id,
    userId,
    role,
    email,
    name,
    phoneNumberE164: phoneNumberE164 ?? null,
    memberType,
    canWebSignIn: memberType !== "phone_only",
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
  const logo = typeof value.logo === "string" ? value.logo.trim() || null : null;

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
  const image = typeof value.image === "string" ? value.image.trim() || null : null;

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

  return await (method as (ctx: Record<string, unknown>) => Promise<unknown>)(context);
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

function mapCustomerSummary(customer: {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  activeProjectCount: number;
  doneProjectCount: number;
  createdAt: number;
  updatedAt: number;
}): CustomerSummary {
  return {
    id: String(customer._id),
    name: customer.name,
    contactName: customer.contactName ?? null,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    activeProjectCount: customer.activeProjectCount,
    doneProjectCount: customer.doneProjectCount,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function mapArchivedCustomerSummary(customer: {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  deletedAt: number;
  linkedProjectCount: number;
}): ArchivedCustomerSummary {
  return {
    id: String(customer._id),
    name: customer.name,
    contactName: customer.contactName ?? null,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    deletedAt: customer.deletedAt,
    linkedProjectCount: customer.linkedProjectCount,
  };
}

function mapProjectSummary(project: {
  _id: Id<"projects">;
  name: string;
  location?: string;
  status: "active" | "done";
  customerId?: Id<"customers">;
  customer?: {
    name: string;
    email?: string;
  };
  hasNachtrag: boolean;
  hasUnreviewedChanges: boolean;
  createdAt: number;
  updatedAt: number;
}): ProjectSummary {
  return {
    id: String(project._id),
    name: project.name,
    location: project.location ?? null,
    status: project.status,
    customerId: project.customerId ? String(project.customerId) : null,
    customerName: project.customer?.name ?? null,
    customerEmail: project.customer?.email ?? null,
    hasNachtrag: project.hasNachtrag,
    hasUnreviewedChanges: project.hasUnreviewedChanges,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function mapArchivedProjectSummary(project: {
  _id: Id<"projects">;
  name: string;
  location?: string;
  status: "active" | "done";
  customer?: {
    name: string;
  };
  deletedAt: number;
}): ArchivedProjectSummary {
  return {
    id: String(project._id),
    name: project.name,
    location: project.location ?? null,
    status: project.status,
    customerName: project.customer?.name ?? null,
    deletedAt: project.deletedAt,
  };
}

function buildDefaultEmailSubject(projectName: string, batchTitle: string) {
  return `${projectName}: ${batchTitle}`;
}

function buildTimelineBatchSummaries(options: {
  project: ProjectSummary;
  rows: TimelineSummaryRow[];
}): ProjectTimelineBatchSummary[] {
  const byBatchId = new Map<
    string,
    {
      batchId: string;
      addedAt: number;
      memberName: string;
      title: string;
      overview: string | null;
      summary: string | null;
      hasNachtrag: boolean;
      nachtragNeedsClarification: boolean;
      imageMediaAssetIds: string[];
      videoMediaAssetIds: string[];
    }
  >();

  for (const row of options.rows) {
    const batchId = String(row.batchId);
    const current = byBatchId.get(batchId) ?? {
      batchId,
      addedAt: row.addedAt,
      memberName: row.addedByName?.trim() || "Unknown",
      title: row.batchTitle?.trim() || row.summary?.trim() || "Project update",
      overview: row.batchOverview?.trim() || null,
      summary: row.summary?.trim() || null,
      hasNachtrag: Boolean(row.hasNachtrag),
      nachtragNeedsClarification: Boolean(row.nachtragNeedsClarification),
      imageMediaAssetIds: [],
      videoMediaAssetIds: [],
    };

    current.addedAt = Math.max(current.addedAt, row.addedAt);
    if (!current.overview && row.batchOverview?.trim()) {
      current.overview = row.batchOverview.trim();
    }
    if (!current.summary && row.summary?.trim()) {
      current.summary = row.summary.trim();
    }
    if (!current.title && row.batchTitle?.trim()) {
      current.title = row.batchTitle.trim();
    }
    current.hasNachtrag ||= Boolean(row.hasNachtrag);
    current.nachtragNeedsClarification ||= Boolean(row.nachtragNeedsClarification);

    for (const media of row.media) {
      const mediaId = String(media.mediaAssetId);
      if (media.kind === "image" && !current.imageMediaAssetIds.includes(mediaId)) {
        current.imageMediaAssetIds.push(mediaId);
      }
      if (media.kind === "video" && !current.videoMediaAssetIds.includes(mediaId)) {
        current.videoMediaAssetIds.push(mediaId);
      }
    }

    byBatchId.set(batchId, current);
  }

  return Array.from(byBatchId.values())
    .sort((batchA, batchB) => batchB.addedAt - batchA.addedAt)
    .map((batch) => {
      const subject = buildDefaultEmailSubject(options.project.name, batch.title);
      const body = batch.overview ?? batch.summary ?? "Project update";

      return {
        batchId: batch.batchId,
        title: batch.title,
        overview: batch.overview,
        summary: batch.summary,
        addedAt: batch.addedAt,
        memberName: batch.memberName,
        hasNachtrag: batch.hasNachtrag,
        nachtragNeedsClarification: batch.nachtragNeedsClarification,
        recipientEmail: options.project.customerEmail,
        subject,
        body,
        imageMediaAssetIds: batch.imageMediaAssetIds,
        videoMediaAssetIds: batch.videoMediaAssetIds,
      };
    });
}

function buildPendingActionCopy(options: {
  locale: AppLocale;
  titleEn: string;
  titleDe: string;
  descriptionEn: string;
  descriptionDe: string;
  confirmEn: string;
  confirmDe: string;
  cancelEn: string;
  cancelDe: string;
  confirmedEn: string;
  confirmedDe: string;
  canceledEn: string;
  canceledDe: string;
  expiredEn: string;
  expiredDe: string;
  missingEn: string;
  missingDe: string;
}) {
  if (options.locale === "de") {
    return {
      title: options.titleDe,
      description: options.descriptionDe,
      confirmLabel: options.confirmDe,
      cancelLabel: options.cancelDe,
      confirmedMessage: options.confirmedDe,
      canceledMessage: options.canceledDe,
      expiredMessage: options.expiredDe,
      missingMessage: options.missingDe,
    };
  }

  return {
    title: options.titleEn,
    description: options.descriptionEn,
    confirmLabel: options.confirmEn,
    cancelLabel: options.cancelEn,
    confirmedMessage: options.confirmedEn,
    canceledMessage: options.canceledEn,
    expiredMessage: options.expiredEn,
    missingMessage: options.missingEn,
  };
}

async function resolveConnectedRecipientState(options: {
  ctx: AgentRuntimeContext;
  organizationId: string;
  listOrganizationMembers: () => Promise<OrganizationMember[]>;
  userId: string;
}) {
  const [members, connections] = await Promise.all([
    options.listOrganizationMembers(),
    options.ctx.runQuery(internal.whatsappData.getActiveConnectionsByOrganization, {
      organizationId: options.organizationId,
    }) as Promise<WhatsAppConnectionDoc[]>,
  ]);

  const memberById = new Map(members.map((member) => [member.id, member]));
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
      isCurrentUser: member.userId === options.userId,
      memberType: member.memberType,
      canWebSignIn: member.canWebSignIn,
    });
  }

  recipients.sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
    if (nameComparison !== 0) {
      return nameComparison;
    }

    const fallbackLeft = left.email ?? left.phoneNumberE164;
    const fallbackRight = right.email ?? right.phoneNumberE164;
    return fallbackLeft.localeCompare(fallbackRight, undefined, {
      sensitivity: "base",
    });
  });

  return {
    connectionByMemberId,
    recipients,
  };
}

async function sendProactiveWhatsAppMessageNow(options: {
  ctx: AgentRuntimeContext;
  locale: AppLocale;
  organizationId: string;
  recipientMemberIds: string[];
  message: string;
  userId: string;
  listOrganizationMembers: () => Promise<OrganizationMember[]>;
}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = getConfiguredTwilioWhatsAppFromNumber();

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      options.locale === "de"
        ? "WhatsApp-Versand ist nicht konfiguriert."
        : "WhatsApp outbound messaging is not configured.",
    );
  }

  const messageText = options.message.trim();
  if (!messageText) {
    throw new Error(
      options.locale === "de" ? "Nachricht darf nicht leer sein." : "Message cannot be empty.",
    );
  }

  const recipientMemberIds = [
    ...new Set(
      options.recipientMemberIds
        .map((memberId) => memberId.trim())
        .filter((memberId) => memberId.length > 0),
    ),
  ];
  if (recipientMemberIds.length === 0) {
    throw new Error(
      options.locale === "de"
        ? "Mindestens ein Zielmitglied ist erforderlich."
        : "At least one recipient is required.",
    );
  }

  const { connectionByMemberId } = await resolveConnectedRecipientState({
    ctx: options.ctx,
    organizationId: options.organizationId,
    listOrganizationMembers: options.listOrganizationMembers,
    userId: options.userId,
  });

  const results: Array<{
    memberId: string;
    phoneNumberE164: string;
    status: "sent" | "failed";
    reason?: string;
  }> = [];

  for (const memberId of recipientMemberIds) {
    const connection = connectionByMemberId.get(memberId);
    if (!connection) {
      results.push({
        memberId,
        phoneNumberE164: "",
        status: "failed",
        reason:
          options.locale === "de"
            ? "Keine aktive WhatsApp-Verbindung gefunden."
            : "No active WhatsApp connection found.",
      });
      continue;
    }

    try {
      await options.ctx.runAction((internal as any).whatsapp.sendSystemMessage, {
        phoneNumberE164: connection.phoneNumberE164,
        locale: options.locale,
        text: messageText,
        connectionId: connection._id,
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
        reason: error instanceof Error ? error.message : undefined,
      });
    }
  }

  const sentCount = results.filter((result) => result.status === "sent").length;
  const failedCount = results.length - sentCount;

  if (options.locale === "de") {
    return `WhatsApp-Nachricht gesendet. Erfolgreich: ${sentCount}, fehlgeschlagen: ${failedCount}.`;
  }

  return `WhatsApp message sent. Successful: ${sentCount}, failed: ${failedCount}.`;
}

export async function buildWorkspaceAgentTools(
  options: BuildWorkspaceAgentToolsOptions,
) {
  const permissionFlags = await getToolPermissionFlags({
    auth: options.auth,
    headers: options.headers,
    organizationId: options.organizationId,
  });

  const listOrganizationMembers = async (): Promise<OrganizationMember[]> => {
    const result = await options.ctx.runQuery(
      internal.memberProfiles.getResolvedMembersForOrganization,
      {
        organizationId: options.organizationId,
      },
    );

    return (Array.isArray(result) ? result : [])
      .map((entry) => normalizeMember(entry))
      .filter((entry): entry is OrganizationMember => entry !== null);
  };

  const listOrganizationInvitations = async (input?: { status?: string }) => {
    const response = await callAuthApi(options.auth, "listInvitations", {
      query: {
        organizationId: options.organizationId,
      },
      headers: options.headers,
    });

    const records = Array.isArray(response)
      ? response
      : isRecord(response) && Array.isArray(response.invitations)
        ? response.invitations
        : [];

    const invitations = records
      .map((invitation) => normalizeInvitation(invitation))
      .filter((invitation): invitation is OrganizationInvitation => invitation !== null);

    if (!input?.status) {
      return invitations;
    }

    return invitations.filter((invitation) => invitation.status === input.status);
  };

  const getOrganizationSummary = async (): Promise<OrganizationSummary> => {
    const [organizationResult, members, invitations] = await Promise.all([
      callAuthApi(options.auth, "getFullOrganization", {
        query: {
          organizationId: options.organizationId,
        },
        headers: options.headers,
      }),
      listOrganizationMembers(),
      listOrganizationInvitations({ status: "pending" }),
    ]);

    const organization = normalizeOrganizationInfo(organizationResult) ?? {
      id: options.organizationId,
      name: options.locale === "de" ? "Aktive Organisation" : "Active organization",
      slug: options.organizationId,
      logo: null,
    };

    return {
      organization,
      currentMemberRole: options.memberRole,
      memberCount: members.length,
      invitationCount: invitations.length,
      permissions: permissionFlags,
      members,
      pendingInvitations: invitations,
    };
  };

  const readWorkspaceSnapshot = async (): Promise<WorkspaceSnapshot> => {
    const members = await listOrganizationMembers();
    const invitationsResult = await options.ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "invitation",
        where: [
          {
            field: "organizationId",
            operator: "eq",
            value: options.organizationId,
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
    const invitations = (isRecord(invitationsResult) && Array.isArray(invitationsResult.page)
      ? invitationsResult.page
      : []) as Array<{ email: string; role?: string | null }>;

    return {
      organizationId: options.organizationId,
      memberCount: members.length,
      invitationCount: invitations.length,
      members: members.map((member) => ({
        name: member.name,
        email: member.email ?? null,
        phoneNumberE164: member.phoneNumberE164 ?? null,
        memberType: member.memberType,
        role: member.role,
      })),
      pendingInvitations: invitations.map((invitation) => ({
        email: invitation.email,
        role: invitation.role ?? "member",
      })),
    };
  };

  const getConnectedRecipients = async () => {
    return await resolveConnectedRecipientState({
      ctx: options.ctx,
      organizationId: options.organizationId,
      listOrganizationMembers,
      userId: options.userId,
    });
  };

  const createPendingActionPayload = (
    actionType: PendingActionType,
    payload: Omit<
      PendingActionPayload,
      | "title"
      | "description"
      | "confirmLabel"
      | "cancelLabel"
      | "confirmedMessage"
      | "canceledMessage"
      | "expiredMessage"
      | "missingMessage"
    >,
  ) => {
    return async (copy: ReturnType<typeof buildPendingActionCopy>) => {
      return await options.createPendingAction({
        actionType,
        payload: {
          ...copy,
          ...payload,
        },
      });
    };
  };

  const organizationAdminTools: CreateOrganizationAdminToolsOptions = {
    getOrganizationSummary,
    listOrganizationMembers,
    listOrganizationInvitations,
    listConnectedWhatsAppNumbers: async () => {
      const state = await getConnectedRecipients();
      return state.recipients;
    },
    updateOrganization: permissionFlags.canUpdateOrganization
      ? async (input) => {
          const data: Record<string, string> = {};

          if (typeof input.name === "string") {
            data.name = input.name.trim();
          }
          if (typeof input.logo === "string") {
            const normalizedLogo = input.logo.trim();
            data.logo = normalizedLogo;
          }

          if (Object.keys(data).length === 0) {
            throw new Error(
              options.locale === "de"
                ? "Mindestens ein Feld zum Aktualisieren angeben."
                : "Provide at least one field to update.",
            );
          }

          const updated = await callAuthApi(options.auth, "updateOrganization", {
            body: {
              organizationId: options.organizationId,
              data,
            },
            headers: options.headers,
          });

          const organization = normalizeOrganizationInfo(updated);
          if (!organization) {
            throw new Error(
              options.locale === "de"
                ? "Organisation konnte nicht aktualisiert werden."
                : "Failed to update organization.",
            );
          }

          return organization;
        }
      : undefined,
    getOrganizationSettings: async () => {
      const result = (await options.ctx.runQuery(
        api.organizationSettings.getForActiveOrganization,
        {},
      )) as {
        organizationId: string;
        companyEmail?: string;
        companyEmailLocale?: AppLocale;
      } | null;

      return {
        organizationId: result?.organizationId ?? options.organizationId,
        companyEmail: result?.companyEmail ?? null,
        companyEmailLocale: result?.companyEmailLocale ?? options.locale,
      };
    },
    updateOrganizationSettings: async (input) => {
      const nextLocale =
        input.companyEmailLocale === "system"
          ? options.locale
          : (input.companyEmailLocale ?? options.locale);
      const result = (await options.ctx.runMutation(
        api.organizationSettings.saveForActiveOrganization,
        {
          companyEmail: input.companyEmail ?? null,
          companyEmailLocale: nextLocale,
        },
      )) as {
        organizationId: string;
        companyEmail?: string;
        companyEmailLocale?: AppLocale;
      };

      return {
        organizationId: result.organizationId,
        companyEmail: result.companyEmail ?? null,
        companyEmailLocale: result.companyEmailLocale ?? nextLocale,
      };
    },
    getOrganizationAgentProfile: async () => {
      const result = (await options.ctx.runQuery(
        api.organizationAgentProfiles.getForOrganization,
        {
          organizationId: options.organizationId,
        },
      )) as {
        organizationId: string;
        name: string;
        styleId: "woman" | "man";
      } | null;

      if (!result) {
        return null;
      }

      return {
        organizationId: result.organizationId,
        name: result.name,
        styleId: result.styleId,
      } satisfies OrganizationAgentProfileSummary;
    },
    updateOrganizationAgentProfile: async (input) => {
      const result = (await options.ctx.runMutation(
        api.organizationAgentProfiles.saveForOrganization,
        {
          organizationId: options.organizationId,
          name: input.name,
          styleId: input.styleId,
        },
      )) as {
        organizationId: string;
        name: string;
        styleId: "woman" | "man";
      };

      return {
        organizationId: result.organizationId,
        name: result.name,
        styleId: result.styleId,
      };
    },
    inviteOrganizationMember: permissionFlags.canInviteMembers
      ? async (input) => {
          const invited = await callAuthApi(options.auth, "createInvitation", {
            body: {
              organizationId: options.organizationId,
              email: input.email,
              role: input.role,
            },
            headers: options.headers,
          });

          const invitation = normalizeInvitation(invited);
          if (!invitation) {
            throw new Error(
              options.locale === "de"
                ? "Einladung konnte nicht erstellt werden."
                : "Failed to create invitation.",
            );
          }

          return invitation;
        }
      : undefined,
    updateOrganizationMemberRole: permissionFlags.canUpdateMembers
      ? async (input) => {
          const updated = await callAuthApi(options.auth, "updateMemberRole", {
            body: {
              organizationId: options.organizationId,
              memberId: input.memberId,
              role: input.role,
            },
            headers: options.headers,
          });

          const member = normalizeMember(updated);
          if (!member) {
            throw new Error(
              options.locale === "de"
                ? "Rolle konnte nicht aktualisiert werden."
                : "Failed to update member role.",
            );
          }

          return member;
        }
      : undefined,
    createPhoneOnlyMember: async (input) => {
      const created = await options.ctx.runAction(api.members.createPhoneOnlyMember, {
        organizationId: options.organizationId,
        name: input.name,
        phoneNumber: input.phoneNumber,
      });
      const member = normalizeMember(created);
      if (!member) {
        throw new Error(
          options.locale === "de"
            ? "WhatsApp-Mitglied konnte nicht erstellt werden."
            : "Failed to create WhatsApp member.",
        );
      }
      return member;
    },
    setMemberWhatsAppConnection: async (input) => {
      const connection = (await options.ctx.runMutation(
        api.whatsappData.setMemberConnection,
        {
          organizationId: options.organizationId,
          memberId: input.memberId,
          phoneNumber: input.phoneNumber,
        },
      )) as {
        memberId: string;
        userId: string;
        phoneNumberE164: string;
      } | null;

      if (!connection) {
        throw new Error(
          options.locale === "de"
            ? "WhatsApp-Verbindung konnte nicht gespeichert werden."
            : "Failed to save WhatsApp connection.",
        );
      }

      const members = await listOrganizationMembers();
      const member = members.find((entry) => entry.id === input.memberId);
      if (!member) {
        throw new Error(
          options.locale === "de"
            ? "Mitglied nicht gefunden."
            : "Member not found.",
        );
      }

      return {
        memberId: input.memberId,
        userId: member.userId,
        name: member.name,
        email: member.email,
        phoneNumberE164: connection.phoneNumberE164,
        isCurrentUser: member.userId === options.userId,
        memberType: member.memberType,
        canWebSignIn: member.canWebSignIn,
      };
    },
    requestRemoveOrganizationMember:
      options.channel === "web" && permissionFlags.canRemoveMembers
        ? async (input) => {
            const members = await listOrganizationMembers();
            const target =
              members.find((member) => member.id === input.memberIdOrEmail) ??
              members.find((member) => member.email === input.memberIdOrEmail) ??
              null;
            if (!target) {
              throw new Error(
                options.locale === "de"
                  ? "Mitglied nicht gefunden."
                  : "Member not found.",
              );
            }

            const request = createPendingActionPayload("remove-member", {
              organizationId: options.organizationId,
              memberId: target.id,
              memberIdOrEmail: input.memberIdOrEmail,
              memberName: target.name,
              memberType: target.memberType,
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Remove member",
                titleDe: "Mitglied entfernen",
                descriptionEn: `Remove ${target.name} from the active organization?`,
                descriptionDe: `${target.name} aus der aktiven Organisation entfernen?`,
                confirmEn: "Remove member",
                confirmDe: "Mitglied entfernen",
                cancelEn: "Keep member",
                cancelDe: "Behalten",
                confirmedEn: `${target.name} has been removed.`,
                confirmedDe: `${target.name} wurde entfernt.`,
                canceledEn: "Member removal canceled.",
                canceledDe: "Mitglied wurde nicht entfernt.",
                expiredEn: "Confirmation expired. Please request member removal again.",
                expiredDe: "Bestätigung abgelaufen. Bitte Mitglied erneut entfernen lassen.",
                missingEn: "No pending member removal was found.",
                missingDe: "Keine offene Bestätigung zum Entfernen gefunden.",
              }),
            );
          }
        : undefined,
    requestCancelOrganizationInvitation:
      options.channel === "web" && permissionFlags.canCancelInvitations
        ? async (input) => {
            const invitations = await listOrganizationInvitations({ status: "pending" });
            const invitation = invitations.find(
              (entry) => entry.id === input.invitationId,
            );
            if (!invitation) {
              throw new Error(
                options.locale === "de"
                  ? "Einladung nicht gefunden."
                  : "Invitation not found.",
              );
            }

            const request = createPendingActionPayload("cancel-invitation", {
              organizationId: options.organizationId,
              invitationId: invitation.id,
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Cancel invitation",
                titleDe: "Einladung widerrufen",
                descriptionEn: `Cancel the invitation for ${invitation.email}?`,
                descriptionDe: `Einladung für ${invitation.email} widerrufen?`,
                confirmEn: "Cancel invitation",
                confirmDe: "Einladung widerrufen",
                cancelEn: "Keep invitation",
                cancelDe: "Behalten",
                confirmedEn: `Invitation for ${invitation.email} has been canceled.`,
                confirmedDe: `Einladung für ${invitation.email} wurde widerrufen.`,
                canceledEn: "Invitation cancelation was canceled.",
                canceledDe: "Widerruf der Einladung wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request invitation cancelation again.",
                expiredDe: "Bestätigung abgelaufen. Bitte Einladung erneut widerrufen lassen.",
                missingEn: "No pending invitation cancelation was found.",
                missingDe: "Keine offene Einladung zum Widerruf gefunden.",
              }),
            );
          }
        : undefined,
    requestRemoveMemberWhatsAppConnection:
      options.channel === "web"
        ? async (input) => {
            const members = await listOrganizationMembers();
            const target = members.find((member) => member.id === input.memberId);
            if (!target) {
              throw new Error(
                options.locale === "de"
                  ? "Mitglied nicht gefunden."
                  : "Member not found.",
              );
            }

            const request = createPendingActionPayload(
              "remove-member-whatsapp-connection",
              {
                organizationId: options.organizationId,
                memberId: target.id,
                memberName: target.name,
              },
            );

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Remove WhatsApp connection",
                titleDe: "WhatsApp-Verbindung entfernen",
                descriptionEn: `Remove the WhatsApp connection for ${target.name}?`,
                descriptionDe: `WhatsApp-Verbindung von ${target.name} entfernen?`,
                confirmEn: "Remove connection",
                confirmDe: "Verbindung entfernen",
                cancelEn: "Keep connection",
                cancelDe: "Behalten",
                confirmedEn: `WhatsApp connection for ${target.name} has been removed.`,
                confirmedDe: `WhatsApp-Verbindung von ${target.name} wurde entfernt.`,
                canceledEn: "WhatsApp connection removal canceled.",
                canceledDe: "Entfernen der WhatsApp-Verbindung wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request connection removal again.",
                expiredDe: "Bestätigung abgelaufen. Bitte Verbindung erneut entfernen lassen.",
                missingEn: "No pending WhatsApp connection removal was found.",
                missingDe: "Keine offene Bestätigung zum Entfernen der Verbindung gefunden.",
              }),
            );
          }
        : undefined,
    requestSendMemberWhatsAppGuideEmail:
      options.channel === "web"
        ? async (input) => {
            const members = await listOrganizationMembers();
            const target = members.find((member) => member.id === input.memberId);
            if (!target?.email) {
              throw new Error(
                options.locale === "de"
                  ? "Mitglied mit E-Mail nicht gefunden."
                  : "Member with email not found.",
              );
            }

            const request = createPendingActionPayload(
              "send-member-whatsapp-guide-email",
              {
                organizationId: options.organizationId,
                memberId: target.id,
                memberName: target.name,
                recipientEmail: target.email,
              },
            );

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Send WhatsApp guide email",
                titleDe: "WhatsApp-Leitfaden senden",
                descriptionEn: `Send the WhatsApp activation guide to ${target.email}?`,
                descriptionDe: `WhatsApp-Aktivierungsleitfaden an ${target.email} senden?`,
                confirmEn: "Send email",
                confirmDe: "E-Mail senden",
                cancelEn: "Do not send",
                cancelDe: "Nicht senden",
                confirmedEn: `WhatsApp activation guide sent to ${target.email}.`,
                confirmedDe: `WhatsApp-Aktivierungsleitfaden an ${target.email} gesendet.`,
                canceledEn: "Guide email was not sent.",
                canceledDe: "Leitfaden wurde nicht gesendet.",
                expiredEn: "Confirmation expired. Please request the email again.",
                expiredDe: "Bestätigung abgelaufen. Bitte E-Mail erneut anfordern.",
                missingEn: "No pending WhatsApp guide email was found.",
                missingDe: "Keine offene E-Mail-Bestätigung gefunden.",
              }),
            );
          }
        : undefined,
    requestSendProactiveWhatsAppMessage:
      options.channel === "web"
        ? async (input) => {
            if (!hasExplicitProactiveSendIntent(options.prompt)) {
              throw new Error(
                options.locale === "de"
                  ? "Ich kann proaktive WhatsApp-Nachrichten nur vorbereiten, wenn du das Senden ausdrücklich verlangst."
                  : "I can only prepare proactive WhatsApp sends when you explicitly ask for sending.",
              );
            }

            const recipients = await getConnectedRecipients();
            const targetNames = input.recipientMemberIds
              .map((memberId) =>
                recipients.recipients.find((entry) => entry.memberId === memberId)?.name,
              )
              .filter((name): name is string => typeof name === "string");

            const request = createPendingActionPayload(
              "send-proactive-whatsapp-message",
              {
                organizationId: options.organizationId,
                recipientMemberIds: input.recipientMemberIds,
                message: input.message,
              },
            );

            const descriptionEn =
              targetNames.length > 0
                ? `Send a proactive WhatsApp message to ${targetNames.join(", ")}?`
                : "Send a proactive WhatsApp message to the selected members?";
            const descriptionDe =
              targetNames.length > 0
                ? `Proaktive WhatsApp-Nachricht an ${targetNames.join(", ")} senden?`
                : "Proaktive WhatsApp-Nachricht an die ausgewählten Mitglieder senden?";

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Send proactive WhatsApp message",
                titleDe: "Proaktive WhatsApp senden",
                descriptionEn,
                descriptionDe,
                confirmEn: "Send WhatsApp",
                confirmDe: "WhatsApp senden",
                cancelEn: "Do not send",
                cancelDe: "Nicht senden",
                confirmedEn: "WhatsApp message has been sent.",
                confirmedDe: "WhatsApp-Nachricht wurde gesendet.",
                canceledEn: "WhatsApp send was canceled.",
                canceledDe: "WhatsApp-Versand wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request the WhatsApp send again.",
                expiredDe: "Bestätigung abgelaufen. Bitte WhatsApp erneut anfordern.",
                missingEn: "No pending WhatsApp send was found.",
                missingDe: "Kein offener WhatsApp-Versand gefunden.",
              }),
            );
          }
        : undefined,
    requestLeaveOrganization:
      options.channel === "web"
        ? async () => {
            const request = createPendingActionPayload("leave-organization", {
              organizationId: options.organizationId,
              organizationName: (await getOrganizationSummary()).organization.name,
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Leave organization",
                titleDe: "Organisation verlassen",
                descriptionEn: "Leave the active organization?",
                descriptionDe: "Aktive Organisation verlassen?",
                confirmEn: "Leave organization",
                confirmDe: "Organisation verlassen",
                cancelEn: "Stay",
                cancelDe: "Bleiben",
                confirmedEn: "You have left the organization.",
                confirmedDe: "Du hast die Organisation verlassen.",
                canceledEn: "Leaving the organization was canceled.",
                canceledDe: "Verlassen der Organisation wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request leaving again.",
                expiredDe: "Bestätigung abgelaufen. Bitte erneut anfordern.",
                missingEn: "No pending leave action was found.",
                missingDe: "Keine offene Bestätigung zum Verlassen gefunden.",
              }),
            );
          }
        : undefined,
    requestDeleteOrganization:
      options.channel === "web" && permissionFlags.canDeleteOrganization
        ? async () => {
            const organization = (await getOrganizationSummary()).organization;
            const request = createPendingActionPayload("delete-organization", {
              organizationId: options.organizationId,
              organizationName: organization.name,
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Delete organization",
                titleDe: "Organisation löschen",
                descriptionEn: `Delete ${organization.name}? This cannot be undone.`,
                descriptionDe: `${organization.name} löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
                confirmEn: "Delete organization",
                confirmDe: "Organisation löschen",
                cancelEn: "Keep organization",
                cancelDe: "Behalten",
                confirmedEn: "Organization has been deleted.",
                confirmedDe: "Organisation wurde gelöscht.",
                canceledEn: "Organization deletion was canceled.",
                canceledDe: "Löschen der Organisation wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request deletion again.",
                expiredDe: "Bestätigung abgelaufen. Bitte Löschung erneut anfordern.",
                missingEn: "No pending organization deletion was found.",
                missingDe: "Keine offene Löschbestätigung gefunden.",
              }),
            );
          }
        : undefined,
  };

  const customerTools: CreateCustomerToolsOptions = {
    listCustomers: async () => {
      const customers = (await options.ctx.runQuery(api.customers.list, {})) as Array<{
        _id: Id<"customers">;
        name: string;
        contactName?: string;
        email?: string;
        phone?: string;
        activeProjectCount: number;
        doneProjectCount: number;
        createdAt: number;
        updatedAt: number;
      }>;
      return customers.map(mapCustomerSummary);
    },
    getCustomer: async (input) => {
      const customer = (await options.ctx.runQuery(api.customers.getById, {
        customerId: input.customerId as Id<"customers">,
      })) as {
        _id: Id<"customers">;
        name: string;
        contactName?: string;
        email?: string;
        phone?: string;
        activeProjectCount: number;
        doneProjectCount: number;
        createdAt: number;
        updatedAt: number;
      } | null;
      return customer ? mapCustomerSummary(customer) : null;
    },
    createCustomer: async (input) => {
      const customerId = (await options.ctx.runMutation(api.customers.create, {
        name: input.name,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
      })) as Id<"customers">;
      const customer = await customerTools.getCustomer({
        customerId: String(customerId),
      });
      if (!customer) {
        throw new Error(
          options.locale === "de"
            ? "Kunde konnte nicht geladen werden."
            : "Failed to load created customer.",
        );
      }
      return customer;
    },
    updateCustomer: async (input) => {
      await options.ctx.runMutation(api.customers.update, {
        customerId: input.customerId as Id<"customers">,
        name: input.name,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
      });
      const customer = await customerTools.getCustomer({
        customerId: input.customerId,
      });
      if (!customer) {
        throw new Error(
          options.locale === "de"
            ? "Kunde konnte nicht geladen werden."
            : "Failed to load updated customer.",
        );
      }
      return customer;
    },
    listArchivedCustomers: async () => {
      const customers = (await options.ctx.runQuery(
        api.customers.listArchived,
        {},
      )) as Array<{
        _id: Id<"customers">;
        name: string;
        contactName?: string;
        email?: string;
        phone?: string;
        deletedAt: number;
        linkedProjectCount: number;
      }>;
      return customers.map(mapArchivedCustomerSummary);
    },
    restoreCustomer: async (input) => {
      await options.ctx.runMutation(api.customers.restore, {
        customerId: input.customerId as Id<"customers">,
      });
      const customer = await customerTools.getCustomer({
        customerId: input.customerId,
      });
      if (!customer) {
        throw new Error(
          options.locale === "de"
            ? "Kunde konnte nicht wiederhergestellt werden."
            : "Failed to restore customer.",
        );
      }
      return customer;
    },
    requestArchiveCustomer:
      options.channel === "web"
        ? async (input) => {
            const customer = await customerTools.getCustomer(input);
            if (!customer) {
              throw new Error(
                options.locale === "de"
                  ? "Kunde nicht gefunden."
                  : "Customer not found.",
              );
            }

            const request = createPendingActionPayload("archive-customer", {
              organizationId: options.organizationId,
              customerId: input.customerId as Id<"customers">,
              customerName: customer.name,
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Archive customer",
                titleDe: "Kunden archivieren",
                descriptionEn: `Archive ${customer.name} and linked projects?`,
                descriptionDe: `${customer.name} und verknüpfte Projekte archivieren?`,
                confirmEn: "Archive customer",
                confirmDe: "Kunden archivieren",
                cancelEn: "Keep customer",
                cancelDe: "Behalten",
                confirmedEn: `${customer.name} has been archived.`,
                confirmedDe: `${customer.name} wurde archiviert.`,
                canceledEn: "Customer archive was canceled.",
                canceledDe: "Archivierung wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request archiving again.",
                expiredDe: "Bestätigung abgelaufen. Bitte Archivierung erneut anfordern.",
                missingEn: "No pending customer archive was found.",
                missingDe: "Keine offene Kunden-Archivierung gefunden.",
              }),
            );
          }
        : undefined,
  };

  const projectTools: CreateProjectToolsOptions = {
    listProjects: async (input) => {
      const statuses = input?.statuses;
      const queryArgs = statuses ? { statuses } : {};
      const projects = (input?.customerId
        ? await options.ctx.runQuery(api.projects.listByCustomer, {
            customerId: input.customerId as Id<"customers">,
            ...(statuses ? { statuses } : {}),
          })
        : await options.ctx.runQuery(api.projects.list, queryArgs)) as Array<{
        _id: Id<"projects">;
        name: string;
        location?: string;
        status: "active" | "done";
        customerId?: Id<"customers">;
        customer?: {
          name: string;
          email?: string;
        };
        hasNachtrag: boolean;
        hasUnreviewedChanges: boolean;
        createdAt: number;
        updatedAt: number;
      }>;

      return projects.map(mapProjectSummary);
    },
    getProject: async (input) => {
      const project = (await options.ctx.runQuery(api.projects.getById, {
        projectId: input.projectId as Id<"projects">,
      })) as {
        _id: Id<"projects">;
        name: string;
        location?: string;
        status: "active" | "done";
        customerId?: Id<"customers">;
        customer?: {
          name: string;
          email?: string;
        };
        hasNachtrag: boolean;
        hasUnreviewedChanges: boolean;
        createdAt: number;
        updatedAt: number;
      } | null;
      return project ? mapProjectSummary(project) : null;
    },
    createProject: async (input) => {
      const projectId = (await options.ctx.runMutation(api.projects.create, {
        name: input.name,
        location: input.location,
        customerId: input.customerId as Id<"customers"> | undefined,
      })) as Id<"projects">;
      const project = await projectTools.getProject({
        projectId: String(projectId),
      });
      if (!project) {
        throw new Error(
          options.locale === "de"
            ? "Projekt konnte nicht geladen werden."
            : "Failed to load created project.",
        );
      }
      return project;
    },
    updateProject: async (input) => {
      await options.ctx.runMutation(api.projects.update, {
        projectId: input.projectId as Id<"projects">,
        name: input.name,
        location: input.location,
        customerId:
          input.customerId === undefined
            ? undefined
            : input.customerId === null
              ? null
              : (input.customerId as Id<"customers">),
        status: input.status,
      });
      const project = await projectTools.getProject({
        projectId: input.projectId,
      });
      if (!project) {
        throw new Error(
          options.locale === "de"
            ? "Projekt konnte nicht geladen werden."
            : "Failed to load updated project.",
        );
      }
      return project;
    },
    listArchivedProjects: async () => {
      const projects = (await options.ctx.runQuery(api.projects.listArchived, {})) as Array<{
        _id: Id<"projects">;
        name: string;
        location?: string;
        status: "active" | "done";
        customer?: {
          name: string;
        };
        deletedAt: number;
      }>;
      return projects.map(mapArchivedProjectSummary);
    },
    restoreProject: async (input) => {
      await options.ctx.runMutation(api.projects.restore, {
        projectId: input.projectId as Id<"projects">,
      });
      const project = await projectTools.getProject({
        projectId: input.projectId,
      });
      if (!project) {
        throw new Error(
          options.locale === "de"
            ? "Projekt konnte nicht wiederhergestellt werden."
            : "Failed to restore project.",
        );
      }
      return project;
    },
    getProjectTimelineBatches: async (input) => {
      const project = await projectTools.getProject({
        projectId: input.projectId,
      });
      if (!project) {
        throw new Error(
          options.locale === "de"
            ? "Projekt nicht gefunden."
            : "Project not found.",
        );
      }

      const localized = (await options.ctx.runAction(
        api.projectTranslations.timelineLocalized,
        {
          projectId: input.projectId as Id<"projects">,
          limit: 500,
        },
      )) as { rows: TimelineSummaryRow[] };

      return buildTimelineBatchSummaries({
        project,
        rows: localized.rows,
      });
    },
    searchProjectDocumentationOverviews: async (input) => {
      return (await options.ctx.runAction(
        (internal as any).documentationSearch.searchDocumentationOverviews,
        {
          organizationId: options.organizationId,
          queryText: input.query,
          projectId: input.projectId as Id<"projects"> | undefined,
          limit: input.limit,
        },
      )) as DocumentationOverviewSearchResult;
    },
    reassignProjectBatch: async (input) => {
      await options.ctx.runMutation(api.projects.reassignBatchProject, {
        batchId: input.batchId as Id<"whatsappSendBatches">,
        targetProjectId: input.targetProjectId as Id<"projects">,
      });
      return {
        batchId: input.batchId,
        targetProjectId: input.targetProjectId,
      };
    },
    prepareProjectExport:
      options.channel === "web"
        ? async (input) => {
            const manifest = await options.ctx.runAction(
              api.exports.prepareZipManifest,
              {
                mode: "projects",
                projectIds: [input.projectId as Id<"projects">],
              },
            );
            return {
              status: "export_ready" as const,
              exportMode: "projects" as const,
              manifest,
            };
          }
        : undefined,
    prepareCustomerExport:
      options.channel === "web"
        ? async (input) => {
            const manifest = await options.ctx.runAction(
              api.exports.prepareZipManifest,
              {
                mode: "customers",
                customerIds: [input.customerId as Id<"customers">],
              },
            );
            return {
              status: "export_ready" as const,
              exportMode: "customers" as const,
              manifest,
            };
          }
        : undefined,
    requestArchiveProject:
      options.channel === "web"
        ? async (input) => {
            const project = await projectTools.getProject(input);
            if (!project) {
              throw new Error(
                options.locale === "de"
                  ? "Projekt nicht gefunden."
                  : "Project not found.",
              );
            }

            const request = createPendingActionPayload("archive-project", {
              organizationId: options.organizationId,
              projectId: input.projectId as Id<"projects">,
              projectName: project.name,
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Archive project",
                titleDe: "Projekt archivieren",
                descriptionEn: `Archive ${project.name}?`,
                descriptionDe: `${project.name} archivieren?`,
                confirmEn: "Archive project",
                confirmDe: "Projekt archivieren",
                cancelEn: "Keep project",
                cancelDe: "Behalten",
                confirmedEn: `${project.name} has been archived.`,
                confirmedDe: `${project.name} wurde archiviert.`,
                canceledEn: "Project archive was canceled.",
                canceledDe: "Projektarchivierung wurde abgebrochen.",
                expiredEn: "Confirmation expired. Please request archiving again.",
                expiredDe: "Bestätigung abgelaufen. Bitte Archivierung erneut anfordern.",
                missingEn: "No pending project archive was found.",
                missingDe: "Keine offene Projektarchivierung gefunden.",
              }),
            );
          }
        : undefined,
    requestSendProjectBatchEmail:
      options.channel === "web"
        ? async (input) => {
            const project = await projectTools.getProject({
              projectId: input.projectId,
            });
            if (!project) {
              throw new Error(
                options.locale === "de"
                  ? "Projekt nicht gefunden."
                  : "Project not found.",
              );
            }

            const batches = await projectTools.getProjectTimelineBatches!({
              projectId: input.projectId,
            });
            const batch = batches.find((entry) => entry.batchId === input.batchId);
            if (!batch) {
              throw new Error(
                options.locale === "de"
                  ? "Timeline-Batch nicht gefunden."
                  : "Timeline batch not found.",
              );
            }
            if (!batch.recipientEmail) {
              throw new Error(
                options.locale === "de"
                  ? "Für dieses Projekt fehlt eine Kunden-E-Mail."
                  : "This project is missing a customer email address.",
              );
            }

            const subject = input.subject?.trim() || batch.subject;
            const body = input.body?.trim() || batch.body;
            const imageMediaAssetIds =
              input.imageMediaAssetIds && input.imageMediaAssetIds.length > 0
                ? input.imageMediaAssetIds
                : batch.imageMediaAssetIds;
            const videoMediaAssetIds =
              input.videoMediaAssetIds && input.videoMediaAssetIds.length > 0
                ? input.videoMediaAssetIds
                : batch.videoMediaAssetIds;

            const request = createPendingActionPayload("send-project-batch-email", {
              organizationId: options.organizationId,
              projectId: input.projectId as Id<"projects">,
              projectName: project.name,
              batchId: input.batchId as Id<"whatsappSendBatches">,
              recipientEmail: batch.recipientEmail,
              subject,
              body,
              imageMediaAssetIds: imageMediaAssetIds as Id<"whatsappMediaAssets">[],
              videoMediaAssetIds: videoMediaAssetIds as Id<"whatsappMediaAssets">[],
            });

            return await request(
              buildPendingActionCopy({
                locale: options.locale,
                titleEn: "Send customer email",
                titleDe: "Kunden-E-Mail senden",
                descriptionEn: `Send the selected project update to ${batch.recipientEmail}?`,
                descriptionDe: `Ausgewähltes Projekt-Update an ${batch.recipientEmail} senden?`,
                confirmEn: "Send email",
                confirmDe: "E-Mail senden",
                cancelEn: "Do not send",
                cancelDe: "Nicht senden",
                confirmedEn: `Project update email sent to ${batch.recipientEmail}.`,
                confirmedDe: `Projekt-Update an ${batch.recipientEmail} gesendet.`,
                canceledEn: "Customer email was not sent.",
                canceledDe: "Kunden-E-Mail wurde nicht gesendet.",
                expiredEn: "Confirmation expired. Please request the email again.",
                expiredDe: "Bestätigung abgelaufen. Bitte E-Mail erneut anfordern.",
                missingEn: "No pending customer email was found.",
                missingDe: "Keine offene Kunden-E-Mail gefunden.",
              }),
            );
          }
        : undefined,
  };

  const userAccountTools: CreateUserAccountToolsOptions = {
    getUserSettings: async (): Promise<UserSettingsSummary> => {
      const [userResult, localePreference, themePreference] = await Promise.all([
        options.ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [
            {
              field: "_id",
              operator: "eq",
              value: options.userId,
            },
          ],
        }),
        options.ctx.runQuery(internal.preferences.getLocaleForUser, {
          userId: options.userId,
        }),
        options.ctx.runQuery(internal.preferences.getThemeForUser, {
          userId: options.userId,
        }),
      ]);

      const normalizedUser = normalizeUserInfo(userResult) ?? {
        id: options.userId,
        name: options.locale === "de" ? "Benutzer" : "User",
        email: "unknown@example.com",
        image: null,
      };

      return {
        user: normalizedUser,
        preferences: {
          language: (localePreference as LocalePreference | null) ?? "system",
          theme: (themePreference as "light" | "dark" | null) ?? "system",
        },
      };
    },
    updateUserSettings: async (input) => {
      const userUpdateData: Record<string, string | null> = {};
      let hasPreferenceUpdate = false;

      if (typeof input.name === "string") {
        const normalizedName = input.name.trim();
        if (normalizedName.length < 2) {
          throw new Error(
            options.locale === "de"
              ? "Der Name muss mindestens 2 Zeichen lang sein."
              : "Name must be at least 2 characters.",
          );
        }
        userUpdateData.name = normalizedName;
      }

      if (input.image !== undefined) {
        userUpdateData.image =
          input.image === null ? null : input.image.trim() || null;
      }

      if (Object.keys(userUpdateData).length > 0) {
        await callAuthApi(options.auth, "updateUser", {
          body: userUpdateData,
          headers: options.headers,
        });
      }

      if (input.language !== undefined) {
        hasPreferenceUpdate = true;
        await options.ctx.runMutation(internal.preferences.setLocaleForUser, {
          userId: options.userId,
          locale: input.language === "system" ? null : input.language,
        });
      }

      if (input.theme !== undefined) {
        hasPreferenceUpdate = true;
        await options.ctx.runMutation(internal.preferences.setThemeForUser, {
          userId: options.userId,
          theme: input.theme === "system" ? null : input.theme,
        });
      }

      if (Object.keys(userUpdateData).length === 0 && !hasPreferenceUpdate) {
        throw new Error(
          options.locale === "de"
            ? "Mindestens ein Feld zum Aktualisieren angeben."
            : "Provide at least one field to update.",
        );
      }

      return await userAccountTools.getUserSettings();
    },
    getWhatsAppSetupInfo: async (): Promise<WhatsAppSetupSummary> => {
      const result = (await options.ctx.runQuery(
        api.whatsappData.getConnectionSetupInfo,
        {},
      )) as {
        phoneNumberE164: string | null;
        initialMessage: string;
        waLink: string | null;
      };

      return {
        phoneNumberE164: result.phoneNumberE164,
        initialMessage: result.initialMessage,
        waLink: result.waLink,
      };
    },
    getMyWhatsAppConnection: async (): Promise<MyWhatsAppConnectionSummary | null> => {
      const result = (await options.ctx.runQuery(api.whatsappData.getMyConnection, {
        organizationId: options.organizationId,
      })) as {
        memberId: string;
        role: string;
        connection?: {
          phoneNumberE164?: string;
        } | null;
      } | null;

      if (!result) {
        return null;
      }

      return {
        memberId: result.memberId,
        role: result.role,
        phoneNumberE164: result.connection?.phoneNumberE164 ?? null,
      };
    },
  };

  return {
    permissionFlags,
    readWorkspaceSnapshot,
    organizationAdminTools,
    customerTools,
    projectTools,
    userAccountTools,
  };
}

export async function executePendingAction(options: ExecutePendingActionOptions) {
  switch (options.actionType) {
    case "archive-customer": {
      if (!options.payload.customerId) {
        throw new Error("Missing customer id");
      }
      await options.ctx.runMutation(api.customers.archive, {
        customerId: options.payload.customerId as Id<"customers">,
      });
      return options.payload.confirmedMessage;
    }
    case "archive-project": {
      if (!options.payload.projectId) {
        throw new Error("Missing project id");
      }
      await options.ctx.runMutation(api.projects.archive, {
        projectId: options.payload.projectId as Id<"projects">,
      });
      return options.payload.confirmedMessage;
    }
    case "cancel-invitation": {
      if (!options.payload.invitationId) {
        throw new Error("Missing invitation id");
      }
      await callAuthApi(options.auth, "cancelInvitation", {
        body: {
          invitationId: options.payload.invitationId,
        },
        headers: options.headers,
      });
      return options.payload.confirmedMessage;
    }
    case "delete-organization": {
      if (!options.payload.organizationId) {
        throw new Error("Missing organization id");
      }
      await callAuthApi(options.auth, "deleteOrganization", {
        body: {
          organizationId: options.payload.organizationId,
        },
        headers: options.headers,
      });
      return options.payload.confirmedMessage;
    }
    case "leave-organization": {
      if (!options.payload.organizationId) {
        throw new Error("Missing organization id");
      }
      await callAuthApi(options.auth, "leaveOrganization", {
        body: {
          organizationId: options.payload.organizationId,
        },
        headers: options.headers,
      });
      return options.payload.confirmedMessage;
    }
    case "remove-member": {
      if (!options.payload.organizationId) {
        throw new Error("Missing organization id");
      }
      if (options.payload.memberType === "phone_only" && options.payload.memberId) {
        await options.ctx.runAction(api.members.removePhoneOnlyMember, {
          organizationId: options.payload.organizationId,
          memberId: options.payload.memberId,
        });
        return options.payload.confirmedMessage;
      }
      if (!options.payload.memberIdOrEmail) {
        throw new Error("Missing member identifier");
      }
      await callAuthApi(options.auth, "removeMember", {
        body: {
          organizationId: options.payload.organizationId,
          memberIdOrEmail: options.payload.memberIdOrEmail,
        },
        headers: options.headers,
      });
      return options.payload.confirmedMessage;
    }
    case "remove-member-whatsapp-connection": {
      if (!(options.payload.organizationId && options.payload.memberId)) {
        throw new Error("Missing member connection target");
      }
      await options.ctx.runAction(api.whatsappData.removeMemberConnection, {
        organizationId: options.payload.organizationId,
        memberId: options.payload.memberId,
      });
      return options.payload.confirmedMessage;
    }
    case "send-member-whatsapp-guide-email": {
      if (!(options.payload.organizationId && options.payload.memberId)) {
        throw new Error("Missing member id");
      }
      await options.ctx.runAction(api.whatsappData.sendMemberActivationGuideEmail, {
        organizationId: options.payload.organizationId,
        memberId: options.payload.memberId,
      });
      return options.payload.confirmedMessage;
    }
    case "send-project-batch-email": {
      if (!(options.payload.projectId && options.payload.batchId)) {
        throw new Error("Missing project email target");
      }
      await options.ctx.runAction(api.projectEmails.sendTimelineBatchEmail, {
        projectId: options.payload.projectId as Id<"projects">,
        batchId: options.payload.batchId as Id<"whatsappSendBatches">,
        subject: options.payload.subject ?? "",
        body: options.payload.body ?? "",
        imageMediaAssetIds:
          (options.payload.imageMediaAssetIds as Id<"whatsappMediaAssets">[] | undefined) ?? [],
        videoMediaAssetIds:
          (options.payload.videoMediaAssetIds as Id<"whatsappMediaAssets">[] | undefined) ?? [],
      });
      return options.payload.confirmedMessage;
    }
    case "send-proactive-whatsapp-message": {
      if (!(options.payload.organizationId && options.payload.recipientMemberIds && options.payload.message)) {
        throw new Error("Missing WhatsApp send payload");
      }

      const listOrganizationMembers = async (): Promise<OrganizationMember[]> => {
        const result = await options.ctx.runQuery(
          internal.memberProfiles.getResolvedMembersForOrganization,
          {
            organizationId: options.payload.organizationId!,
          },
        );

        return (Array.isArray(result) ? result : [])
          .map((entry) => normalizeMember(entry))
          .filter((entry): entry is OrganizationMember => entry !== null);
      };

      return await sendProactiveWhatsAppMessageNow({
        ctx: options.ctx,
        locale: options.locale,
        organizationId: options.payload.organizationId,
        recipientMemberIds: options.payload.recipientMemberIds,
        message: options.payload.message,
        userId: options.userId,
        listOrganizationMembers,
      });
    }
  }
}
