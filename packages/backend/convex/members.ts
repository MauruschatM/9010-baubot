import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { action, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  buildPhoneOnlyMemberEmail,
  MEMBER_TYPE_PHONE_ONLY,
} from "./memberProfiles";
import {
  deleteSessionsForUser,
  ensureServiceSessionForUser,
} from "./serviceSessions";
import { normalizePhoneNumber } from "./whatsapp/normalize";

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

type InvitationDoc = {
  _id: string;
  organizationId: string;
  email: string;
  role?: string | null;
  status: string;
  expiresAt: number;
  createdAt: number;
  inviterId: string;
};

const PAGE_SIZE = 500;
const PHONE_ONLY_NAME_MIN_LENGTH = 2;

async function getCurrentOrganizationMember(ctx: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, args: {
  organizationId: string;
  userId: string;
}) {
  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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
        value: args.userId,
      },
    ],
  })) as MemberDoc | null;
}

async function createHiddenUser(ctx: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  runMutation: (
    mutationRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, args: {
  displayName: string;
}) {
  const now = Date.now();
  const email = buildPhoneOnlyMemberEmail();
  await ctx.runMutation(components.betterAuth.adapter.create as never, {
    input: {
      model: "user",
      data: {
        name: args.displayName,
        email,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    },
  } as never);

  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [
      {
        field: "email",
        operator: "eq",
        value: email,
      },
    ],
  })) as UserDoc | null;

  if (!user?._id) {
    throw new Error("Failed to create member user");
  }

  return user;
}

async function createOrganizationMember(ctx: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  runMutation: (
    mutationRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, args: {
  organizationId: string;
  userId: string;
  role: string;
}) {
  await ctx.runMutation(components.betterAuth.adapter.create as never, {
    input: {
      model: "member",
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        role: args.role,
        createdAt: Date.now(),
      },
    },
  } as never);

  const member = await getCurrentOrganizationMember(ctx, {
    organizationId: args.organizationId,
    userId: args.userId,
  });

  if (!member?._id) {
    throw new Error("Failed to create organization member");
  }

  return member;
}

async function deleteUserIfPresent(ctx: {
  runMutation: (
    mutationRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, userId: string) {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne as never, {
    input: {
      model: "user",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: userId,
        },
      ],
    },
  } as never);
}

async function deleteMemberIfPresent(ctx: {
  runMutation: (
    mutationRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, memberId: string) {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne as never, {
    input: {
      model: "member",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: memberId,
        },
      ],
    },
  } as never);
}

export const getLiveMembersPage = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const currentMember = (await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
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
      },
    )) as MemberDoc | null;

    if (!currentMember) {
      return null;
    }

    const members = (await ctx.runQuery(
      internal.memberProfiles.getResolvedMembersForOrganization,
      {
        organizationId: args.organizationId,
      },
    )) as Array<{
      id: string;
      organizationId: string;
      userId: string;
      role: string;
      createdAt: number;
      displayName: string;
      email: string | null;
      phoneNumberE164: string | null;
      image: string | null;
      memberType: "standard" | "phone_only";
      canWebSignIn: boolean;
    }>;

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

    const invitationDocs = (invitationsResult.page ?? []) as InvitationDoc[];

    return {
      currentMember: {
        id: currentMember._id,
        userId: currentMember.userId,
        role: currentMember.role,
      },
      members,
      invitations: invitationDocs.map((invitation) => ({
        id: invitation._id,
        organizationId: invitation.organizationId,
        email: invitation.email,
        role: invitation.role ?? "member",
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        inviterId: invitation.inviterId,
      })),
    };
  },
});

