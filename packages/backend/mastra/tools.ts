'use node';

import { SUPPORTED_LOCALES, type LocalePreference } from "@mvp-template/i18n";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  createPendingActionToolResult,
  type PendingActionType,
} from "../convex/aiPendingActions";

export type WorkspaceSnapshot = {
  organizationId: string;
  memberCount: number;
  invitationCount: number;
  members: Array<{
    name: string;
    email: string | null;
    phoneNumberE164: string | null;
    memberType: "standard" | "phone_only";
    role: string;
  }>;
  pendingInvitations: Array<{
    email: string;
    role: string;
  }>;
};

export type OrganizationMember = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phoneNumberE164: string | null;
  memberType: "standard" | "phone_only";
  canWebSignIn: boolean;
  role: string;
};

export type OrganizationInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
};

export type OrganizationSummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
  };
  currentMemberRole: string | null;
  memberCount: number;
  invitationCount: number;
  permissions: {
    canUpdateOrganization: boolean;
    canInviteMembers: boolean;
    canUpdateMembers: boolean;
    canRemoveMembers: boolean;
    canCancelInvitations: boolean;
    canDeleteOrganization: boolean;
    canLeaveOrganization: boolean;
  };
  members: OrganizationMember[];
  pendingInvitations: OrganizationInvitation[];
};

export type UserSettingsSummary = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  preferences: {
    language: LocalePreference;
    theme: "light" | "dark" | "system";
  };
};

export type ConnectedWhatsAppRecipient = {
  memberId: string;
  userId: string;
  name: string;
  email: string | null;
  phoneNumberE164: string;
  isCurrentUser: boolean;
  memberType: "standard" | "phone_only";
  canWebSignIn: boolean;
};

export type ProactiveWhatsAppSendResult = {
  requestedRecipientCount: number;
  sentCount: number;
  failedCount: number;
  results: Array<{
    memberId: string;
    phoneNumberE164: string;
    status: "sent" | "failed";
    reason?: string;
  }>;
};

export type CreateOrganizationToolsOptions = {
  getOrganizationSummary: () => Promise<OrganizationSummary>;
  listOrganizationMembers: () => Promise<OrganizationMember[]>;
  listOrganizationInvitations: (input?: { status?: string }) => Promise<
    OrganizationInvitation[]
  >;
  listConnectedWhatsAppNumbers?: () => Promise<ConnectedWhatsAppRecipient[]>;
  sendProactiveWhatsAppMessage?: (input: {
    recipientMemberIds: string[];
    message: string;
  }) => Promise<ProactiveWhatsAppSendResult>;
  updateOrganization?: (input: {
    name?: string;
    slug?: string;
    logo?: string;
  }) => Promise<OrganizationSummary["organization"]>;
  inviteOrganizationMember?: (input: {
    email: string;
    role: string;
  }) => Promise<OrganizationInvitation>;
  updateOrganizationMemberRole?: (input: {
    memberId: string;
    role: string;
  }) => Promise<OrganizationMember>;
  removeOrganizationMember?: (input: {
    memberIdOrEmail: string;
  }) => Promise<OrganizationMember>;
  cancelOrganizationInvitation?: (input: {
    invitationId: string;
  }) => Promise<OrganizationInvitation>;
  leaveOrganization?: () => Promise<{ organizationId: string }>;
  requestDeleteOrganizationConfirmation?: () => Promise<{
    pendingActionId: string;
    expiresAt: number;
  }>;
  deleteOrganization?: () => Promise<{ organizationId: string }>;
};

export type CreateUserToolsOptions = {
  getUserSettings: () => Promise<UserSettingsSummary>;
  updateUserSettings?: (input: {
    name?: string;
    image?: string | null;
    language?: LocalePreference;
    theme?: "light" | "dark" | "system";
  }) => Promise<UserSettingsSummary>;
};

const memberTypeSchema = z.union([z.literal("standard"), z.literal("phone_only")]);

const workspaceSnapshotSchema = z.object({
  organizationId: z.string(),
  memberCount: z.number(),
  invitationCount: z.number(),
  members: z.array(
    z.object({
      name: z.string(),
      email: z.union([z.string(), z.null()]),
      phoneNumberE164: z.union([z.string(), z.null()]),
      memberType: memberTypeSchema,
      role: z.string(),
    }),
  ),
  pendingInvitations: z.array(
    z.object({
      email: z.string(),
      role: z.string(),
    }),
  ),
});

const organizationMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.union([z.string(), z.null()]),
  phoneNumberE164: z.union([z.string(), z.null()]),
  memberType: memberTypeSchema,
  canWebSignIn: z.boolean(),
  role: z.string(),
});

const organizationInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
});

const organizationSummarySchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logo: z.union([z.string(), z.null()]),
  }),
  currentMemberRole: z.union([z.string(), z.null()]),
  memberCount: z.number(),
  invitationCount: z.number(),
  permissions: z.object({
    canUpdateOrganization: z.boolean(),
    canInviteMembers: z.boolean(),
    canUpdateMembers: z.boolean(),
    canRemoveMembers: z.boolean(),
    canCancelInvitations: z.boolean(),
    canDeleteOrganization: z.boolean(),
    canLeaveOrganization: z.boolean(),
  }),
  members: z.array(organizationMemberSchema),
  pendingInvitations: z.array(organizationInvitationSchema),
});

const appLocaleSchema = z.enum(SUPPORTED_LOCALES);

const userSettingsSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.union([z.string(), z.null()]),
  }),
  preferences: z.object({
    language: z.union([appLocaleSchema, z.literal("system")]),
    theme: z.union([z.literal("light"), z.literal("dark"), z.literal("system")]),
  }),
});

const connectedWhatsAppRecipientSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.union([z.string(), z.null()]),
  phoneNumberE164: z.string(),
  isCurrentUser: z.boolean(),
  memberType: memberTypeSchema,
  canWebSignIn: z.boolean(),
});

