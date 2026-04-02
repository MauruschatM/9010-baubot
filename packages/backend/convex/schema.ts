import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  vPendingActionPayload,
  vPendingActionStatus,
  vPendingActionType,
} from "./aiPendingActions";
import {
  vMastraChatMessageType,
  vMastraChatRole,
  vMastraChatRunStatus,
  vMastraChatStreamActor,
  vMastraChatStreamPhase,
} from "./mastraComponent/constants";
import { vAppLocale } from "./lib/locales";
import { projectStatusValidator } from "./projectStatus";

const timelineMediaKindValidator = v.union(
  v.literal("image"),
  v.literal("audio"),
  v.literal("video"),
  v.literal("file"),
);

const pendingResolutionOptionValidator = v.object({
  projectId: v.id("projects"),
  location: v.string(),
  customerName: v.optional(v.string()),
});

const timelineMediaAssetValidator = v.object({
  mediaAssetId: v.id("whatsappMediaAssets"),
  mimeType: v.string(),
  kind: timelineMediaKindValidator,
});

const timelineFieldLocalesValidator = v.object({
  sourceText: v.optional(v.string()),
  text: v.optional(v.string()),
  transcript: v.optional(v.string()),
  extractedText: v.optional(v.string()),
  summary: v.optional(v.string()),
  batchTitle: v.optional(v.string()),
  batchOverview: v.optional(v.string()),
  nachtragDetails: v.optional(v.string()),
  nachtragItems: v.optional(v.array(v.string())),
});

const mediaFieldLocalesValidator = v.object({
  transcript: v.optional(v.string()),
  extractedText: v.optional(v.string()),
  summary: v.optional(v.string()),
});

