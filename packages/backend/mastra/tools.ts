'use node';

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export type WorkspaceSnapshot = {
  organizationId: string;
  memberCount: number;
  invitationCount: number;
  members: Array<{
    name: string;
    email: string;
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
  email: string;
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
    language: "en" | "de" | "system";
    theme: "light" | "dark" | "system";
  };
};

export type ConnectedWhatsAppRecipient = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  phoneNumberE164: string;
  isCurrentUser: boolean;
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
    language?: "en" | "de" | "system";
    theme?: "light" | "dark" | "system";
  }) => Promise<UserSettingsSummary>;
};

const workspaceSnapshotSchema = z.object({
  organizationId: z.string(),
  memberCount: z.number(),
  invitationCount: z.number(),
  members: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
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
  email: z.string(),
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

const userSettingsSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.union([z.string(), z.null()]),
  }),
  preferences: z.object({
    language: z.union([z.literal("en"), z.literal("de"), z.literal("system")]),
    theme: z.union([z.literal("light"), z.literal("dark"), z.literal("system")]),
  }),
});

const connectedWhatsAppRecipientSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  phoneNumberE164: z.string(),
  isCurrentUser: z.boolean(),
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
        return {
          status: "invited" as const,
          invitation: await inviteOrganizationMember(input),
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