const proactiveWhatsAppSendResultSchema = z.object({
  memberId: z.string(),
  phoneNumberE164: z.string(),
  status: z.union([z.literal("sent"), z.literal("failed")]),
  reason: z.string().optional(),
});

export function createWorkspaceSnapshotTool(
  readWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>,
) {
  return createTool({
    id: "getWorkspaceMembers",
    description:
      "Returns workspace members and pending invitations for the active organization.",
    inputSchema: z.object({}),
    outputSchema: workspaceSnapshotSchema,
    execute: async () => {
      return await readWorkspaceSnapshot();
    },
  });
}

export function createOrchestratorClarificationTool(locale: "en" | "de") {
  return createTool({
    id: "requestClarification",
    description:
      locale === "de"
        ? "Nutze dieses Clarification-Tool, wenn vor einer Delegation wichtige Angaben fehlen. Stelle eine oder mehrere kurze Rückfragen (maximal 3)."
        : "Use this clarification tool when important details are missing before delegation. Ask one or more concise follow-up questions (up to 3).",
    inputSchema: z
      .object({
        question: z.string().min(3).optional(),
        questions: z.array(z.string().min(3)).min(1).max(3).optional(),
        reason: z.string().optional(),
      })
      .superRefine((value, ctx) => {
        const hasSingleQuestion =
          typeof value.question === "string" && value.question.trim().length > 0;
        const hasMultipleQuestions =
          Array.isArray(value.questions) && value.questions.length > 0;

        if (!hasSingleQuestion && !hasMultipleQuestions) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide at least one clarification question.",
            path: ["questions"],
          });
        }
      }),
    outputSchema: z.object({
      status: z.literal("clarification_requested"),
      question: z.union([z.string(), z.null()]),
      questions: z.array(z.string()),
      reason: z.union([z.string(), z.null()]),
    }),
    execute: async (input) => {
      const normalizedQuestions = [
        ...(input.questions ?? []),
        ...(input.question ? [input.question] : []),
      ]
        .map((question) => question.trim())
        .filter((question, index, allQuestions) => {
          return question.length > 0 && allQuestions.indexOf(question) === index;
        })
        .slice(0, 3);

      return {
        status: "clarification_requested" as const,
        question: normalizedQuestions[0] ?? null,
        questions: normalizedQuestions,
        reason: input.reason ?? null,
      };
    },
  });
}

