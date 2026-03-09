import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { authComponent } from "./auth";
import {
  MAX_CHAT_HISTORY_MESSAGES,
  GENERATION_CONTEXT_LOOKBACK_MS,
  GENERATION_CONTEXT_MAX_MESSAGES,
  GENERATION_CONTEXT_MIN_MESSAGES,
  getMastraResourceId,
  getMastraThreadId,
  vMastraChatMessageType,
  vMastraChatRole,
  vMastraChatRunStatus,
  vMastraChatStreamActor,
  vMastraChatStreamPhase,
} from "./mastraComponent/constants";
import {
  toDisplayText,
  toGenerationContent,
} from "./mastraComponent/serialization";

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
};

const vPersistedMessageInput = v.object({
  messageId: v.string(),
  role: vMastraChatRole,
  type: vMastraChatMessageType,
  content: v.any(),
  text: v.string(),
  attachmentNames: v.array(v.string()),
  createdAt: v.number(),
});

const vChatMessage = v.object({
  id: v.string(),
  threadOrder: v.number(),
  role: vMastraChatRole,
  type: vMastraChatMessageType,
  createdAt: v.number(),
  text: v.string(),
  content: v.any(),
  attachmentNames: v.array(v.string()),
});

const vChatThreadSummary = v.object({
  threadId: v.string(),
  channel: v.union(v.literal("web"), v.literal("whatsapp")),
  memberId: v.union(v.string(), v.null()),
  title: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastSeenUpdatedAt: v.union(v.number(), v.null()),
});

const vPendingActionType = v.literal("delete-organization");
const vPendingActionStatus = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("canceled"),
  v.literal("expired"),
);
const vPendingActionPayload = v.object({
  organizationId: v.string(),
  organizationName: v.optional(v.string()),
});

const vPendingAction = v.object({
  id: v.id("aiPendingActions"),
  actionType: vPendingActionType,
  payload: vPendingActionPayload,
  expiresAt: v.number(),
  createdAt: v.number(),
});

const vClarificationIntent = v.union(
  v.literal("generic"),
  v.literal("invite_member"),
  v.literal("remove_member"),
  v.literal("update_member_role"),
  v.literal("cancel_invitation"),
  v.literal("update_organization"),
);
const vClarificationStatus = v.union(
  v.literal("pending"),
  v.literal("answered"),
  v.literal("canceled"),
  v.literal("expired"),
);
const vClarificationQuestionOption = v.object({
  id: v.string(),
  label: v.string(),
  description: v.string(),
});
const vClarificationQuestion = v.object({
  id: v.string(),
  prompt: v.string(),
  options: v.array(vClarificationQuestionOption),
  allowOther: v.boolean(),
  required: v.boolean(),
});
const vPendingClarification = v.object({
  id: v.id("aiClarificationSessions"),
  intent: vClarificationIntent,
  title: v.string(),
  description: v.string(),
  assistantMessage: v.string(),
  questions: v.array(vClarificationQuestion),
  expiresAt: v.number(),
  createdAt: v.number(),
});
const vChatSeenState = v.object({
  threadId: v.string(),
  threadUpdatedAt: v.number(),
  lastSeenUpdatedAt: v.union(v.number(), v.null()),
});

function sortMessages<T extends { createdAt: number; messageId: string }>(
  messages: T[],
) {
  return messages.sort((messageA, messageB) => {
    if (messageA.createdAt === messageB.createdAt) {
      return messageA.messageId.localeCompare(messageB.messageId);
    }
    return messageA.createdAt - messageB.createdAt;
  });
}

function normalizeCreatedAt(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMessageText(message: {
  type: "text" | "tool-call" | "tool-result";
  text: string;
  content: unknown;
}) {
  if (message.text && message.text.trim().length > 0) {
    return message.text;
  }

  return toDisplayText({
    type: message.type,
    content: message.content,
  });
}

function areArraysEqual(valuesA: string[], valuesB: string[]) {
  if (valuesA.length !== valuesB.length) {
    return false;
  }

  return valuesA.every((value, index) => value === valuesB[index]);
}

function areValuesEqual(valueA: unknown, valueB: unknown) {
  try {
    return JSON.stringify(valueA) === JSON.stringify(valueB);
  } catch {
    return false;
  }
}

function createThreadId(options: { organizationId: string; userId: string }) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `${getMastraThreadId(options)}:${Date.now()}:${suffix}`;
}

