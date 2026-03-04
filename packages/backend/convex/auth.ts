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
import { emailOTP } from "better-auth/plugins/email-otp";
import { organization } from "better-auth/plugins/organization";

import type { DataModel } from "./_generated/dataModel";

import { components } from "./_generated/api";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import {
  sendOrganizationInvitationEmail,
  sendOtpEmail,
} from "./lib/resend";

const siteUrl = process.env.SITE_URL!;
const appName = process.env.BETTER_AUTH_APP_NAME ?? "MVP Template";

export const authComponent = createClient<DataModel>(components.betterAuth);

function getRequestFromContext(context: unknown): Request | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const directRequest = (context as { request?: unknown }).request;
  if (directRequest instanceof Request) {
    return directRequest;
  }

  const nestedRequest = (context as { context?: { request?: unknown } }).context
    ?.request;

  if (nestedRequest instanceof Request) {
    return nestedRequest;
  }

  return null;
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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      emailOTP({
        disableSignUp: false,
        async sendVerificationOTP({ email, otp, type }, endpointContext) {
          const request = getRequestFromContext(endpointContext);
          const locale = getLocaleFromRequest(request);

          await sendOtpEmail({
            email,
            otp,
            type,
            appName,
            locale,
          });
        },
      }),
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
        isAuthenticated: false,
        hasName: false,
        hasOrganization: false,
        organizationCount: 0,
      };
    }

    const hasName = user.name.trim().length > 0;
    const authUserId = user._id;
    let hasOrganization = false;

    try {
      const membership = await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        {
          model: "member",
          where: [
            {
              field: "userId",
              operator: "eq",
              value: authUserId,
            },
          ],
        },
      );

      hasOrganization = !!membership;
    } catch (error) {
      console.error("Failed to load organizations for route gating", error);
    }

    return {
      isAuthenticated: true,
      hasName,
      hasOrganization,
      organizationCount: hasOrganization ? 1 : 0,
    };
  },
});