export function createOrganizationTools(options: CreateOrganizationToolsOptions) {
  const tools: Record<string, any> = {
    getOrganizationSummary: createTool({
      id: "getOrganizationSummary",
      description:
        "Returns the active organization details, member/invitation counts, current role, and available permissions.",
      inputSchema: z.object({}),
      outputSchema: organizationSummarySchema,
      execute: async () => {
        return await options.getOrganizationSummary();
      },
    }),
    listOrganizationMembers: createTool({
      id: "listOrganizationMembers",
      description: "Lists all members in the active organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        members: z.array(organizationMemberSchema),
      }),
      execute: async () => {
        return {
          members: await options.listOrganizationMembers(),
        };
      },
    }),
    listOrganizationInvitations: createTool({
      id: "listOrganizationInvitations",
      description:
        "Lists organization invitations. Use status='pending' to only get open invitations.",
      inputSchema: z.object({
        status: z.string().optional(),
      }),
      outputSchema: z.object({
        invitations: z.array(organizationInvitationSchema),
      }),
      execute: async (input) => {
        return {
          invitations: await options.listOrganizationInvitations({
            status: input.status,
          }),
        };
      },
    }),
  };

  if (options.listConnectedWhatsAppNumbers) {
    const listConnectedWhatsAppNumbers = options.listConnectedWhatsAppNumbers;
    tools.listConnectedWhatsAppNumbers = createTool({
      id: "listConnectedWhatsAppNumbers",
      description:
        "Lists all active WhatsApp-connected members in the active organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        count: z.number(),
        recipients: z.array(connectedWhatsAppRecipientSchema),
      }),
      execute: async () => {
        const recipients = await listConnectedWhatsAppNumbers();
        return {
          count: recipients.length,
          recipients,
        };
      },
    });
  }

  if (options.sendProactiveWhatsAppMessage) {
    const sendProactiveWhatsAppMessage = options.sendProactiveWhatsAppMessage;
    tools.sendProactiveWhatsAppMessage = createTool({
      id: "sendProactiveWhatsAppMessage",
      description:
        "Sends a proactive WhatsApp message to one or more connected members in the active organization.",
      inputSchema: z.object({
        recipientMemberIds: z.array(z.string()).min(1).max(20),
        message: z.string().min(1).max(6000),
      }),
      outputSchema: z.object({
        status: z.literal("sent"),
        requestedRecipientCount: z.number(),
        sentCount: z.number(),
        failedCount: z.number(),
        results: z.array(proactiveWhatsAppSendResultSchema),
      }),
      execute: async (input) => {
        const result = await sendProactiveWhatsAppMessage(input);
        return {
          status: "sent" as const,
          ...result,
        };
      },
    });
  }

  if (options.updateOrganization) {
    const updateOrganization = options.updateOrganization;
    tools.updateOrganizationData = createTool({
      id: "updateOrganizationData",
      description:
        "Updates the active organization. Provide only fields you want to change.",
      inputSchema: z.object({
        name: z.string().optional(),
        slug: z.string().optional(),
        logo: z.string().optional(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        organization: organizationSummarySchema.shape.organization,
      }),
      execute: async (input) => {
        return {
          status: "updated" as const,
          organization: await updateOrganization(input),
        };
      },
    });
  }

  if (options.inviteOrganizationMember) {
    const inviteOrganizationMember = options.inviteOrganizationMember;
    tools.inviteOrganizationMember = createTool({
      id: "inviteOrganizationMember",
      description: "Invites a new member to the active organization.",
      inputSchema: z.object({
        email: z.string().email(),
        role: z.string().default("member"),
      }),
      outputSchema: z.object({
        status: z.literal("invited"),
        invitation: organizationInvitationSchema,
      }),
      execute: async (input) => {
        const invitationInput = {
          email: input.email,
          role: input.role ?? "member",
        };

        return {
          status: "invited" as const,
          invitation: await inviteOrganizationMember(invitationInput),
        };
      },
    });
  }

  if (options.updateOrganizationMemberRole) {
    const updateOrganizationMemberRole = options.updateOrganizationMemberRole;
    tools.updateOrganizationMemberRole = createTool({
      id: "updateOrganizationMemberRole",
      description: "Changes a member role in the active organization.",
      inputSchema: z.object({
        memberId: z.string(),
        role: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        member: organizationMemberSchema,
      }),
      execute: async (input) => {
        return {
          status: "updated" as const,
          member: await updateOrganizationMemberRole(input),
        };
      },
    });
  }

  if (options.removeOrganizationMember) {
    const removeOrganizationMember = options.removeOrganizationMember;
    tools.removeOrganizationMember = createTool({
      id: "removeOrganizationMember",
      description:
        "Removes a member from the active organization by member ID or email.",
      inputSchema: z.object({
        memberIdOrEmail: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("removed"),
        member: organizationMemberSchema,
      }),
      execute: async (input) => {
        return {
          status: "removed" as const,
          member: await removeOrganizationMember(input),
        };
      },
    });
  }

  if (options.cancelOrganizationInvitation) {
    const cancelOrganizationInvitation = options.cancelOrganizationInvitation;
    tools.cancelOrganizationInvitation = createTool({
      id: "cancelOrganizationInvitation",
      description: "Cancels a pending invitation in the active organization.",
      inputSchema: z.object({
        invitationId: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("canceled"),
        invitation: organizationInvitationSchema,
      }),
      execute: async (input) => {
        return {
          status: "canceled" as const,
          invitation: await cancelOrganizationInvitation(input),
        };
      },
    });
  }

  if (options.leaveOrganization) {
    const leaveOrganization = options.leaveOrganization;
    tools.leaveOrganization = createTool({
      id: "leaveOrganization",
      description: "Leaves the active organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.literal("left"),
        organizationId: z.string(),
      }),
      execute: async () => {
        const result = await leaveOrganization();
        return {
          status: "left" as const,
          organizationId: result.organizationId,
        };
      },
    });
  }

  if (options.requestDeleteOrganizationConfirmation && options.deleteOrganization) {
    const requestDeleteOrganizationConfirmation =
      options.requestDeleteOrganizationConfirmation;
    const deleteOrganization = options.deleteOrganization;
    tools.deleteOrganization = createTool({
      id: "deleteOrganization",
      description:
        "Deletes the active organization. Requires an explicit confirm=true to execute.",
      inputSchema: z.object({
        confirm: z.boolean().optional().default(false),
      }),
      outputSchema: z.union([
        z.object({
          status: z.literal("requires_confirmation"),
          actionType: z.literal("delete-organization"),
          pendingActionId: z.string(),
          expiresAt: z.number(),
        }),
        z.object({
          status: z.literal("deleted"),
          organizationId: z.string(),
        }),
      ]),
      execute: async (input) => {
        if (!input.confirm) {
          const pending = await requestDeleteOrganizationConfirmation();
          return {
            status: "requires_confirmation" as const,
            actionType: "delete-organization" as const,
            pendingActionId: pending.pendingActionId,
            expiresAt: pending.expiresAt,
          };
        }

        const deleted = await deleteOrganization();
        return {
          status: "deleted" as const,
          organizationId: deleted.organizationId,
        };
      },
    });
  }

  return tools;
}

export type OrganizationSettingsSummary = {
  organizationId: string;
  companyEmail: string | null;
  companyEmailLocale: LocalePreference;
};

export type OrganizationAgentProfileSummary = {
  organizationId: string;
  name: string;
  styleId: "woman" | "man";
};

export type WhatsAppSetupSummary = {
  phoneNumberE164: string | null;
  initialMessage: string;
  waLink: string | null;
};

export type MyWhatsAppConnectionSummary = {
  memberId: string;
  role: string;
  phoneNumberE164: string | null;
};

export type CustomerSummary = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  activeProjectCount: number;
  doneProjectCount: number;
  createdAt: number;
  updatedAt: number;
};

export type ArchivedCustomerSummary = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  deletedAt: number;
  linkedProjectCount: number;
};

