import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  parseCookieValue,
  resolveLocale,
  type AppLocale,
} from "@mvp-template/i18n";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { organization } from "better-auth/plugins/organization";

import type { DataModel } from "./_generated/dataModel";

import { components } from "./_generated/api";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import {
  sendOrganizationInvitationEmail,
  sendPasswordResetEmail,
} from "./lib/resend";

const siteUrl = process.env.SITE_URL!;
const appName = process.env.BETTER_AUTH_APP_NAME ?? "Baubot";

export const authComponent = createClient<DataModel>(components.betterAuth);

interface MemberDoc {
  _id: string;
  createdAt: number;
  organizationId: string;
  role: string;
  userId: string;
}

interface OrganizationDoc {
  _id: string;
  createdAt: number;
  logo?: string | null;
  metadata?: string | null;
  name: string;
  slug: string;
}

interface SessionDoc {
  _id: string;
  activeOrganizationId?: string | null;
  createdAt: number;
  expiresAt: number;
  token: string;
  updatedAt: number;
  userId: string;
}

function getLocaleFromRequest(request: Request | null, userPreference?: AppLocale | null) {
  const cookieHeader = request?.headers.get("cookie");
  const cookieLocale = parseCookieValue(cookieHeader, LOCALE_COOKIE_NAME);
  const acceptLanguage = request?.headers.get("accept-language");

  return resolveLocale({
    userPreference,
    cookieLocale,
    acceptLanguage,
    defaultLocale: DEFAULT_LOCALE,
  });
}

async function getStoredLocaleByUserId(
  ctx: GenericCtx<DataModel>,
  userId: string | null | undefined,
) {
  if (!userId || !("db" in ctx)) {
    return null;
  }

  const preference = await ctx.db
    .query("userPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

  return preference?.locale ?? null;
}

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const activeOrganizationId = await getInitialOrganizationId(ctx, session.userId);

            return {
              data: {
                ...session,
                activeOrganizationId,
              },
            };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      async sendResetPassword({ user, url }, request) {
        const resetUserId =
          (user as { id?: string; _id?: string }).id ??
          (user as { id?: string; _id?: string })._id;
        const userPreference = await getStoredLocaleByUserId(ctx, resetUserId);
        const locale = getLocaleFromRequest(request ?? null, userPreference);

        void sendPasswordResetEmail({
          email: user.email,
          resetUrl: url,
          appName,
          locale,
        }).catch((error) => {
          console.error("Failed to send password reset email", error);
        });
      },
    },
    plugins: [
      organization({
        async sendInvitationEmail(data, request) {
          const inviteUrl = `${siteUrl}/invitation?invitationId=${data.id}`;
          const inviterUserId =
            (data.inviter.user as { id?: string; _id?: string }).id ??
            (data.inviter.user as { id?: string; _id?: string })._id;
          const userPreference = await getStoredLocaleByUserId(
            ctx,
            inviterUserId,
          );
          const locale = getLocaleFromRequest(request ?? null, userPreference);

          await sendOrganizationInvitationEmail({
            email: data.email,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            role: data.role,
            inviteUrl,
            invitationId: data.id,
            locale,
          });
        },
      }),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});

export const getRouteGateState = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);

    if (!user) {
      return {
        activeMember: null,
        activeOrganization: null,
        isAuthenticated: false,
        hasActiveOrganization: false,
        hasName: false,
        hasOrganization: false,
        organizationCount: 0,
        organizations: [],
        userId: null,
      };
    }

    const hasName = user.name.trim().length > 0;
    const activeOrganizationId = (await getCurrentSession(ctx))?.activeOrganizationId ?? null;
    let activeMember: MemberDoc | null = null;
    let activeOrganization: OrganizationDoc | null = null;
    let organizations: OrganizationDoc[] = [];

    try {
      const organizationState = await getOrganizationStateForUser(
        ctx,
        String(user._id),
        activeOrganizationId,
      );
      activeMember = organizationState.activeMember;
      activeOrganization = organizationState.activeOrganization;
      organizations = organizationState.organizations;
    } catch (error) {
      console.error("Failed to load organizations for route gating", error);
    }

    const organizationCount = organizations.length;

    return {
      activeMember:
        activeMember === null
          ? null
          : {
              id: activeMember._id,
              organizationId: activeMember.organizationId,
              role: activeMember.role,
              userId: activeMember.userId,
            },
      activeOrganization:
        activeOrganization === null
          ? null
          : {
              id: activeOrganization._id,
              logo: activeOrganization.logo ?? null,
              name: activeOrganization.name,
              slug: activeOrganization.slug,
            },
      isAuthenticated: true,
      hasActiveOrganization: activeOrganization !== null && activeMember !== null,
      hasName,
      hasOrganization: organizationCount > 0,
      organizationCount,
      organizations: organizations.map((organization) => ({
        id: organization._id,
        logo: organization.logo ?? null,
        name: organization.name,
        slug: organization.slug,
      })),
      userId: String(user._id),
    };
  },
});

async function getCurrentSession(ctx: GenericCtx<DataModel>) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.sessionId) {
    return null;
  }

  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [
      {
        field: "_id",
        value: identity.sessionId as string,
      },
      {
        field: "expiresAt",
        operator: "gt",
        value: Date.now(),
      },
    ],
  })) as SessionDoc | null;
}

async function getOrganizationStateForUser(
  ctx: GenericCtx<DataModel>,
  userId: string,
  activeOrganizationId: string | null,
) {
  const memberships = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: 100,
    },
  });

  const memberDocs = memberships.page as MemberDoc[];
  const organizationIds = [...new Set(memberDocs.map((member) => member.organizationId))];
  const organizationsResult =
    organizationIds.length > 0
      ? await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: "organization",
          where: [
            {
              field: "_id",
              operator: "in",
              value: organizationIds,
            },
          ],
          paginationOpts: {
            cursor: null,
            numItems: 100,
          },
        })
      : { page: [] as OrganizationDoc[] };
  const organizationById = new Map(
    ((organizationsResult.page ?? []) as OrganizationDoc[]).map((organization) => [
      organization._id,
      organization,
    ]),
  );
  const organizations = organizationIds
    .map((organizationId) => organizationById.get(organizationId))
    .filter((organization): organization is OrganizationDoc => organization !== undefined);

  return {
    activeMember:
      memberDocs.find((member) => member.organizationId === activeOrganizationId) ?? null,
    activeOrganization:
      (activeOrganizationId ? organizationById.get(activeOrganizationId) : null) ?? null,
    organizations,
  };
}

async function getInitialOrganizationId(
  ctx: GenericCtx<DataModel>,
  userId: string,
) {
  const memberships = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "member",
    where: [
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: 100,
    },
  });

  return (memberships.page[0] as MemberDoc | undefined)?.organizationId ?? null;
}
