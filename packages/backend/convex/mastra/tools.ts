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

export type CreateOrganizationToolsOptions = {
  getOrganizationSummary: () => Promise<OrganizationSummary>;
  listOrganizationMembers: () => Promise<OrganizationMember[]>;
  listOrganizationInvitations: (input?: { status?: string }) => Promise<
    OrganizationInvitation[]
  >;
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