export default defineSchema({
  userPreferences: defineTable({
    userId: v.string(),
    locale: vAppLocale,
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  userThemePreferences: defineTable({
    userId: v.string(),
    theme: v.union(v.literal("light"), v.literal("dark")),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  organizationSettings: defineTable({
    organizationId: v.string(),
    companyEmail: v.optional(v.string()),
    companyEmailLocale: v.optional(vAppLocale),
    updatedByUserId: v.string(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),
  customers: defineTable({
    organizationId: v.string(),
    createdBy: v.string(),
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    emailHistory: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_organization_updatedAt", ["organizationId", "updatedAt"])
    .index("by_organization_deletedAt_updatedAt", ["organizationId", "deletedAt", "updatedAt"]),
  projects: defineTable({
    organizationId: v.string(),
    createdBy: v.string(),
    customerId: v.optional(v.id("customers")),
    // Kept optional until legacy project names are backfilled into location.
    location: v.optional(v.string()),
    status: v.optional(projectStatusValidator),
    description: v.optional(v.string()),
    lastTimelineActivityAt: v.optional(v.number()),
    lastNachtragAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_updatedAt", ["organizationId", "updatedAt"])
    .index("by_organization_deletedAt_updatedAt", ["organizationId", "deletedAt", "updatedAt"])
    .index("by_customerId_updatedAt", ["customerId", "updatedAt"]),
  projectReviewStates: defineTable({
    organizationId: v.string(),
    projectId: v.id("projects"),
    userId: v.string(),
    lastSeenTimelineActivityAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_org_project", ["userId", "organizationId", "projectId"]),
  projectTimelineItems: defineTable({
    organizationId: v.string(),
    projectId: v.id("projects"),
    batchId: v.id("whatsappSendBatches"),
    sourceType: v.union(
      v.literal("whatsapp_message"),
      v.literal("whatsapp_batch_summary"),
      v.literal("email_sent"),
    ),
    messageId: v.optional(v.id("whatsappMessages")),
    addedAt: v.number(),
    dayBucketUtc: v.string(),
    addedByMemberId: v.string(),
    addedByUserId: v.string(),
    addedByName: v.optional(v.string()),
    sourceText: v.optional(v.string()),
    text: v.optional(v.string()),
    transcript: v.optional(v.string()),
    extractedText: v.optional(v.string()),
    summary: v.optional(v.string()),
    batchTitle: v.optional(v.string()),
    batchOverview: v.optional(v.string()),
    hasNachtrag: v.optional(v.boolean()),
    nachtragNeedsClarification: v.optional(v.boolean()),
    nachtragItems: v.optional(v.array(v.string())),
    nachtragDetails: v.optional(v.string()),
    nachtragLanguage: v.optional(vAppLocale),
    keywords: v.optional(v.array(v.string())),
    emailRecipient: v.optional(v.string()),
    emailSubject: v.optional(v.string()),
    emailBody: v.optional(v.string()),
    fieldLocales: v.optional(timelineFieldLocalesValidator),
    mediaAssets: v.optional(v.array(timelineMediaAssetValidator)),
    createdAt: v.number(),
  })
    .index("by_project_addedAt", ["projectId", "addedAt"])
    .index("by_project_dayBucketUtc_addedAt", ["projectId", "dayBucketUtc", "addedAt"])
    .index("by_organization_sourceType_addedAt", ["organizationId", "sourceType", "addedAt"])
    .index("by_batchId", ["batchId"]),
  documentationOverviewEmbeddings: defineTable({
    batchId: v.id("whatsappSendBatches"),
    timelineItemId: v.id("projectTimelineItems"),
    organizationId: v.string(),
    projectId: v.id("projects"),
    projectLocation: v.string(),
    customerName: v.optional(v.string()),
    batchTitle: v.string(),
    summary: v.optional(v.string()),
    overview: v.string(),
    searchText: v.string(),
    hasNachtrag: v.boolean(),
    locale: v.optional(vAppLocale),
    addedAt: v.number(),
    embeddingModel: v.string(),
    embedding: v.array(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batchId", ["batchId"])
    .index("by_organization_addedAt", ["organizationId", "addedAt"])
    .index("by_project_addedAt", ["projectId", "addedAt"]),
  timelineItemTranslations: defineTable({
    organizationId: v.string(),
    timelineItemId: v.id("projectTimelineItems"),
    field: v.string(),
    locale: v.string(),
    sourceHash: v.string(),
    text: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_timelineItem_locale_field", ["timelineItemId", "locale", "field"]),
  whatsappMediaAssetTranslations: defineTable({
    organizationId: v.string(),
    mediaAssetId: v.id("whatsappMediaAssets"),
    field: v.string(),
    locale: v.string(),
    sourceHash: v.string(),
    text: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_mediaAsset_locale_field", ["mediaAssetId", "locale", "field"]),
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
    actionType: vPendingActionType,
    status: vPendingActionStatus,
    payload: vPendingActionPayload,
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
  memberProfiles: defineTable({
    organizationId: v.string(),
    memberId: v.string(),
    userId: v.string(),
    memberType: v.union(v.literal("standard"), v.literal("phone_only")),
    displayName: v.string(),
    createdByUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_memberId", ["memberId"])
    .index("by_userId", ["userId"]),
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
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("expired")),
    stage: v.union(
      v.literal("awaiting_email"),
      v.literal("awaiting_password"),
      v.literal("awaiting_switch_selection"),
      v.literal("awaiting_unlink_confirmation"),
      v.literal("ready"),
    ),
    locale: vAppLocale,
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
        transcriptionLocale: v.optional(vAppLocale),
        transcriptionModel: v.optional(v.string()),
      }),
    ),
    turnStatus: v.union(v.literal("buffered"), v.literal("sent_to_agent"), v.literal("ignored")),
    documentationStatus: v.optional(
      v.union(v.literal("pending"), v.literal("batched"), v.literal("ignored")),
    ),
    detectedIntent: v.optional(
      v.union(v.literal("assistant"), v.literal("documentation"), v.literal("ambiguous")),
    ),
    documentationBatchId: v.optional(v.id("whatsappSendBatches")),
    createdAt: v.number(),
    sentToAgentAt: v.optional(v.number()),
  })
    .index("by_providerMessageSid", ["providerMessageSid"])
    .index("by_connection_createdAt", ["connectionId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_phone_createdAt", ["phoneNumberE164", "createdAt"]),
  whatsappMediaAssets: defineTable({
    organizationId: v.string(),
    messageId: v.id("whatsappMessages"),
    projectId: v.optional(v.id("projects")),
    batchId: v.id("whatsappSendBatches"),
    sourceProvider: v.literal("twilio"),
    sourceMediaUrl: v.string(),
    sourceIndex: v.number(),
    mimeType: v.string(),
    kind: timelineMediaKindValidator,
    storageId: v.id("_storage"),
    fileSize: v.optional(v.number()),
    transcript: v.optional(v.string()),
    extractedText: v.optional(v.string()),
    summary: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    fieldLocales: v.optional(mediaFieldLocalesValidator),
    processingStatus: v.union(v.literal("pending"), v.literal("processed"), v.literal("failed")),
    processingError: v.optional(v.string()),
    addedAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_batchId", ["batchId"])
    .index("by_project_addedAt", ["projectId", "addedAt"])
    .index("by_organization_addedAt", ["organizationId", "addedAt"]),
  whatsappSendBatches: defineTable({
    organizationId: v.string(),
    memberId: v.string(),
    userId: v.string(),
    phoneE164: v.string(),
    commandMessageSid: v.string(),
    commandFrom: v.string(),
    commandTo: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("awaiting_project_choice"),
      v.literal("awaiting_project_name"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    messageIds: v.array(v.id("whatsappMessages")),
    messageCount: v.number(),
    projectId: v.optional(v.id("projects")),
    projectMatchConfidence: v.optional(v.number()),
    projectMatchReason: v.optional(v.string()),
    candidateProjectIds: v.optional(v.array(v.id("projects"))),
    summary: v.optional(v.string()),
    nachtragEmailSentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_commandMessageSid", ["commandMessageSid"])
    .index("by_org_createdAt", ["organizationId", "createdAt"])
    .index("by_org_phone_status_createdAt", ["organizationId", "phoneE164", "status", "createdAt"]),
  whatsappPendingResolutions: defineTable({
    organizationId: v.string(),
    phoneE164: v.string(),
    memberId: v.string(),
    batchId: v.id("whatsappSendBatches"),
    state: v.union(v.literal("awaiting_choice"), v.literal("awaiting_project_name")),
    customerId: v.optional(v.id("customers")),
    options: v.optional(v.array(pendingResolutionOptionValidator)),
    aiSuggestedProjectName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batchId", ["batchId"])
    .index("by_org_phone_state", ["organizationId", "phoneE164", "state"]),
  whatsappTurnBuffers: defineTable({
    connectionId: v.id("whatsappConnections"),
    organizationId: v.string(),
    userId: v.string(),
    memberId: v.string(),
    threadId: v.string(),
    status: v.union(
      v.literal("buffering"),
      v.literal("awaiting_confirmation"),
      v.literal("awaiting_documentation_confirmation"),
    ),
    bufferedMessageIds: v.array(v.id("whatsappMessages")),
    firstBufferedAt: v.number(),
    lastBufferedAt: v.number(),
    readyPromptSentAt: v.optional(v.number()),
    documentationPromptSentAt: v.optional(v.number()),
    documentationReminderJobId: v.optional(v.id("_scheduled_functions")),
    updatedAt: v.number(),
  })
    .index("by_connectionId", ["connectionId"])
    .index("by_threadId", ["threadId"]),
});