function getNextThreadUpdatedAt(previousUpdatedAt: number | undefined, now: number) {
  return Math.max(now, (previousUpdatedAt ?? 0) + 1);
}

function toChatMessage(message: {
  messageId: string;
  threadOrder: number;
  role: "system" | "user" | "assistant" | "tool";
  type: "text" | "tool-call" | "tool-result";
  createdAt: number;
  _creationTime: number;
  text: string;
  content: unknown;
  attachmentNames: string[];
}) {
  return {
    id: message.messageId,
    threadOrder: message.threadOrder,
    role: message.role,
    type: message.type,
    createdAt: normalizeCreatedAt(message.createdAt, message._creationTime),
    text: normalizeMessageText({
      type: message.type,
      text: message.text,
      content: message.content,
    }),
    content: message.content,
    attachmentNames: message.attachmentNames,
  };
}

export const getChatRuntimeState = query({
  args: {
    organizationId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    runStatus: vMastraChatRunStatus,
    lastError: v.union(v.string(), v.null()),
    streamingText: v.union(v.string(), v.null()),
    streamPhase: vMastraChatStreamPhase,
    streamActor: vMastraChatStreamActor,
    activeToolLabel: v.union(v.string(), v.null()),
    pendingAction: v.union(vPendingAction, v.null()),
    pendingClarification: v.union(vPendingClarification, v.null()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const defaultThreadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const threadId = args.threadId ?? defaultThreadId;
    const existingThread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== authUser._id)
    ) {
      throw new Error("You do not have access to this chat thread");
    }

    const runState = await ctx.db
      .query("chatThreadStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();

    const latestPendingAction = await ctx.db
      .query("aiPendingActions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    const pendingAction =
      latestPendingAction && latestPendingAction.expiresAt > Date.now()
        ? {
            id: latestPendingAction._id,
            actionType: latestPendingAction.actionType,
            payload: latestPendingAction.payload,
            expiresAt: latestPendingAction.expiresAt,
            createdAt: latestPendingAction.createdAt,
          }
        : null;

    const latestPendingClarification = await ctx.db
      .query("aiClarificationSessions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    const pendingClarification =
      latestPendingClarification && latestPendingClarification.expiresAt > Date.now()
        ? {
            id: latestPendingClarification._id,
            intent: latestPendingClarification.intent,
            title: latestPendingClarification.title,
            description: latestPendingClarification.description,
            assistantMessage: latestPendingClarification.assistantMessage,
            questions: latestPendingClarification.questions,
            expiresAt: latestPendingClarification.expiresAt,
            createdAt: latestPendingClarification.createdAt,
          }
        : null;

    return {
      threadId,
      runStatus: runState?.status ?? "idle",
      lastError: runState?.lastError ?? null,
      streamingText: runState?.streamingText ?? null,
      streamPhase: runState?.streamPhase ?? "idle",
      streamActor: runState?.streamActor ?? "main",
      activeToolLabel: runState?.activeToolLabel ?? null,
      pendingAction,
      pendingClarification,
    };
  },
});

export const listChatMessages = query({
  args: {
    organizationId: v.string(),
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vChatMessage),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const defaultThreadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const threadId = args.threadId ?? defaultThreadId;
    const existingThread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== authUser._id)
    ) {
      throw new Error("You do not have access to this chat thread");
    }

    const paginatedResult = await ctx.db
      .query("agentChatMessages")
      .withIndex("by_threadId_order", (q) => q.eq("threadId", threadId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...paginatedResult,
      page: paginatedResult.page.map((message) => toChatMessage(message)),
    };
  },
});