export type ProjectSummary = {
  id: string;
  location: string;
  status: "active" | "done";
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  hasNachtrag: boolean;
  hasUnreviewedChanges: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ArchivedProjectSummary = {
  id: string;
  location: string;
  status: "active" | "done";
  customerName: string | null;
  deletedAt: number;
};

export type ProjectTimelineBatchSummary = {
  batchId: string;
  title: string;
  overview: string | null;
  summary: string | null;
  addedAt: number;
  memberName: string;
  hasNachtrag: boolean;
  nachtragNeedsClarification: boolean;
  recipientEmail: string | null;
  subject: string;
  body: string;
  imageMediaAssetIds: string[];
  videoMediaAssetIds: string[];
};

export type DocumentationOverviewSearchHit = {
  batchId: string;
  projectId: string;
  projectLocation: string;
  customerName: string | null;
  title: string;
  summary: string | null;
  overview: string;
  hasNachtrag: boolean;
  addedAt: number;
  score: number;
};

export type DocumentationOverviewSearchResult = {
  searchMode: "semantic" | "text";
  hits: DocumentationOverviewSearchHit[];
};

export type PreparedExport = {
  status: "export_ready";
  exportMode: "customers" | "projects";
  manifest: unknown;
};

type PendingActionRequest = {
  pendingActionId: string;
  expiresAt: number;
};

export type CreateOrganizationAdminToolsOptions = {
  getOrganizationSummary: () => Promise<OrganizationSummary>;
  listOrganizationMembers: () => Promise<OrganizationMember[]>;
  listOrganizationInvitations: (input?: { status?: string }) => Promise<
    OrganizationInvitation[]
  >;
  listConnectedWhatsAppNumbers?: () => Promise<ConnectedWhatsAppRecipient[]>;
  updateOrganization?: (input: {
    name?: string;
    logo?: string;
  }) => Promise<OrganizationSummary["organization"]>;
  getOrganizationSettings?: () => Promise<OrganizationSettingsSummary>;
  updateOrganizationSettings?: (input: {
    companyEmail?: string | null;
    companyEmailLocale?: LocalePreference;
  }) => Promise<OrganizationSettingsSummary>;
  getOrganizationAgentProfile?: () => Promise<OrganizationAgentProfileSummary | null>;
  updateOrganizationAgentProfile?: (input: {
    name: string;
    styleId: "woman" | "man";
  }) => Promise<OrganizationAgentProfileSummary>;
  inviteOrganizationMember?: (input: {
    email: string;
    role: string;
  }) => Promise<OrganizationInvitation>;
  updateOrganizationMemberRole?: (input: {
    memberId: string;
    role: string;
  }) => Promise<OrganizationMember>;
  createPhoneOnlyMember?: (input: {
    name: string;
    phoneNumber: string;
  }) => Promise<OrganizationMember>;
  setMemberWhatsAppConnection?: (input: {
    memberId: string;
    phoneNumber: string;
  }) => Promise<ConnectedWhatsAppRecipient>;
  requestRemoveOrganizationMember?: (input: {
    memberIdOrEmail: string;
  }) => Promise<PendingActionRequest>;
  requestCancelOrganizationInvitation?: (input: {
    invitationId: string;
  }) => Promise<PendingActionRequest>;
  requestRemoveMemberWhatsAppConnection?: (input: {
    memberId: string;
  }) => Promise<PendingActionRequest>;
  requestSendMemberWhatsAppGuideEmail?: (input: {
    memberId: string;
  }) => Promise<PendingActionRequest>;
  requestSendProactiveWhatsAppMessage?: (input: {
    recipientMemberIds: string[];
    message: string;
  }) => Promise<PendingActionRequest>;
  requestLeaveOrganization?: () => Promise<PendingActionRequest>;
  requestDeleteOrganization?: () => Promise<PendingActionRequest>;
};

export type CreateCustomerToolsOptions = {
  listCustomers: () => Promise<CustomerSummary[]>;
  getCustomer: (input: { customerId: string }) => Promise<CustomerSummary | null>;
  createCustomer?: (input: {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
  }) => Promise<CustomerSummary>;
  updateCustomer?: (input: {
    customerId: string;
    name?: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) => Promise<CustomerSummary>;
  listArchivedCustomers?: () => Promise<ArchivedCustomerSummary[]>;
  restoreCustomer?: (input: { customerId: string }) => Promise<CustomerSummary>;
  requestArchiveCustomer?: (input: {
    customerId: string;
  }) => Promise<PendingActionRequest>;
};

export type CreateProjectToolsOptions = {
  listProjects: (input?: {
    statuses?: Array<"active" | "done">;
    customerId?: string;
  }) => Promise<ProjectSummary[]>;
  getProject: (input: { projectId: string }) => Promise<ProjectSummary | null>;
  createProject?: (input: {
    location: string;
    customerId?: string;
  }) => Promise<ProjectSummary>;
  updateProject?: (input: {
    projectId: string;
    location?: string;
    customerId?: string | null;
    status?: "active" | "done";
  }) => Promise<ProjectSummary>;
  listArchivedProjects?: () => Promise<ArchivedProjectSummary[]>;
  restoreProject?: (input: { projectId: string }) => Promise<ProjectSummary>;
  getProjectTimelineBatches?: (input: {
    projectId: string;
  }) => Promise<ProjectTimelineBatchSummary[]>;
  searchProjectDocumentationOverviews?: (input: {
    query: string;
    projectId?: string;
    limit?: number;
  }) => Promise<DocumentationOverviewSearchResult>;
  reassignProjectBatch?: (input: {
    batchId: string;
    targetProjectId: string;
  }) => Promise<{
    batchId: string;
    targetProjectId: string;
  }>;
  prepareProjectExport?: (input: { projectId: string }) => Promise<PreparedExport>;
  prepareCustomerExport?: (input: { customerId: string }) => Promise<PreparedExport>;
  requestArchiveProject?: (input: {
    projectId: string;
  }) => Promise<PendingActionRequest>;
  requestSendProjectBatchEmail?: (input: {
    projectId: string;
    batchId: string;
    subject?: string;
    body?: string;
    imageMediaAssetIds?: string[];
    videoMediaAssetIds?: string[];
  }) => Promise<PendingActionRequest>;
};

export type CreateUserAccountToolsOptions = CreateUserToolsOptions & {
  getWhatsAppSetupInfo?: () => Promise<WhatsAppSetupSummary>;
  getMyWhatsAppConnection?: () => Promise<MyWhatsAppConnectionSummary | null>;
};

const organizationSettingsSchema = z.object({
  organizationId: z.string(),
  companyEmail: z.union([z.string(), z.null()]),
  companyEmailLocale: z.union([appLocaleSchema, z.literal("system")]),
});

const organizationAgentProfileSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  styleId: z.union([z.literal("woman"), z.literal("man")]),
});

const whatsappSetupSchema = z.object({
  phoneNumberE164: z.union([z.string(), z.null()]),
  initialMessage: z.string(),
  waLink: z.union([z.string(), z.null()]),
});

const myWhatsAppConnectionSchema = z.object({
  memberId: z.string(),
  role: z.string(),
  phoneNumberE164: z.union([z.string(), z.null()]),
});

const customerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  contactName: z.union([z.string(), z.null()]),
  email: z.union([z.string(), z.null()]),
  phone: z.union([z.string(), z.null()]),
  activeProjectCount: z.number(),
  doneProjectCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const archivedCustomerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  contactName: z.union([z.string(), z.null()]),
  email: z.union([z.string(), z.null()]),
  phone: z.union([z.string(), z.null()]),
  deletedAt: z.number(),
  linkedProjectCount: z.number(),
});

const projectSummarySchema = z.object({
  id: z.string(),
  location: z.string(),
  status: z.union([z.literal("active"), z.literal("done")]),
  customerId: z.union([z.string(), z.null()]),
  customerName: z.union([z.string(), z.null()]),
  customerEmail: z.union([z.string(), z.null()]),
  hasNachtrag: z.boolean(),
  hasUnreviewedChanges: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const archivedProjectSummarySchema = z.object({
  id: z.string(),
  location: z.string(),
  status: z.union([z.literal("active"), z.literal("done")]),
  customerName: z.union([z.string(), z.null()]),
  deletedAt: z.number(),
});

const projectTimelineBatchSummarySchema = z.object({
  batchId: z.string(),
  title: z.string(),
  overview: z.union([z.string(), z.null()]),
  summary: z.union([z.string(), z.null()]),
  addedAt: z.number(),
  memberName: z.string(),
  hasNachtrag: z.boolean(),
  nachtragNeedsClarification: z.boolean(),
  recipientEmail: z.union([z.string(), z.null()]),
  subject: z.string(),
  body: z.string(),
  imageMediaAssetIds: z.array(z.string()),
  videoMediaAssetIds: z.array(z.string()),
});

const documentationOverviewSearchHitSchema = z.object({
  batchId: z.string(),
  projectId: z.string(),
  projectLocation: z.string(),
  customerName: z.union([z.string(), z.null()]),
  title: z.string(),
  summary: z.union([z.string(), z.null()]),
  overview: z.string(),
  hasNachtrag: z.boolean(),
  addedAt: z.number(),
  score: z.number(),
});

const documentationOverviewSearchResultSchema = z.object({
  searchMode: z.union([z.literal("semantic"), z.literal("text")]),
  hits: z.array(documentationOverviewSearchHitSchema),
});

const preparedExportSchema = z.object({
  status: z.literal("export_ready"),
  exportMode: z.union([z.literal("customers"), z.literal("projects")]),
  manifest: z.unknown(),
});

const confirmationRequiredSchema = z.object({
  status: z.literal("requires_confirmation"),
  actionType: z.string(),
  pendingActionId: z.string(),
  expiresAt: z.number(),
});

function createConfirmationTool<InputSchema extends z.ZodTypeAny>(options: {
  id: string;
  description: string;
  inputSchema: InputSchema;
  actionType: PendingActionType;
  requestConfirmation: (
    input: z.output<InputSchema>,
  ) => Promise<PendingActionRequest>;
}) {
  return createTool({
    id: options.id,
    description: options.description,
    inputSchema: options.inputSchema,
    outputSchema: confirmationRequiredSchema,
    execute: async (input) => {
      const pending = await options.requestConfirmation(input as z.output<InputSchema>);
      return createPendingActionToolResult({
        actionType: options.actionType,
        pendingActionId: pending.pendingActionId,
        expiresAt: pending.expiresAt,
      });
    },
  });
}

export function createOrganizationAdminTools(
  options: CreateOrganizationAdminToolsOptions,
) {
  const tools: Record<string, any> = {
    getOrganizationSummary: createTool({
      id: "getOrganizationSummary",
      description:
        "Returns the active organization details, member/invitation counts, current role, and available permissions.",
      inputSchema: z.object({}),
      outputSchema: organizationSummarySchema,
      execute: async () => {
        return await options.getOrganizationSummary();
      },
    }),
    listOrganizationMembers: createTool({
      id: "listOrganizationMembers",
      description: "Lists all members in the active organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        members: z.array(organizationMemberSchema),
      }),
      execute: async () => ({
        members: await options.listOrganizationMembers(),
      }),
    }),
    listOrganizationInvitations: createTool({
      id: "listOrganizationInvitations",
      description:
        "Lists organization invitations. Use status='pending' to only get open invitations.",
      inputSchema: z.object({
        status: z.string().optional(),
      }),
      outputSchema: z.object({
        invitations: z.array(organizationInvitationSchema),
      }),
      execute: async (input) => ({
        invitations: await options.listOrganizationInvitations({
          status: input.status,
        }),
      }),
    }),
  };

  if (options.listConnectedWhatsAppNumbers) {
    tools.listConnectedWhatsAppNumbers = createTool({
      id: "listConnectedWhatsAppNumbers",
      description:
        "Lists all active WhatsApp-connected members in the active organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        count: z.number(),
        recipients: z.array(connectedWhatsAppRecipientSchema),
      }),
      execute: async () => {
        const recipients = await options.listConnectedWhatsAppNumbers!();
        return {
          count: recipients.length,
          recipients,
        };
      },
    });
  }

  if (options.updateOrganization) {
    tools.updateOrganizationData = createTool({
      id: "updateOrganizationData",
      description:
        "Updates the active organization name or logo. Provide only fields you want to change.",
      inputSchema: z.object({
        name: z.string().optional(),
        logo: z.string().optional(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        organization: organizationSummarySchema.shape.organization,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        organization: await options.updateOrganization!(input),
      }),
    });
  }

  if (options.getOrganizationSettings) {
    tools.getOrganizationSettings = createTool({
      id: "getOrganizationSettings",
      description:
        "Returns active organization settings such as company email and company email locale.",
      inputSchema: z.object({}),
      outputSchema: organizationSettingsSchema,
      execute: async () => {
        return await options.getOrganizationSettings!();
      },
    });
  }

  if (options.updateOrganizationSettings) {
    tools.updateOrganizationSettings = createTool({
      id: "updateOrganizationSettings",
      description:
        "Updates active organization settings such as company email and company email locale.",
      inputSchema: z.object({
        companyEmail: z.union([z.string(), z.null()]).optional(),
        companyEmailLocale: z
          .union([z.literal("en"), z.literal("de"), z.literal("system")])
          .optional(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        settings: organizationSettingsSchema,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        settings: await options.updateOrganizationSettings!(input),
      }),
    });
  }

  if (options.getOrganizationAgentProfile) {
    tools.getOrganizationAgentProfile = createTool({
      id: "getOrganizationAgentProfile",
      description:
        "Returns the active organization AI agent profile, including name and style.",
      inputSchema: z.object({}),
      outputSchema: z.union([organizationAgentProfileSchema, z.null()]),
      execute: async () => {
        return await options.getOrganizationAgentProfile!();
      },
    });
  }

  if (options.updateOrganizationAgentProfile) {
    tools.updateOrganizationAgentProfile = createTool({
      id: "updateOrganizationAgentProfile",
      description:
        "Updates the active organization AI agent profile, including name and style.",
      inputSchema: z.object({
        name: z.string(),
        styleId: z.union([z.literal("woman"), z.literal("man")]),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        profile: organizationAgentProfileSchema,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        profile: await options.updateOrganizationAgentProfile!({
          name: input.name,
          styleId: input.styleId,
        }),
      }),
    });
  }

  if (options.inviteOrganizationMember) {
    tools.inviteOrganizationMember = createTool({
      id: "inviteOrganizationMember",
      description: "Invites a new member to the active organization.",
      inputSchema: z.object({
        email: z.string().email(),
        role: z.string().default("member"),
      }),
      outputSchema: z.object({
        status: z.literal("invited"),
        invitation: organizationInvitationSchema,
      }),
      execute: async (input) => {
        const invitationInput = {
          email: input.email,
          role: input.role ?? "member",
        };

        return {
          status: "invited" as const,
          invitation: await options.inviteOrganizationMember!(invitationInput),
        };
      },
    });
  }

  if (options.updateOrganizationMemberRole) {
    tools.updateOrganizationMemberRole = createTool({
      id: "updateOrganizationMemberRole",
      description: "Changes a member role in the active organization.",
      inputSchema: z.object({
        memberId: z.string(),
        role: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        member: organizationMemberSchema,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        member: await options.updateOrganizationMemberRole!(input),
      }),
    });
  }

  if (options.createPhoneOnlyMember) {
    tools.createPhoneOnlyMember = createTool({
      id: "createPhoneOnlyMember",
      description:
        "Creates a phone-only member in the active organization and connects a WhatsApp phone number.",
      inputSchema: z.object({
        name: z.string(),
        phoneNumber: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("created"),
        member: organizationMemberSchema,
      }),
      execute: async (input) => ({
        status: "created" as const,
        member: await options.createPhoneOnlyMember!(input),
      }),
    });
  }

  if (options.setMemberWhatsAppConnection) {
    tools.setMemberWhatsAppConnection = createTool({
      id: "setMemberWhatsAppConnection",
      description:
        "Creates or updates a member WhatsApp connection in the active organization.",
      inputSchema: z.object({
        memberId: z.string(),
        phoneNumber: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        recipient: connectedWhatsAppRecipientSchema,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        recipient: await options.setMemberWhatsAppConnection!(input),
      }),
    });
  }

  if (options.requestRemoveOrganizationMember) {
    tools.removeOrganizationMember = createConfirmationTool({
      id: "removeOrganizationMember",
      description:
        "Removes a member from the active organization by member ID or email. This requires confirmation.",
      inputSchema: z.object({
        memberIdOrEmail: z.string(),
      }),
      actionType: "remove-member",
      requestConfirmation: options.requestRemoveOrganizationMember,
    });
  }

  if (options.requestCancelOrganizationInvitation) {
    tools.cancelOrganizationInvitation = createConfirmationTool({
      id: "cancelOrganizationInvitation",
      description:
        "Cancels a pending invitation in the active organization. This requires confirmation.",
      inputSchema: z.object({
        invitationId: z.string(),
      }),
      actionType: "cancel-invitation",
      requestConfirmation: options.requestCancelOrganizationInvitation,
    });
  }

  if (options.requestRemoveMemberWhatsAppConnection) {
    tools.removeMemberWhatsAppConnection = createConfirmationTool({
      id: "removeMemberWhatsAppConnection",
      description:
        "Removes a member WhatsApp connection in the active organization. This requires confirmation.",
      inputSchema: z.object({
        memberId: z.string(),
      }),
      actionType: "remove-member-whatsapp-connection",
      requestConfirmation: options.requestRemoveMemberWhatsAppConnection,
    });
  }

  if (options.requestSendMemberWhatsAppGuideEmail) {
    tools.sendMemberWhatsAppGuideEmail = createConfirmationTool({
      id: "sendMemberWhatsAppGuideEmail",
      description:
        "Sends the WhatsApp activation guide email to a member. This requires confirmation.",
      inputSchema: z.object({
        memberId: z.string(),
      }),
      actionType: "send-member-whatsapp-guide-email",
      requestConfirmation: options.requestSendMemberWhatsAppGuideEmail,
    });
  }

  if (options.requestSendProactiveWhatsAppMessage) {
    tools.sendProactiveWhatsAppMessage = createConfirmationTool({
      id: "sendProactiveWhatsAppMessage",
      description:
        "Sends a proactive WhatsApp message to one or more connected members. This requires confirmation.",
      inputSchema: z.object({
        recipientMemberIds: z.array(z.string()).min(1).max(20),
        message: z.string().min(1).max(6000),
      }),
      actionType: "send-proactive-whatsapp-message",
      requestConfirmation: options.requestSendProactiveWhatsAppMessage,
    });
  }

  if (options.requestLeaveOrganization) {
    tools.leaveOrganization = createConfirmationTool({
      id: "leaveOrganization",
      description: "Leaves the active organization. This requires confirmation.",
      inputSchema: z.object({}),
      actionType: "leave-organization",
      requestConfirmation: options.requestLeaveOrganization,
    });
  }

  if (options.requestDeleteOrganization) {
    tools.deleteOrganization = createConfirmationTool({
      id: "deleteOrganization",
      description: "Deletes the active organization. This requires confirmation.",
      inputSchema: z.object({}),
      actionType: "delete-organization",
      requestConfirmation: options.requestDeleteOrganization,
    });
  }

  return tools;
}

export function createCustomerTools(options: CreateCustomerToolsOptions) {
  const tools: Record<string, any> = {
    listCustomers: createTool({
      id: "listCustomers",
      description: "Lists active customers in the current organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        customers: z.array(customerSummarySchema),
      }),
      execute: async () => ({
        customers: await options.listCustomers(),
      }),
    }),
    getCustomer: createTool({
      id: "getCustomer",
      description: "Returns a single customer by id.",
      inputSchema: z.object({
        customerId: z.string(),
      }),
      outputSchema: z.union([customerSummarySchema, z.null()]),
      execute: async (input) => {
        return await options.getCustomer(input);
      },
    }),
  };

  if (options.createCustomer) {
    tools.createCustomer = createTool({
      id: "createCustomer",
      description: "Creates a customer in the current organization.",
      inputSchema: z.object({
        name: z.string(),
        contactName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      }),
      outputSchema: z.object({
        status: z.literal("created"),
        customer: customerSummarySchema,
      }),
      execute: async (input) => ({
        status: "created" as const,
        customer: await options.createCustomer!(input),
      }),
    });
  }

  if (options.updateCustomer) {
    tools.updateCustomer = createTool({
      id: "updateCustomer",
      description:
        "Updates customer fields. Provide only the fields that should change.",
      inputSchema: z.object({
        customerId: z.string(),
        name: z.string().optional(),
        contactName: z.union([z.string(), z.null()]).optional(),
        email: z.union([z.string(), z.null()]).optional(),
        phone: z.union([z.string(), z.null()]).optional(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        customer: customerSummarySchema,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        customer: await options.updateCustomer!(input),
      }),
    });
  }

  if (options.listArchivedCustomers) {
    tools.listArchivedCustomers = createTool({
      id: "listArchivedCustomers",
      description: "Lists archived customers in the current organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        customers: z.array(archivedCustomerSummarySchema),
      }),
      execute: async () => ({
        customers: await options.listArchivedCustomers!(),
      }),
    });
  }

  if (options.restoreCustomer) {
    tools.restoreCustomer = createTool({
      id: "restoreCustomer",
      description: "Restores an archived customer.",
      inputSchema: z.object({
        customerId: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("restored"),
        customer: customerSummarySchema,
      }),
      execute: async (input) => ({
        status: "restored" as const,
        customer: await options.restoreCustomer!(input),
      }),
    });
  }

  if (options.requestArchiveCustomer) {
    tools.archiveCustomer = createConfirmationTool({
      id: "archiveCustomer",
      description:
        "Archives a customer and linked projects. This requires confirmation.",
      inputSchema: z.object({
        customerId: z.string(),
      }),
      actionType: "archive-customer",
      requestConfirmation: options.requestArchiveCustomer,
    });
  }

  return tools;
}

