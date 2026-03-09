import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import { sendWhatsappActivationGuideEmail } from "./lib/resend";
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
};

type OrganizationDoc = {
  _id: string;
  name: string;
};

type WhatsAppConnectionDoc = {
  _id: Id<"whatsappConnections">;
  organizationId: string;
  memberId: string;
  userId: string;
  phoneNumberE164: string;
  phoneNumberDigits: string;
  status: "active" | "disconnected";
  createdAt: number;
  updatedAt: number;
  disconnectedAt?: number;
};

type WhatsAppMessageDoc = {
  _id: Id<"whatsappMessages">;
  providerMessageSid?: string;
  direction: "inbound" | "outbound" | "system";
  phoneNumberE164: string;
  connectionId?: Id<"whatsappConnections">;
  organizationId?: string;
  userId?: string;
  memberId?: string;
  threadId?: string;
  text: string;
  media: Array<{
    storageId: Id<"_storage">;
    contentType: string;
    fileName?: string;
    mediaUrl?: string;
    transcription?: string;
    transcriptionModel?: string;
  }>;
  turnStatus: "buffered" | "sent_to_agent" | "ignored";
  createdAt: number;
  sentToAgentAt?: number;
};

type WhatsAppTurnBufferDoc = {
  _id: Id<"whatsappTurnBuffers">;
  connectionId: Id<"whatsappConnections">;
  organizationId: string;
  userId: string;
  memberId: string;
  threadId: string;
  status: "buffering" | "awaiting_confirmation";
  bufferedMessageIds: Id<"whatsappMessages">[];
  firstBufferedAt: number;
  lastBufferedAt: number;
  readyPromptSentAt?: number;
  updatedAt: number;
};

type OnboardingSessionDoc = {
  _id: Id<"whatsappOnboardingSessions">;
  phoneNumberE164: string;
  status: "active" | "completed" | "expired";
  stage:
    | "awaiting_email"
    | "awaiting_otp"
    | "awaiting_switch_selection"
    | "awaiting_unlink_confirmation"
    | "ready";
  locale: "en" | "de";
  email?: string;
  userId?: string;
  organizationId?: string;
  memberId?: string;
  pendingOrganizations?: Array<{
    organizationId: string;
    organizationName: string;
    memberId: string;
  }>;
  otpAttempts: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

function toConnectionPublic(connection: WhatsAppConnectionDoc | null) {
  if (!connection) {
    return null;
  }

  return {
    id: connection._id,
    organizationId: connection.organizationId,
    memberId: connection.memberId,
    userId: connection.userId,
    phoneNumberE164: connection.phoneNumberE164,
    status: connection.status,
    updatedAt: connection.updatedAt,
  };
}

export const getConnectionSetupInfo = query({
  args: {},
  handler: async () => {
    const numberRaw = process.env.WHATSAPP_AGENT_NUMBER ?? "";
    const initialMessage =
      process.env.WHATSAPP_INITIAL_MESSAGE ??
      "Hi, I am your ai agent for the trades!";
    const normalized = normalizePhoneNumber(numberRaw);

    return {
      phoneNumberE164: normalized?.e164 ?? null,
      initialMessage,
      waLink:
        normalized?.digits
          ? `https://wa.me/${normalized.digits}?text=${encodeURIComponent(initialMessage)}`
          : null,
    };
  },
});

export const getMyConnection = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const member = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!member) {
      return null;
    }

    const connection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_member_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("memberId", member._id)
          .eq("status", "active"),
      )
      .first();

    return {
      memberId: member._id,
      role: member.role,
      connection: toConnectionPublic(connection ?? null),
    };
  },
});

export const getOrganizationConnections = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const currentMember = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!currentMember) {
      return null;
    }

    const connections = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "active"),
      )
      .collect();

    const memberIds = [...new Set(connections.map((connection) => connection.memberId))];

    return {
      currentMember: {
        id: currentMember._id,
        role: currentMember.role,
      },
      connections: connections.map((connection) => toConnectionPublic(connection)!),
      memberIds,
    };
  },
});