export const getChatState = query({
  args: {
    organizationId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    runStatus: vMastraChatRunStatus,
    lastError: v.union(v.string(), v.null()),
    streamingText: v.union(v.string(), v.null()),
    streamPhase: vMastraChatStreamPhase,
    streamActor: vMastraChatStreamActor,
    activeToolLabel: v.union(v.string(), v.null()),
    pendingAction: v.union(vPendingAction, v.null()),
    pendingClarification: v.union(vPendingClarification, v.null()),
    messages: v.array(
      v.object({
        id: v.string(),
        role: vMastraChatRole,
        type: vMastraChatMessageType,
        createdAt: v.number(),
        text: v.string(),
        content: v.any(),
        attachmentNames: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const defaultThreadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const threadId = args.threadId ?? defaultThreadId;
    const existingThread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== authUser._id)
    ) {
      throw new Error("You do not have access to this chat thread");
    }

    const recentMessages = await ctx.db
      .query("agentChatMessages")
      .withIndex("by_threadId_order", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(MAX_CHAT_HISTORY_MESSAGES);

    const orderedMessages = recentMessages.slice().reverse();

    const runState = await ctx.db
      .query("chatThreadStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();

    const latestPendingAction = await ctx.db
      .query("aiPendingActions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    const pendingAction =
      latestPendingAction && latestPendingAction.expiresAt > Date.now()
        ? {
            id: latestPendingAction._id,
            actionType: latestPendingAction.actionType,
            payload: latestPendingAction.payload,
            expiresAt: latestPendingAction.expiresAt,
            createdAt: latestPendingAction.createdAt,
          }
        : null;

    const latestPendingClarification = await ctx.db
      .query("aiClarificationSessions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    const pendingClarification =
      latestPendingClarification && latestPendingClarification.expiresAt > Date.now()
        ? {
            id: latestPendingClarification._id,
            intent: latestPendingClarification.intent,
            title: latestPendingClarification.title,
            description: latestPendingClarification.description,
            assistantMessage: latestPendingClarification.assistantMessage,
            questions: latestPendingClarification.questions,
            expiresAt: latestPendingClarification.expiresAt,
            createdAt: latestPendingClarification.createdAt,
          }
        : null;

    return {
      threadId,
      runStatus: runState?.status ?? "idle",
      lastError: runState?.lastError ?? null,
      streamingText: runState?.streamingText ?? null,
      streamPhase: runState?.streamPhase ?? "idle",
      streamActor: runState?.streamActor ?? "main",
      activeToolLabel: runState?.activeToolLabel ?? null,
      pendingAction,
      pendingClarification,
      messages: orderedMessages.map((message) => ({
        id: message.messageId,
        role: message.role,
        type: message.type,
        createdAt: normalizeCreatedAt(message.createdAt, message._creationTime),
        text: normalizeMessageText({
          type: message.type,
          text: message.text,
          content: message.content,
        }),
        content: message.content,
        attachmentNames: message.attachmentNames,
      })),
    };
  },
});

export const createChatThread = mutation({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    threadId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const now = Date.now();
    const threadId = createThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const resourceId = getMastraResourceId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    await ctx.db.insert("agentChatThreads", {
      threadId,
      resourceId,
      organizationId: args.organizationId,
      userId: authUser._id,
      channel: "web",
      lastSeenUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return {
      threadId,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const listChatThreads = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(vChatThreadSummary),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const resourceId = getMastraResourceId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    const threads = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_resourceId", (q) => q.eq("resourceId", resourceId))
      .collect();

    return threads
      .filter(
        (thread) =>
          thread.organizationId === args.organizationId &&
          thread.userId === authUser._id,
      )
      .sort((threadA, threadB) => {
        if (threadA.updatedAt === threadB.updatedAt) {
          return threadB.createdAt - threadA.createdAt;
        }
        return threadB.updatedAt - threadA.updatedAt;
      })
      .map((thread) => ({
        threadId: thread.threadId,
        channel: thread.channel ?? "web",
        memberId: thread.memberId ?? null,
        title: thread.title ?? null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastSeenUpdatedAt: thread.lastSeenUpdatedAt ?? null,
      }));
  },
});

export const hasUnreadChatUpdates = query({
  args: {
    organizationId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    if (args.organizationId) {
      const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

      if (!membership) {
        throw new Error("You do not have access to this organization");
      }
    }

    const threads = await ctx.db.query("agentChatThreads").collect();
    const scopedThreads = threads.filter(
      (thread) =>
        thread.userId === authUser._id &&
        (thread.channel ?? "web") !== "whatsapp" &&
        (!args.organizationId || thread.organizationId === args.organizationId),
    );

    for (const thread of scopedThreads) {
      const lastSeenUpdatedAt = thread.lastSeenUpdatedAt ?? 0;
      const latestAssistantMessage = await ctx.db
        .query("agentChatMessages")
        .withIndex("by_threadId_order", (q) => q.eq("threadId", thread.threadId))
        .filter((q) => q.eq(q.field("role"), "assistant"))
        .order("desc")
        .first();

      if (!latestAssistantMessage) {
        continue;
      }

      const assistantMessageCreatedAt = normalizeCreatedAt(
        latestAssistantMessage.createdAt,
        latestAssistantMessage._creationTime,
      );
      if (assistantMessageCreatedAt > lastSeenUpdatedAt) {
        return true;
      }
    }

    return false;
  },
});

export const getChatSeenState = query({
  args: {
    organizationId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.union(vChatSeenState, v.null()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const defaultThreadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const threadId = args.threadId ?? defaultThreadId;
    const existingThread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== authUser._id)
    ) {
      throw new Error("You do not have access to this chat thread");
    }

    if (!existingThread) {
      return null;
    }

    return {
      threadId: existingThread.threadId,
      threadUpdatedAt: existingThread.updatedAt,
      lastSeenUpdatedAt: existingThread.lastSeenUpdatedAt ?? null,
    };
  },
});

export const markChatSeenState = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.optional(v.string()),
    seenUpToUpdatedAt: v.number(),
  },
  returns: v.union(vChatSeenState, v.null()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const defaultThreadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });
    const threadId = args.threadId ?? defaultThreadId;
    const existingThread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== authUser._id)
    ) {
      throw new Error("You do not have access to this chat thread");
    }

    if (!existingThread) {
      return null;
    }

    const seenUpToUpdatedAt = Number.isFinite(args.seenUpToUpdatedAt)
      ? args.seenUpToUpdatedAt
      : 0;
    const nextSeenTimestamp = Math.min(existingThread.updatedAt, seenUpToUpdatedAt);
    const previousSeenTimestamp = existingThread.lastSeenUpdatedAt ?? 0;
    const seenTimestamp = Math.max(previousSeenTimestamp, nextSeenTimestamp);

    await ctx.db.patch(existingThread._id, {
      lastSeenUpdatedAt: seenTimestamp,
    });

    return {
      threadId,
      threadUpdatedAt: existingThread.updatedAt,
      lastSeenUpdatedAt: seenTimestamp,
    };
  },
});