export function createProjectTools(options: CreateProjectToolsOptions) {
  const tools: Record<string, any> = {
    listProjects: createTool({
      id: "listProjects",
      description:
        "Lists active projects in the current organization, optionally filtered by status or customer.",
      inputSchema: z.object({
        statuses: z
          .array(z.union([z.literal("active"), z.literal("done")]))
          .optional(),
        customerId: z.string().optional(),
      }),
      outputSchema: z.object({
        projects: z.array(projectSummarySchema),
      }),
      execute: async (input) => ({
        projects: await options.listProjects(input),
      }),
    }),
    getProject: createTool({
      id: "getProject",
      description: "Returns a single project by id.",
      inputSchema: z.object({
        projectId: z.string(),
      }),
      outputSchema: z.union([projectSummarySchema, z.null()]),
      execute: async (input) => {
        return await options.getProject(input);
      },
    }),
  };

  if (options.createProject) {
    tools.createProject = createTool({
      id: "createProject",
      description: "Creates a project in the current organization.",
      inputSchema: z.object({
        location: z.string(),
        customerId: z.string().optional(),
      }),
      outputSchema: z.object({
        status: z.literal("created"),
        project: projectSummarySchema,
      }),
      execute: async (input) => ({
        status: "created" as const,
        project: await options.createProject!(input),
      }),
    });
  }

  if (options.updateProject) {
    tools.updateProject = createTool({
      id: "updateProject",
      description:
        "Updates project fields. Provide only the fields that should change.",
      inputSchema: z.object({
        projectId: z.string(),
        location: z.string().optional(),
        customerId: z.union([z.string(), z.null()]).optional(),
        status: z.union([z.literal("active"), z.literal("done")]).optional(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        project: projectSummarySchema,
      }),
      execute: async (input) => ({
        status: "updated" as const,
        project: await options.updateProject!(input),
      }),
    });
  }

  if (options.listArchivedProjects) {
    tools.listArchivedProjects = createTool({
      id: "listArchivedProjects",
      description: "Lists archived projects in the current organization.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        projects: z.array(archivedProjectSummarySchema),
      }),
      execute: async () => ({
        projects: await options.listArchivedProjects!(),
      }),
    });
  }

  if (options.restoreProject) {
    tools.restoreProject = createTool({
      id: "restoreProject",
      description: "Restores an archived project.",
      inputSchema: z.object({
        projectId: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("restored"),
        project: projectSummarySchema,
      }),
      execute: async (input) => ({
        status: "restored" as const,
        project: await options.restoreProject!(input),
      }),
    });
  }

  if (options.getProjectTimelineBatches) {
    tools.getProjectTimelineBatches = createTool({
      id: "getProjectTimelineBatches",
      description:
        "Returns summarized timeline batches for a project, including default email content and attachment selections.",
      inputSchema: z.object({
        projectId: z.string(),
      }),
      outputSchema: z.object({
        batches: z.array(projectTimelineBatchSummarySchema),
      }),
      execute: async (input) => ({
        batches: await options.getProjectTimelineBatches!(input),
      }),
    });
  }

  if (options.searchProjectDocumentationOverviews) {
    tools.searchProjectDocumentationOverviews = createTool({
      id: "searchProjectDocumentationOverviews",
      description:
        "Searches project documentation overviews across timeline batches in the current organization. Use this for historical progress, issues, materials, or next-step questions.",
      inputSchema: z.object({
        query: z.string().min(2).max(300),
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      outputSchema: documentationOverviewSearchResultSchema,
      execute: async (input) => {
        return await options.searchProjectDocumentationOverviews!(input);
      },
    });
  }

  if (options.reassignProjectBatch) {
    tools.reassignProjectBatch = createTool({
      id: "reassignProjectBatch",
      description:
        "Moves a WhatsApp timeline batch from one project to another active project.",
      inputSchema: z.object({
        batchId: z.string(),
        targetProjectId: z.string(),
      }),
      outputSchema: z.object({
        status: z.literal("reassigned"),
        batchId: z.string(),
        targetProjectId: z.string(),
      }),
      execute: async (input) => ({
        status: "reassigned" as const,
        ...(await options.reassignProjectBatch!(input)),
      }),
    });
  }

  if (options.prepareProjectExport) {
    tools.prepareProjectExport = createTool({
      id: "prepareProjectExport",
      description:
        "Prepares a project export manifest for download in the web workspace.",
      inputSchema: z.object({
        projectId: z.string(),
      }),
      outputSchema: preparedExportSchema,
      execute: async (input) => {
        return await options.prepareProjectExport!(input);
      },
    });
  }

  if (options.prepareCustomerExport) {
    tools.prepareCustomerExport = createTool({
      id: "prepareCustomerExport",
      description:
        "Prepares a customer export manifest for download in the web workspace.",
      inputSchema: z.object({
        customerId: z.string(),
      }),
      outputSchema: preparedExportSchema,
      execute: async (input) => {
        return await options.prepareCustomerExport!(input);
      },
    });
  }

  if (options.requestArchiveProject) {
    tools.archiveProject = createConfirmationTool({
      id: "archiveProject",
      description: "Archives a project. This requires confirmation.",
      inputSchema: z.object({
        projectId: z.string(),
      }),
      actionType: "archive-project",
      requestConfirmation: options.requestArchiveProject,
    });
  }

  if (options.requestSendProjectBatchEmail) {
    tools.sendProjectBatchEmail = createConfirmationTool({
      id: "sendProjectBatchEmail",
      description:
        "Sends a project timeline batch email to the linked customer. This requires confirmation.",
      inputSchema: z.object({
        projectId: z.string(),
        batchId: z.string(),
        subject: z.string().optional(),
        body: z.string().optional(),
        imageMediaAssetIds: z.array(z.string()).optional(),
        videoMediaAssetIds: z.array(z.string()).optional(),
      }),
      actionType: "send-project-batch-email",
      requestConfirmation: options.requestSendProjectBatchEmail,
    });
  }

  return tools;
}

export function createUserAccountTools(options: CreateUserAccountToolsOptions) {
  const tools = createUserTools(options);

  if (options.getWhatsAppSetupInfo) {
    tools.getWhatsAppSetupInfo = createTool({
      id: "getWhatsAppSetupInfo",
      description:
        "Returns the current WhatsApp agent phone number, initial message, and wa.me link.",
      inputSchema: z.object({}),
      outputSchema: whatsappSetupSchema,
      execute: async () => {
        return await options.getWhatsAppSetupInfo!();
      },
    });
  }

  if (options.getMyWhatsAppConnection) {
    tools.getMyWhatsAppConnection = createTool({
      id: "getMyWhatsAppConnection",
      description:
        "Returns the current user's WhatsApp connection status in the active organization.",
      inputSchema: z.object({}),
      outputSchema: z.union([myWhatsAppConnectionSchema, z.null()]),
      execute: async () => {
        return await options.getMyWhatsAppConnection!();
      },
    });
  }

  return tools;
}

export function createUserTools(options: CreateUserToolsOptions) {
  const tools: Record<string, any> = {
    getUserSettings: createTool({
      id: "getUserSettings",
      description:
        "Returns the current user profile and personal preferences (language and theme).",
      inputSchema: z.object({}),
      outputSchema: userSettingsSchema,
      execute: async () => {
        return await options.getUserSettings();
      },
    }),
  };

  if (options.updateUserSettings) {
    const updateUserSettings = options.updateUserSettings;
    tools.updateUserSettings = createTool({
      id: "updateUserSettings",
      description:
        "Updates personal user settings. Provide only fields you want to change.",
      inputSchema: z.object({
        name: z.string().optional(),
        image: z.union([z.string(), z.null()]).optional(),
        language: z
          .union([z.literal("en"), z.literal("de"), z.literal("system")])
          .optional(),
        theme: z
          .union([z.literal("light"), z.literal("dark"), z.literal("system")])
          .optional(),
      }),
      outputSchema: z.object({
        status: z.literal("updated"),
        settings: userSettingsSchema,
      }),
      execute: async (input) => {
        return {
          status: "updated" as const,
          settings: await updateUserSettings(input),
        };
      },
    });
  }

  return tools;
}