export const setMemberConnection = mutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const normalizedPhone = normalizePhoneNumber(args.phoneNumber);
    if (!normalizedPhone) {
      throw new Error("Invalid WhatsApp number");
    }

    const currentMember = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!currentMember) {
      throw new Error("You do not have access to this organization");
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

    const canManageTarget =
      targetMember.userId === authUser._id ||
      currentMember.role === "owner" ||
      currentMember.role === "admin";

    if (!canManageTarget) {
      throw new Error("You are not allowed to manage this WhatsApp connection");
    }

    const conflictingConnection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_phoneNumberE164", (q) => q.eq("phoneNumberE164", normalizedPhone.e164))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (conflictingConnection && conflictingConnection.memberId !== args.memberId) {
      throw new Error("This WhatsApp number is already connected to another member");
    }

    const now = Date.now();
    const currentConnection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_member_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("memberId", args.memberId)
          .eq("status", "active"),
      )
      .first();

    if (currentConnection) {
      await ctx.db.patch(currentConnection._id, {
        phoneNumberE164: normalizedPhone.e164,
        phoneNumberDigits: normalizedPhone.digits,
        updatedAt: now,
      });

      return toConnectionPublic({
        ...currentConnection,
        phoneNumberE164: normalizedPhone.e164,
        phoneNumberDigits: normalizedPhone.digits,
        updatedAt: now,
      });
    }

    const connectionId = await ctx.db.insert("whatsappConnections", {
      organizationId: args.organizationId,
      memberId: args.memberId,
      userId: targetMember.userId,
      phoneNumberE164: normalizedPhone.e164,
      phoneNumberDigits: normalizedPhone.digits,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const connection = await ctx.db.get(connectionId);
    return toConnectionPublic(connection as WhatsAppConnectionDoc);
  },
});

export const removeMemberConnection = mutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const currentMember = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!currentMember) {
      throw new Error("You do not have access to this organization");
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

    const canManageTarget =
      targetMember.userId === authUser._id ||
      currentMember.role === "owner" ||
      currentMember.role === "admin";

    if (!canManageTarget) {
      throw new Error("You are not allowed to manage this WhatsApp connection");
    }

    const connection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_member_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("memberId", args.memberId)
          .eq("status", "active"),
      )
      .first();

    if (!connection) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: "disconnected",
      disconnectedAt: now,
      updatedAt: now,
    });

    await ctx.db
      .query("whatsappTurnBuffers")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connection._id))
      .collect()
      .then((buffers) => Promise.all(buffers.map((buffer) => ctx.db.delete(buffer._id))));

    return true;
  },
});

export const getOrganizationAgentProfileByOrganizationId = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("organizationAgentProfiles")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    return profile
      ? {
          name: profile.name,
        }
      : null;
  },
});

export const getUserLocaleByUserId = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const preference = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    return preference?.locale ?? null;
  },
});

export const sendMemberActivationGuideEmail = action({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const currentMember = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!currentMember) {
      throw new Error("You do not have access to this organization");
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

    const canManageTarget =
      targetMember.userId === authUser._id ||
      currentMember.role === "owner" ||
      currentMember.role === "admin";

    if (!canManageTarget) {
      throw new Error("You are not allowed to manage this WhatsApp connection");
    }

    const targetUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: targetMember.userId,
        },
      ],
    })) as UserDoc | null;

    if (!targetUser?.email) {
      throw new Error("Target user email is missing");
    }

    const organization = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "organization",
      where: [
        {
          field: "_id",
          operator: "eq",
          value: args.organizationId,
        },
      ],
    })) as OrganizationDoc | null;

    const organizationName = organization?.name?.trim() || "Workspace";
    const agentProfile = await ctx.runQuery(
      internal.whatsappData.getOrganizationAgentProfileByOrganizationId,
      {
        organizationId: args.organizationId,
      },
    );
    const agentName = agentProfile?.name?.trim() || "AI Agent";
    const userPreferenceLocale = await ctx.runQuery(
      internal.whatsappData.getUserLocaleByUserId,
      {
        userId: targetMember.userId,
      },
    );
    const locale = userPreferenceLocale === "de" ? "de" : "en";

    const numberRaw = process.env.WHATSAPP_AGENT_NUMBER ?? "";
    const initialMessage =
      process.env.WHATSAPP_INITIAL_MESSAGE ??
      "Hi, I am your ai agent for the trades!";
    const normalizedAgentNumber = normalizePhoneNumber(numberRaw);

    await sendWhatsappActivationGuideEmail({
      email: targetUser.email,
      locale,
      organizationName,
      memberName: targetUser.name.trim() || targetUser.email,
      agentName,
      agentNumber: normalizedAgentNumber?.e164 ?? null,
      initialMessage,
      waLink:
        normalizedAgentNumber?.digits
          ? `https://wa.me/${normalizedAgentNumber.digits}?text=${encodeURIComponent(initialMessage)}`
          : null,
      organizationId: args.organizationId,
      memberId: args.memberId,
    });

    return {
      email: targetUser.email,
    };
  },
});