export const getChatThreadById = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.object({
      threadId: v.string(),
      resourceId: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      channel: v.union(v.literal("web"), v.literal("whatsapp")),
      memberId: v.union(v.string(), v.null()),
      title: v.union(v.string(), v.null()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread) {
      return null;
    }

    return {
      threadId: thread.threadId,
      resourceId: thread.resourceId,
      organizationId: thread.organizationId,
      userId: thread.userId,
      channel: thread.channel ?? "web",
      memberId: thread.memberId ?? null,
      title: thread.title ?? null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  },
});

export const getMessagesForGeneration = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      role: vMastraChatRole,
      type: vMastraChatMessageType,
      content: v.any(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const newestMessages = await ctx.db
      .query("agentChatMessages")
      .withIndex("by_threadId_order", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(GENERATION_CONTEXT_MAX_MESSAGES);

    const now = Date.now();
    const lookbackThreshold = now - GENERATION_CONTEXT_LOOKBACK_MS;

    return newestMessages
      .filter((message, index) => {
        if (index < GENERATION_CONTEXT_MIN_MESSAGES) {
          return true;
        }

        const createdAt = normalizeCreatedAt(message.createdAt, message._creationTime);
        return createdAt >= lookbackThreshold;
      })
      .slice()
      .reverse()
      .map((message) => ({
        id: message.messageId,
        role: message.role,
        type: message.type,
        content: toGenerationContent({
          type: message.type,
          content: message.content,
          text: message.text,
        }),
        createdAt: normalizeCreatedAt(message.createdAt, message._creationTime),
      }));
  },
});

