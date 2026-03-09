import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  vMastraChatMessageType,
  vMastraChatRole,
  vMastraChatRunStatus,
  vMastraChatStreamActor,
  vMastraChatStreamPhase,
} from "./mastraComponent/constants";

export default defineSchema({
  userPreferences: defineTable({
    userId: v.string(),
    locale: v.union(v.literal("en"), v.literal("de")),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  userThemePreferences: defineTable({
    userId: v.string(),
    theme: v.union(v.literal("light"), v.literal("dark")),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  agentChatThreads: defineTable({
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    channel: v.optional(v.union(v.literal("web"), v.literal("whatsapp"))),
    memberId: v.optional(v.string()),
    title: v.optional(v.string()),
    lastSeenUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_resourceId", ["resourceId"]),
  agentChatMessages: defineTable({
    messageId: v.string(),
    threadId: v.string(),
    threadOrder: v.number(),
    role: vMastraChatRole,
    type: vMastraChatMessageType,
    content: v.any(),
    text: v.string(),
    attachmentNames: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_threadId_order", ["threadId", "threadOrder"])
    .index("by_threadId_messageId", ["threadId", "messageId"]),
  chatThreadStates: defineTable({
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    status: vMastraChatRunStatus,
    lastError: v.union(v.string(), v.null()),
    lastRunId: v.union(v.string(), v.null()),
    streamingText: v.optional(v.union(v.string(), v.null())),
    streamPhase: v.optional(vMastraChatStreamPhase),
    streamActor: v.optional(vMastraChatStreamActor),
    activeToolLabel: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_resourceId", ["resourceId"]),
  aiPendingActions: defineTable({
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    actionType: v.literal("delete-organization"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("canceled"),
      v.literal("expired"),
    ),
    payload: v.object({
      organizationId: v.string(),
      organizationName: v.optional(v.string()),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_thread_status_createdAt", ["threadId", "status", "createdAt"])
    .index("by_thread_status", ["threadId", "status"])
    .index("by_owner_status", ["organizationId", "userId", "status"]),
  aiClarificationSessions: defineTable({
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("answered"),
      v.literal("canceled"),
      v.literal("expired"),
    ),
    intent: v.union(
      v.literal("generic"),
      v.literal("invite_member"),
      v.literal("remove_member"),
      v.literal("update_member_role"),
      v.literal("cancel_invitation"),
      v.literal("update_organization"),
    ),
    contextVersion: v.string(),
    prompt: v.string(),
    title: v.string(),
    description: v.string(),
    assistantMessage: v.string(),
    questions: v.array(
      v.object({
        id: v.string(),
        prompt: v.string(),
        options: v.array(
          v.object({
            id: v.string(),
            label: v.string(),
            description: v.string(),
          }),
        ),
        allowOther: v.boolean(),
        required: v.boolean(),
      }),
    ),
    answers: v.optional(v.record(v.string(), v.string())),
    resumePrompt: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_thread_status_createdAt", ["threadId", "status", "createdAt"])
    .index("by_thread_status", ["threadId", "status"])
    .index("by_owner_status", ["organizationId", "userId", "status"]),
  organizationAgentProfiles: defineTable({
    organizationId: v.string(),
    name: v.string(),
    styleId: v.union(v.literal("woman"), v.literal("man")),
    updatedByUserId: v.string(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),
  whatsappConnections: defineTable({
    organizationId: v.string(),
    memberId: v.string(),
    userId: v.string(),
    phoneNumberE164: v.string(),
    phoneNumberDigits: v.string(),
    status: v.union(v.literal("active"), v.literal("disconnected")),
    createdAt: v.number(),
    updatedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
  })
    .index("by_memberId", ["memberId"])
    .index("by_phoneNumberE164", ["phoneNumberE164"])
    .index("by_userId", ["userId"])
    .index("by_org_member_status", ["organizationId", "memberId", "status"])
    .index("by_org_status", ["organizationId", "status"]),
  whatsappOnboardingSessions: defineTable({
    phoneNumberE164: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("expired"),
    ),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_phoneNumberE164", ["phoneNumberE164"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),
  whatsappMessages: defineTable({
    providerMessageSid: v.optional(v.string()),
    direction: v.union(
      v.literal("inbound"),
      v.literal("outbound"),
      v.literal("system"),
    ),
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
    turnStatus: v.union(
      v.literal("buffered"),
      v.literal("sent_to_agent"),
      v.literal("ignored"),
    ),
    createdAt: v.number(),
    sentToAgentAt: v.optional(v.number()),
  })
    .index("by_providerMessageSid", ["providerMessageSid"])
    .index("by_connection_createdAt", ["connectionId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_phone_createdAt", ["phoneNumberE164", "createdAt"]),
  whatsappTurnBuffers: defineTable({
    connectionId: v.id("whatsappConnections"),
    organizationId: v.string(),
    userId: v.string(),
    memberId: v.string(),
    threadId: v.string(),
    status: v.union(v.literal("buffering"), v.literal("awaiting_confirmation")),
    bufferedMessageIds: v.array(v.id("whatsappMessages")),
    firstBufferedAt: v.number(),
    lastBufferedAt: v.number(),
    readyPromptSentAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_connectionId", ["connectionId"])
    .index("by_threadId", ["threadId"]),
});