export const getConnectionById = internalQuery({
  args: {
    connectionId: v.id("whatsappConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) {
      return null;
    }

    return connection as WhatsAppConnectionDoc;
  },
});

export const getActiveConnectionByPhone = internalQuery({
  args: {
    phoneNumberE164: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_phoneNumberE164", (q) => q.eq("phoneNumberE164", args.phoneNumberE164))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    return (connection as WhatsAppConnectionDoc | null) ?? null;
  },
});

export const getActiveConnectionsByOrganization = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const connections = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "active"),
      )
      .collect();

    return connections as WhatsAppConnectionDoc[];
  },
});

export const getOnboardingSessionByPhone = internalQuery({
  args: {
    phoneNumberE164: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("whatsappOnboardingSessions")
      .withIndex("by_phoneNumberE164", (q) => q.eq("phoneNumberE164", args.phoneNumberE164))
      .order("desc")
      .first();

    return (session as OnboardingSessionDoc | null) ?? null;
  },
});

export const upsertOnboardingSession = internalMutation({
  args: {
    phoneNumberE164: v.string(),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("expired")),
    stage: v.union(
      v.literal("awaiting_email"),
      v.literal("awaiting_otp"),
      v.literal("awaiting_switch_selection"),
      v.literal("awaiting_unlink_confirmation"),
      v.literal("ready"),
    ),
    locale: v.union(v.literal("en"), v.literal("de")),
    email: v.optional(v.string()),
    userId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    memberId: v.optional(v.string()),
    pendingOrganizations: v.optional(
      v.array(
        v.object({
          organizationId: v.string(),
          organizationName: v.string(),
          memberId: v.string(),
        }),
      ),
    ),
    otpAttempts: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("whatsappOnboardingSessions")
      .withIndex("by_phoneNumberE164", (q) => q.eq("phoneNumberE164", args.phoneNumberE164))
      .order("desc")
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        stage: args.stage,
        locale: args.locale,
        email: args.email,
        userId: args.userId,
        organizationId: args.organizationId,
        memberId: args.memberId,
        pendingOrganizations: args.pendingOrganizations,
        otpAttempts: args.otpAttempts,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });

      return existing._id;
    }

    return await ctx.db.insert("whatsappOnboardingSessions", {
      phoneNumberE164: args.phoneNumberE164,
      status: args.status,
      stage: args.stage,
      locale: args.locale,
      email: args.email,
      userId: args.userId,
      organizationId: args.organizationId,
      memberId: args.memberId,
      pendingOrganizations: args.pendingOrganizations,
      otpAttempts: args.otpAttempts,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertConnectionForMember = internalMutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
    userId: v.string(),
    phoneNumberE164: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedPhone = normalizePhoneNumber(args.phoneNumberE164);
    if (!normalizedPhone) {
      throw new Error("Invalid phone number");
    }

    const now = Date.now();

    const conflicts = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_phoneNumberE164", (q) => q.eq("phoneNumberE164", normalizedPhone.e164))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    for (const conflict of conflicts) {
      if (conflict.memberId === args.memberId) {
        continue;
      }

      await ctx.db.patch(conflict._id, {
        status: "disconnected",
        disconnectedAt: now,
        updatedAt: now,
      });
    }

    const existing = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_member_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("memberId", args.memberId)
          .eq("status", "active"),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        phoneNumberE164: normalizedPhone.e164,
        phoneNumberDigits: normalizedPhone.digits,
        userId: args.userId,
        updatedAt: now,
      });

      return existing._id;
    }

    return await ctx.db.insert("whatsappConnections", {
      organizationId: args.organizationId,
      memberId: args.memberId,
      userId: args.userId,
      phoneNumberE164: normalizedPhone.e164,
      phoneNumberDigits: normalizedPhone.digits,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const disconnectConnectionByMember = internalMutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_org_member_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("memberId", args.memberId)
          .eq("status", "active"),
      )
      .first();

    if (!connection) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: "disconnected",
      disconnectedAt: now,
      updatedAt: now,
    });

    return connection._id;
  },
});

