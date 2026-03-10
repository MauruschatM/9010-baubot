import { v } from "convex/values";

import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const PAGE_SIZE = 500;

export const MEMBER_TYPE_STANDARD = "standard";
export const MEMBER_TYPE_PHONE_ONLY = "phone_only";
export const PHONE_ONLY_MEMBER_EMAIL_DOMAIN = "phone-member.invalid";

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

type WhatsAppConnectionDoc = Doc<"whatsappConnections">;
type MemberProfileDoc = Doc<"memberProfiles">;

export function buildPhoneOnlyMemberEmail() {
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `wa-member-${token}@${PHONE_ONLY_MEMBER_EMAIL_DOMAIN}`;
}

export function isPhoneOnlyMemberEmail(email: string | null | undefined) {
  if (typeof email !== "string") {
    return false;
  }

  return email.trim().toLowerCase().endsWith(`@${PHONE_ONLY_MEMBER_EMAIL_DOMAIN}`);
}

function sanitizeDisplayName(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function toPublicMember(options: {
  member: MemberDoc;
  user?: UserDoc | null;
  profile?: MemberProfileDoc | null;
  connection?: WhatsAppConnectionDoc | null;
}) {
  const memberType =
    options.profile?.memberType === MEMBER_TYPE_PHONE_ONLY
      ? MEMBER_TYPE_PHONE_ONLY
      : MEMBER_TYPE_STANDARD;
  const email =
    memberType === MEMBER_TYPE_PHONE_ONLY || isPhoneOnlyMemberEmail(options.user?.email)
      ? null
      : options.user?.email ?? null;
  const displayName =
    sanitizeDisplayName(options.profile?.displayName) ||
    sanitizeDisplayName(options.user?.name) ||
    email ||
    options.connection?.phoneNumberE164 ||
    "Unknown user";

  return {
    id: options.member._id,
    organizationId: options.member.organizationId,
    userId: options.member.userId,
    role: options.member.role,
    createdAt: options.member.createdAt,
    displayName,
    email,
    phoneNumberE164: options.connection?.phoneNumberE164 ?? null,
    image: memberType === MEMBER_TYPE_PHONE_ONLY ? null : options.user?.image ?? null,
    memberType,
    canWebSignIn: memberType !== MEMBER_TYPE_PHONE_ONLY,
  };
}

async function loadResolvedMembersForOrganization(ctx: {
  db: {
    query: (table: "memberProfiles" | "whatsappConnections") => any;
  };
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, organizationId: string) {
  const membersResult = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [
      {
        field: "organizationId",
        operator: "eq",
        value: organizationId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: PAGE_SIZE,
    },
  })) as { page?: MemberDoc[] };

  const members = (membersResult.page ?? []) as MemberDoc[];
  const userIds = [...new Set(members.map((member) => member.userId))];

  const usersResult =
    userIds.length === 0
      ? { page: [] as UserDoc[] }
      : ((await ctx.runQuery(components.betterAuth.adapter.findMany, {
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
        })) as { page?: UserDoc[] });

  const users = (usersResult.page ?? []) as UserDoc[];
  const userById = new Map(users.map((user) => [user._id, user]));

  const profiles = (await ctx.db
    .query("memberProfiles")
    .withIndex("by_organizationId", (q: any) => q.eq("organizationId", organizationId))
    .collect()) as MemberProfileDoc[];
  const profileByMemberId = new Map(profiles.map((profile) => [profile.memberId, profile]));

  const connections = (await ctx.db
    .query("whatsappConnections")
    .withIndex("by_org_status", (q: any) =>
      q.eq("organizationId", organizationId).eq("status", "active"),
    )
    .collect()) as WhatsAppConnectionDoc[];
  const connectionByMemberId = new Map(
    connections.map((connection) => [connection.memberId, connection]),
  );

  return members.map((member) =>
    toPublicMember({
      member,
      user: userById.get(member.userId) ?? null,
      profile: profileByMemberId.get(member._id) ?? null,
      connection: connectionByMemberId.get(member._id) ?? null,
    }),
  );
}

export const getResolvedMembersForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await loadResolvedMembersForOrganization(ctx, args.organizationId);
  },
});

export const getMemberProfileByMemberId = internalQuery({
  args: {
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memberProfiles")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .unique();
  },
});

export const upsertMemberProfile = internalMutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
    userId: v.string(),
    memberType: v.union(
      v.literal(MEMBER_TYPE_STANDARD),
      v.literal(MEMBER_TYPE_PHONE_ONLY),
    ),
    displayName: v.string(),
    createdByUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const displayName = sanitizeDisplayName(args.displayName);
    const existing = await ctx.db
      .query("memberProfiles")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        organizationId: args.organizationId,
        userId: args.userId,
        memberType: args.memberType,
        displayName,
        createdByUserId: args.createdByUserId,
        updatedAt: now,
      });

      return existing._id;
    }

    return await ctx.db.insert("memberProfiles", {
      organizationId: args.organizationId,
      memberId: args.memberId,
      userId: args.userId,
      memberType: args.memberType,
      displayName,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteMemberProfileByMemberId = internalMutation({
  args: {
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("memberProfiles")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);
    return existing._id;
  },
});

export const deleteLocalUserDataByUserId = internalMutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const [preference, themePreference] = await Promise.all([
      ctx.db
        .query("userPreferences")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .unique(),
      ctx.db
        .query("userThemePreferences")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .unique(),
    ]);

    if (preference) {
      await ctx.db.delete(preference._id);
    }

    if (themePreference) {
      await ctx.db.delete(themePreference._id);
    }

    return null;
  },
});
