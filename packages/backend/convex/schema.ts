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
  agentChatThreads: defineTable({
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
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
  organizationAgentProfiles: defineTable({
    organizationId: v.string(),
    name: v.string(),
    styleId: v.union(v.literal("woman"), v.literal("man")),
    updatedByUserId: v.string(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),
});