export const insertWhatsAppMessage = internalMutation({
  args: {
    providerMessageSid: v.optional(v.string()),
    direction: v.union(v.literal("inbound"), v.literal("outbound"), v.literal("system")),
    phoneNumberE164: v.string(),
    connectionId: v.optional(v.id("whatsappConnections")),
    organizationId: v.optional(v.string()),
    userId: v.optional(v.string()),
    memberId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    text: v.string(),
    media: v.array(
      v.object({
        storageId: v.id("_storage"),
        contentType: v.string(),
        fileName: v.optional(v.string()),
        mediaUrl: v.optional(v.string()),
        transcription: v.optional(v.string()),
        transcriptionModel: v.optional(v.string()),
      }),
    ),
    turnStatus: v.union(v.literal("buffered"), v.literal("sent_to_agent"), v.literal("ignored")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("whatsappMessages", {
      providerMessageSid: args.providerMessageSid,
      direction: args.direction,
      phoneNumberE164: args.phoneNumberE164,
      connectionId: args.connectionId,
      organizationId: args.organizationId,
      userId: args.userId,
      memberId: args.memberId,
      threadId: args.threadId,
      text: args.text,
      media: args.media,
      turnStatus: args.turnStatus,
      createdAt: Date.now(),
    });

    return {
      id,
    };
  },
});

export const addMessageToTurnBuffer = internalMutation({
  args: {
    connectionId: v.id("whatsappConnections"),
    organizationId: v.string(),
    userId: v.string(),
    memberId: v.string(),
    threadId: v.string(),
    messageId: v.id("whatsappMessages"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("whatsappTurnBuffers")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        bufferedMessageIds: [...existing.bufferedMessageIds, args.messageId],
        lastBufferedAt: now,
        updatedAt: now,
      });

      const patched = await ctx.db.get(existing._id);
      return patched as WhatsAppTurnBufferDoc;
    }

    const id = await ctx.db.insert("whatsappTurnBuffers", {
      connectionId: args.connectionId,
      organizationId: args.organizationId,
      userId: args.userId,
      memberId: args.memberId,
      threadId: args.threadId,
      status: "buffering",
      bufferedMessageIds: [args.messageId],
      firstBufferedAt: now,
      lastBufferedAt: now,
      updatedAt: now,
    });

    const created = await ctx.db.get(id);
    return created as WhatsAppTurnBufferDoc;
  },
});

export const updateTurnBufferStatus = internalMutation({
  args: {
    bufferId: v.id("whatsappTurnBuffers"),
    status: v.union(v.literal("buffering"), v.literal("awaiting_confirmation")),
    readyPromptSentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bufferId, {
      status: args.status,
      readyPromptSentAt: args.readyPromptSentAt,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const clearTurnBufferByConnection = internalMutation({
  args: {
    connectionId: v.id("whatsappConnections"),
  },
  handler: async (ctx, args) => {
    const buffers = await ctx.db
      .query("whatsappTurnBuffers")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", args.connectionId))
      .collect();

    await Promise.all(buffers.map((buffer) => ctx.db.delete(buffer._id)));
    return null;
  },
});

export const getMessagesByIds = internalQuery({
  args: {
    messageIds: v.array(v.id("whatsappMessages")),
  },
  handler: async (ctx, args) => {
    const messages = await Promise.all(args.messageIds.map((id) => ctx.db.get(id)));
    return messages.filter((message) => !!message) as WhatsAppMessageDoc[];
  },
});

export const markMessagesSentToAgent = internalMutation({
  args: {
    messageIds: v.array(v.id("whatsappMessages")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await Promise.all(
      args.messageIds.map(async (messageId) => {
        const message = await ctx.db.get(messageId);
        if (!message) {
          return;
        }

        await ctx.db.patch(messageId, {
          turnStatus: "sent_to_agent",
          sentToAgentAt: now,
        });
      }),
    );

    return null;
  },
});
