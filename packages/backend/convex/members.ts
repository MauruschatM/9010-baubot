import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { authComponent } from "./auth";

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

    const memberDocs = (membersResult.page ?? []) as MemberDoc[];
    const memberUserIds = [...new Set(memberDocs.map((member) => member.userId))];

    const usersResult =
      memberUserIds.length > 0
        ? await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: "user",
            where: [
              {
                field: "_id",
                operator: "in",
                value: memberUserIds,
              },
            ],
            paginationOpts: {
              cursor: null,
              numItems: PAGE_SIZE,
            },
          })
        : {
            page: [] as UserDoc[],
          };

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

    const invitationDocs = (invitationsResult.page ?? []) as InvitationDoc[];

    return {
      currentMember: {
        id: currentMember._id,
        userId: currentMember.userId,
        role: currentMember.role,
      },
      members: memberDocs.map((member) => {
        const user = userById.get(member.userId);
        return {
          id: member._id,
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          user: {
            id: user?._id ?? member.userId,
            name: user?.name ?? "Unknown user",
            email: user?.email ?? "",
            image: user?.image ?? null,
          },
        };
      }),
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