export const upsertGeneratedMessages = internalMutation({
  args: {
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    channel: v.optional(v.union(v.literal("web"), v.literal("whatsapp"))),
    memberId: v.optional(v.string()),
    title: v.optional(v.string()),
    messages: v.array(vPersistedMessageInput),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    let existingThread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (
      existingThread &&
      (existingThread.organizationId !== args.organizationId ||
        existingThread.userId !== args.userId ||
        existingThread.resourceId !== args.resourceId ||
        ((existingThread.channel ?? "web") !== (args.channel ?? "web")))
    ) {
      throw new Error("Invalid chat thread id");
    }

    if (!existingThread) {
      const threadId = await ctx.db.insert("agentChatThreads", {
        threadId: args.threadId,
        resourceId: args.resourceId,
        organizationId: args.organizationId,
        userId: args.userId,
        channel: args.channel ?? "web",
        memberId: args.memberId,
        title: args.title,
        createdAt: now,
        updatedAt: now,
      });
      existingThread = await ctx.db.get(threadId);
    }

    const lastStoredMessage = await ctx.db
      .query("agentChatMessages")
      .withIndex("by_threadId_order", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();

    let nextThreadOrder = lastStoredMessage?.threadOrder ?? 0;

    const incomingMessages = sortMessages(
      args.messages.slice().map((message) => ({
        ...message,
      })),
    );

    for (const message of incomingMessages) {
      const normalizedText = normalizeMessageText({
        type: message.type,
        text: message.text,
        content: message.content,
      });
      const normalizedCreatedAt = normalizeCreatedAt(message.createdAt, now);
      const normalizedAttachmentNames = message.attachmentNames.filter(
        (attachmentName) => attachmentName.trim().length > 0,
      );

      const existingMessage = await ctx.db
        .query("agentChatMessages")
        .withIndex("by_threadId_messageId", (q) =>
          q.eq("threadId", args.threadId).eq("messageId", message.messageId),
        )
        .unique();

      if (existingMessage) {
        const shouldPatch =
          existingMessage.role !== message.role ||
          existingMessage.type !== message.type ||
          existingMessage.text !== normalizedText ||
          !areArraysEqual(existingMessage.attachmentNames, normalizedAttachmentNames) ||
          !areValuesEqual(existingMessage.content, message.content) ||
          existingMessage.createdAt !== normalizedCreatedAt;

        if (shouldPatch) {
          await ctx.db.patch(existingMessage._id, {
            role: message.role,
            type: message.type,
            content: message.content,
            text: normalizedText,
            attachmentNames: normalizedAttachmentNames,
            createdAt: normalizedCreatedAt,
          });
        }

        continue;
      }

      nextThreadOrder += 1;
      await ctx.db.insert("agentChatMessages", {
        messageId: message.messageId,
        threadId: args.threadId,
        threadOrder: nextThreadOrder,
        role: message.role,
        type: message.type,
        content: message.content,
        text: normalizedText,
        attachmentNames: normalizedAttachmentNames,
        createdAt: normalizedCreatedAt,
      });
    }

    if (existingThread) {
      const nextUpdatedAt = getNextThreadUpdatedAt(existingThread.updatedAt, now);
      await ctx.db.patch(existingThread._id, {
        updatedAt: nextUpdatedAt,
        channel: existingThread.channel ?? (args.channel ?? "web"),
        memberId: existingThread.memberId ?? args.memberId,
        title: args.title ?? existingThread.title,
      });
    }

    return null;
  },
});

export const setChatThreadState = internalMutation({
  args: {
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    status: vMastraChatRunStatus,
    lastError: v.union(v.string(), v.null()),
    lastRunId: v.union(v.string(), v.null()),
    streamingText: v.union(v.string(), v.null()),
    streamPhase: vMastraChatStreamPhase,
    streamActor: vMastraChatStreamActor,
    activeToolLabel: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingState = await ctx.db
      .query("chatThreadStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    const patch = {
      threadId: args.threadId,
      resourceId: args.resourceId,
      organizationId: args.organizationId,
      userId: args.userId,
      status: args.status,
      lastError: args.lastError,
      lastRunId: args.lastRunId,
      streamingText: args.streamingText,
      streamPhase: args.streamPhase,
      streamActor: args.streamActor,
      activeToolLabel: args.activeToolLabel,
      updatedAt: Date.now(),
    };

    if (existingState) {
      await ctx.db.patch(existingState._id, patch);
      return null;
    }

    await ctx.db.insert("chatThreadStates", patch);
    return null;
  },
});

export const upsertPendingDeleteOrganizationAction = internalMutation({
  args: {
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    payload: vPendingActionPayload,
    expiresAt: v.number(),
  },
  returns: v.object({
    pendingActionId: v.id("aiPendingActions"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const thread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (
      thread &&
      (thread.organizationId !== args.organizationId ||
        thread.userId !== args.userId ||
        thread.resourceId !== args.resourceId)
    ) {
      throw new Error("Invalid chat thread id");
    }

    const existingPendingAction = await ctx.db
      .query("aiPendingActions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    if (
      existingPendingAction &&
      existingPendingAction.actionType === "delete-organization" &&
      existingPendingAction.expiresAt > now
    ) {
      await ctx.db.patch(existingPendingAction._id, {
        payload: args.payload,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
      if (thread) {
        const nextUpdatedAt = getNextThreadUpdatedAt(thread.updatedAt, now);
        await ctx.db.patch(thread._id, {
          updatedAt: nextUpdatedAt,
        });
      }

      return {
        pendingActionId: existingPendingAction._id,
        expiresAt: args.expiresAt,
      };
    }

    if (existingPendingAction && existingPendingAction.expiresAt <= now) {
      await ctx.db.patch(existingPendingAction._id, {
        status: "expired",
        updatedAt: now,
        resolvedAt: now,
      });
    }

    const pendingActionId = await ctx.db.insert("aiPendingActions", {
      threadId: args.threadId,
      resourceId: args.resourceId,
      organizationId: args.organizationId,
      userId: args.userId,
      actionType: "delete-organization",
      status: "pending",
      payload: args.payload,
      createdAt: now,
      updatedAt: now,
      expiresAt: args.expiresAt,
    });
    if (thread) {
      const nextUpdatedAt = getNextThreadUpdatedAt(thread.updatedAt, now);
      await ctx.db.patch(thread._id, {
        updatedAt: nextUpdatedAt,
      });
    }

    return {
      pendingActionId,
      expiresAt: args.expiresAt,
    };
  },
});

export const getPendingActionById = internalQuery({
  args: {
    pendingActionId: v.id("aiPendingActions"),
  },
  returns: v.union(
    v.object({
      id: v.id("aiPendingActions"),
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
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const pendingAction = await ctx.db.get(args.pendingActionId);
    if (!pendingAction) {
      return null;
    }

    return {
      id: pendingAction._id,
      threadId: pendingAction.threadId,
      resourceId: pendingAction.resourceId,
      organizationId: pendingAction.organizationId,
      userId: pendingAction.userId,
      actionType: pendingAction.actionType,
      status: pendingAction.status,
      payload: pendingAction.payload,
      createdAt: pendingAction.createdAt,
      updatedAt: pendingAction.updatedAt,
      expiresAt: pendingAction.expiresAt,
      resolvedAt: pendingAction.resolvedAt,
    };
  },
});

export const resolvePendingAction = internalMutation({
  args: {
    pendingActionId: v.id("aiPendingActions"),
    status: v.union(
      v.literal("confirmed"),
      v.literal("canceled"),
      v.literal("expired"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pendingAction = await ctx.db.get(args.pendingActionId);
    if (!pendingAction) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.pendingActionId, {
      status: args.status,
      updatedAt: now,
      resolvedAt: now,
    });
    const thread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", pendingAction.threadId))
      .unique();
    if (thread) {
      const nextUpdatedAt = getNextThreadUpdatedAt(thread.updatedAt, now);
      await ctx.db.patch(thread._id, {
        updatedAt: nextUpdatedAt,
      });
    }

    return null;
  },
});

export const upsertPendingClarificationSession = internalMutation({
  args: {
    threadId: v.string(),
    resourceId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    intent: vClarificationIntent,
    contextVersion: v.string(),
    prompt: v.string(),
    title: v.string(),
    description: v.string(),
    assistantMessage: v.string(),
    questions: v.array(vClarificationQuestion),
    expiresAt: v.number(),
  },
  returns: v.object({
    clarificationSessionId: v.id("aiClarificationSessions"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const thread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (
      thread &&
      (thread.organizationId !== args.organizationId ||
        thread.userId !== args.userId ||
        thread.resourceId !== args.resourceId)
    ) {
      throw new Error("Invalid chat thread id");
    }

    const existingPendingSession = await ctx.db
      .query("aiClarificationSessions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    if (existingPendingSession && existingPendingSession.expiresAt > now) {
      await ctx.db.patch(existingPendingSession._id, {
        intent: args.intent,
        contextVersion: args.contextVersion,
        prompt: args.prompt,
        title: args.title,
        description: args.description,
        assistantMessage: args.assistantMessage,
        questions: args.questions,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
      if (thread) {
        const nextUpdatedAt = getNextThreadUpdatedAt(thread.updatedAt, now);
        await ctx.db.patch(thread._id, {
          updatedAt: nextUpdatedAt,
        });
      }

      return {
        clarificationSessionId: existingPendingSession._id,
        expiresAt: args.expiresAt,
      };
    }

    if (existingPendingSession && existingPendingSession.expiresAt <= now) {
      await ctx.db.patch(existingPendingSession._id, {
        status: "expired",
        updatedAt: now,
        resolvedAt: now,
      });
    }

    const clarificationSessionId = await ctx.db.insert("aiClarificationSessions", {
      threadId: args.threadId,
      resourceId: args.resourceId,
      organizationId: args.organizationId,
      userId: args.userId,
      status: "pending",
      intent: args.intent,
      contextVersion: args.contextVersion,
      prompt: args.prompt,
      title: args.title,
      description: args.description,
      assistantMessage: args.assistantMessage,
      questions: args.questions,
      createdAt: now,
      updatedAt: now,
      expiresAt: args.expiresAt,
    });
    if (thread) {
      const nextUpdatedAt = getNextThreadUpdatedAt(thread.updatedAt, now);
      await ctx.db.patch(thread._id, {
        updatedAt: nextUpdatedAt,
      });
    }

    return {
      clarificationSessionId,
      expiresAt: args.expiresAt,
    };
  },
});

export const getClarificationSessionById = internalQuery({
  args: {
    clarificationSessionId: v.id("aiClarificationSessions"),
  },
  returns: v.union(
    v.object({
      id: v.id("aiClarificationSessions"),
      threadId: v.string(),
      resourceId: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      status: vClarificationStatus,
      intent: vClarificationIntent,
      contextVersion: v.string(),
      prompt: v.string(),
      title: v.string(),
      description: v.string(),
      assistantMessage: v.string(),
      questions: v.array(vClarificationQuestion),
      answers: v.optional(v.record(v.string(), v.string())),
      resumePrompt: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
      resolvedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.clarificationSessionId);
    if (!session) {
      return null;
    }

    return {
      id: session._id,
      threadId: session.threadId,
      resourceId: session.resourceId,
      organizationId: session.organizationId,
      userId: session.userId,
      status: session.status,
      intent: session.intent,
      contextVersion: session.contextVersion,
      prompt: session.prompt,
      title: session.title,
      description: session.description,
      assistantMessage: session.assistantMessage,
      questions: session.questions,
      answers: session.answers,
      resumePrompt: session.resumePrompt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      resolvedAt: session.resolvedAt,
    };
  },
});

export const getLatestPendingClarificationByThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.id("aiClarificationSessions"),
      threadId: v.string(),
      resourceId: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      status: vClarificationStatus,
      intent: vClarificationIntent,
      contextVersion: v.string(),
      prompt: v.string(),
      title: v.string(),
      description: v.string(),
      assistantMessage: v.string(),
      questions: v.array(vClarificationQuestion),
      answers: v.optional(v.record(v.string(), v.string())),
      resumePrompt: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
      resolvedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const latestSession = await ctx.db
      .query("aiClarificationSessions")
      .withIndex("by_thread_status_createdAt", (q) =>
        q.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();

    if (!latestSession) {
      return null;
    }

    return {
      id: latestSession._id,
      threadId: latestSession.threadId,
      resourceId: latestSession.resourceId,
      organizationId: latestSession.organizationId,
      userId: latestSession.userId,
      status: latestSession.status,
      intent: latestSession.intent,
      contextVersion: latestSession.contextVersion,
      prompt: latestSession.prompt,
      title: latestSession.title,
      description: latestSession.description,
      assistantMessage: latestSession.assistantMessage,
      questions: latestSession.questions,
      answers: latestSession.answers,
      resumePrompt: latestSession.resumePrompt,
      createdAt: latestSession.createdAt,
      updatedAt: latestSession.updatedAt,
      expiresAt: latestSession.expiresAt,
      resolvedAt: latestSession.resolvedAt,
    };
  },
});

export const resolveClarificationSession = internalMutation({
  args: {
    clarificationSessionId: v.id("aiClarificationSessions"),
    status: v.union(
      v.literal("answered"),
      v.literal("canceled"),
      v.literal("expired"),
    ),
    answers: v.optional(v.record(v.string(), v.string())),
    resumePrompt: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.clarificationSessionId);
    if (!session) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.clarificationSessionId, {
      status: args.status,
      answers: args.answers,
      resumePrompt: args.resumePrompt,
      updatedAt: now,
      resolvedAt: now,
    });
    const thread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", session.threadId))
      .unique();
    if (thread) {
      const nextUpdatedAt = getNextThreadUpdatedAt(thread.updatedAt, now);
      await ctx.db.patch(thread._id, {
        updatedAt: nextUpdatedAt,
      });
    }

    return null;
  },
});

export const clearChatHistory = mutation({
  args: {
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in");
    }

    const membership = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
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

    if (!membership) {
      throw new Error("You do not have access to this organization");
    }

    const threadId = getMastraThreadId({
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    const messages = await ctx.db
      .query("agentChatMessages")
      .withIndex("by_threadId_order", (q) => q.eq("threadId", threadId))
      .collect();
    await Promise.all(messages.map((message) => ctx.db.delete(message._id)));

    const thread = await ctx.db
      .query("agentChatThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (thread) {
      await ctx.db.delete(thread._id);
    }

    const runState = await ctx.db
      .query("chatThreadStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (runState) {
      await ctx.db.delete(runState._id);
    }

    const pendingActions = await ctx.db
      .query("aiPendingActions")
      .withIndex("by_thread_status", (q) => q.eq("threadId", threadId))
      .collect();
    await Promise.all(
      pendingActions.map((pendingAction) => ctx.db.delete(pendingAction._id)),
    );

    const clarificationSessions = await ctx.db
      .query("aiClarificationSessions")
      .withIndex("by_thread_status", (q) => q.eq("threadId", threadId))
      .collect();
    await Promise.all(
      clarificationSessions.map((session) => ctx.db.delete(session._id)),
    );

    return null;
  },
});