export const createPhoneOnlyMember = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const currentMember = await getCurrentOrganizationMember(ctx, {
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    if (!currentMember) {
      throw new Error("You do not have access to this organization");
    }

    if (currentMember.role !== "owner" && currentMember.role !== "admin") {
      throw new Error("You are not allowed to add WhatsApp-only members");
    }

    const displayName = args.name.trim();
    if (displayName.length < PHONE_ONLY_NAME_MIN_LENGTH) {
      throw new Error("Name is too short");
    }

    const normalizedPhone = normalizePhoneNumber(args.phoneNumber);
    if (!normalizedPhone) {
      throw new Error("Invalid WhatsApp number");
    }

    const conflictingConnection = (await ctx.runQuery(
      internal.whatsappData.getActiveConnectionByPhone,
      {
        phoneNumberE164: normalizedPhone.e164,
      },
    )) as { memberId: string } | null;

    if (conflictingConnection) {
      throw new Error("This WhatsApp number is already connected to another member");
    }

    let createdUserId: string | null = null;
    let createdMemberId: string | null = null;

    try {
      const user = await createHiddenUser(ctx, {
        displayName,
      });
      createdUserId = user._id;

      const member = await createOrganizationMember(ctx, {
        organizationId: args.organizationId,
        userId: user._id,
        role: "member",
      });
      createdMemberId = member._id;

      await ctx.runMutation(internal.memberProfiles.upsertMemberProfile, {
        organizationId: args.organizationId,
        memberId: member._id,
        userId: user._id,
        memberType: MEMBER_TYPE_PHONE_ONLY,
        displayName,
        createdByUserId: authUser._id,
      });

      await ctx.runMutation(internal.whatsappData.upsertConnectionForMember, {
        organizationId: args.organizationId,
        memberId: member._id,
        userId: user._id,
        phoneNumberE164: normalizedPhone.e164,
        strictUniqueness: true,
      });

      await ensureServiceSessionForUser(ctx, {
        userId: user._id,
        organizationId: args.organizationId,
        userAgent: "whatsapp-phone-only-member",
      });

      const members = (await ctx.runQuery(
        internal.memberProfiles.getResolvedMembersForOrganization,
        {
          organizationId: args.organizationId,
        },
      )) as Array<{ id: string }>;

      return members.find((memberRecord) => memberRecord.id === member._id) ?? null;
    } catch (error) {
      if (createdMemberId) {
        await ctx.runMutation(internal.whatsappData.disconnectConnectionByMember, {
          organizationId: args.organizationId,
          memberId: createdMemberId,
        }).catch(() => null);
        await ctx.runMutation(internal.memberProfiles.deleteMemberProfileByMemberId, {
          memberId: createdMemberId,
        }).catch(() => null);
        await deleteMemberIfPresent(ctx, createdMemberId).catch(() => null);
      }

      if (createdUserId) {
        await deleteSessionsForUser(ctx, createdUserId).catch(() => null);
        await ctx.runMutation(internal.memberProfiles.deleteLocalUserDataByUserId, {
          userId: createdUserId,
        }).catch(() => null);
        await deleteUserIfPresent(ctx, createdUserId).catch(() => null);
      }

      throw error;
    }
  },
});

export const removePhoneOnlyMember = action({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const currentMember = await getCurrentOrganizationMember(ctx, {
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    if (!currentMember) {
      throw new Error("You do not have access to this organization");
    }

    if (currentMember.role !== "owner" && currentMember.role !== "admin") {
      throw new Error("You are not allowed to remove this member");
    }

    const targetMember = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: args.memberId,
        },
      ],
    })) as MemberDoc | null;

    if (!targetMember || targetMember.organizationId !== args.organizationId) {
      throw new Error("Target member not found");
    }

    const targetProfile = (await ctx.runQuery(
      internal.memberProfiles.getMemberProfileByMemberId,
      {
        memberId: args.memberId,
      },
    )) as {
      memberType: "standard" | "phone_only";
    } | null;

    if (targetProfile?.memberType !== MEMBER_TYPE_PHONE_ONLY) {
      throw new Error("Only WhatsApp-only members can be removed with this action");
    }

    await ctx.runMutation(internal.whatsappData.disconnectConnectionByMember, {
      organizationId: args.organizationId,
      memberId: args.memberId,
    });
    await ctx.runMutation(internal.memberProfiles.deleteMemberProfileByMemberId, {
      memberId: args.memberId,
    });
    await deleteMemberIfPresent(ctx, args.memberId);

    const remainingMemberships = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "member",
      where: [
        {
          field: "userId",
          operator: "eq",
          value: targetMember.userId,
        },
      ],
      paginationOpts: {
        cursor: null,
        numItems: PAGE_SIZE,
      },
    })) as { page?: MemberDoc[] };

    if ((remainingMemberships.page ?? []).length === 0) {
      await deleteSessionsForUser(ctx, targetMember.userId);
      await ctx.runMutation(internal.memberProfiles.deleteLocalUserDataByUserId, {
        userId: targetMember.userId,
      });
      await ctx.runMutation(components.betterAuth.adapter.deleteMany as never, {
        input: {
          model: "account",
          where: [
            {
              field: "userId",
              operator: "eq",
              value: targetMember.userId,
            },
          ],
        },
        paginationOpts: {
          cursor: null,
          numItems: 100,
        },
      } as never);
      await deleteUserIfPresent(ctx, targetMember.userId);
    }

    return {
      memberId: args.memberId,
    };
  },
});
