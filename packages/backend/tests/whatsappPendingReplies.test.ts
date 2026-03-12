import { describe, expect, test } from "bun:test";

import {
  handlePendingProjectResolution,
  processPendingClarification,
  resolvePendingReplyInput,
  shouldDeferMediaOnlyTurn,
} from "../convex/whatsapp";
import {
  documentationProjectChoiceMessage,
  pendingVoiceReplyTypingFallbackMessage,
} from "../convex/whatsapp/messages";

describe("whatsapp pending reply handling", () => {
  test("uses the typed body before attempting media transcription", async () => {
    let transcriptCalls = 0;

    const result = await resolvePendingReplyInput({
      body: "  Nikias Wohnung  ",
      locale: "de",
      media: [
        {
          mediaUrl: "https://example.com/audio.ogg",
          contentType: "audio/ogg",
        },
      ],
      resolveTranscript: async () => {
        transcriptCalls += 1;
        return "Ignored transcript";
      },
    });

    expect(result).toEqual({
      text: "Nikias Wohnung",
      source: "body",
      hadMedia: true,
      transcriptionAttempted: false,
    });
    expect(transcriptCalls).toBe(0);
  });

  test("falls back to transcribed media when the body is empty", async () => {
    const result = await resolvePendingReplyInput({
      body: "",
      locale: "de",
      media: [
        {
          mediaUrl: "https://example.com/audio.ogg",
          contentType: "audio/ogg",
        },
      ],
      resolveTranscript: async () => "Nikias Wohnung",
    });

    expect(result).toEqual({
      text: "Nikias Wohnung",
      source: "transcript",
      hadMedia: true,
      transcriptionAttempted: true,
    });
  });

  test("keeps media-only replies unresolved when transcription yields no text", async () => {
    const result = await resolvePendingReplyInput({
      body: "",
      locale: "de",
      media: [
        {
          mediaUrl: "https://example.com/audio.ogg",
          contentType: "audio/ogg",
        },
      ],
      resolveTranscript: async () => null,
    });

    expect(result).toEqual({
      text: "",
      source: "none",
      hadMedia: true,
      transcriptionAttempted: true,
    });
  });

  test("does not defer a voice-only turn when a transcript exists", () => {
    expect(
      shouldDeferMediaOnlyTurn({
        currentMessageHasMedia: true,
        hasAnyText: false,
        transcriptionText: "Bitte dokumentiere das fuer Nikias Wohnung",
      }),
    ).toBe(false);
  });

  test("still defers true media-only turns without text or transcript", () => {
    expect(
      shouldDeferMediaOnlyTurn({
        currentMessageHasMedia: true,
        hasAnyText: false,
        transcriptionText: null,
      }),
    ).toBe(true);
  });

  test("finalizes an awaiting project-name batch from a transcribed voice reply", async () => {
    const runActionCalls: Array<Record<string, unknown>> = [];
    const ctx = {
      runQuery: async () =>
        ({
          _id: "pending-1",
          organizationId: "org-1",
          phoneE164: "+491234",
          memberId: "member-1",
          batchId: "batch-1",
          state: "awaiting_project_name",
          customerId: "customer-1",
          aiSuggestedProjectName: "Nikias Wohnung",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }) as any,
      runMutation: async () => null,
      runAction: async (_ref: unknown, args: Record<string, unknown>) => {
        runActionCalls.push(args);
        return { message: "saved" };
      },
    };

    const result = await handlePendingProjectResolution({
      ctx,
      locale: "de",
      resolvePendingReplyInput: async () => ({
        text: "Nikias Wohnung",
        source: "transcript",
        hadMedia: true,
        transcriptionAttempted: true,
      }),
      connection: {
        _id: "connection-1",
        organizationId: "org-1",
        memberId: "member-1",
        userId: "user-1",
        phoneNumberE164: "+491234",
        phoneNumberDigits: "491234",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any,
    });

    expect(runActionCalls).toHaveLength(1);
    expect(runActionCalls[0]).toMatchObject({
      batchId: "batch-1",
      projectName: "Nikias Wohnung",
      customerId: "customer-1",
      locale: "de",
    });
    expect(result).toMatchObject({
      handled: true,
      reply: "saved",
      batchId: "batch-1",
      deliveryStage: "post_persistence",
    });
  });

  test("matches a transcribed project choice by project name", async () => {
    const runActionCalls: Array<Record<string, unknown>> = [];
    const ctx = {
      runQuery: async () =>
        ({
          _id: "pending-1",
          organizationId: "org-1",
          phoneE164: "+491234",
          memberId: "member-1",
          batchId: "batch-1",
          state: "awaiting_choice",
          options: [
            {
              projectId: "project-1",
              projectName: "Nikias Wohnung",
            },
            {
              projectId: "project-2",
              projectName: "Bornstedter Straße",
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }) as any,
      runMutation: async () => null,
      runAction: async (_ref: unknown, args: Record<string, unknown>) => {
        runActionCalls.push(args);
        return { message: "saved" };
      },
    };

    const result = await handlePendingProjectResolution({
      ctx,
      locale: "de",
      resolvePendingReplyInput: async () => ({
        text: "Nikias Wohnung",
        source: "transcript",
        hadMedia: true,
        transcriptionAttempted: true,
      }),
      connection: {
        _id: "connection-1",
        organizationId: "org-1",
        memberId: "member-1",
        userId: "user-1",
        phoneNumberE164: "+491234",
        phoneNumberDigits: "491234",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any,
    });

    expect(runActionCalls).toHaveLength(1);
    expect(runActionCalls[0]).toMatchObject({
      batchId: "batch-1",
      projectId: "project-1",
      locale: "de",
    });
    expect(result).toMatchObject({
      handled: true,
      reply: "saved",
      batchId: "batch-1",
      deliveryStage: "post_persistence",
    });
  });

  test("asks for a typed reply when a media-only project choice cannot be transcribed", async () => {
    const ctx = {
      runQuery: async () =>
        ({
          _id: "pending-1",
          organizationId: "org-1",
          phoneE164: "+491234",
          memberId: "member-1",
          batchId: "batch-1",
          state: "awaiting_choice",
          options: [
            {
              projectId: "project-1",
              projectName: "Nikias Wohnung",
            },
          ],
          aiSuggestedProjectName: "Nikias Wohnung",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }) as any,
      runMutation: async () => null,
      runAction: async () => {
        throw new Error("should not run");
      },
    };

    const result = await handlePendingProjectResolution({
      ctx,
      locale: "de",
      resolvePendingReplyInput: async () => ({
        text: "",
        source: "none",
        hadMedia: true,
        transcriptionAttempted: true,
      }),
      connection: {
        _id: "connection-1",
        organizationId: "org-1",
        memberId: "member-1",
        userId: "user-1",
        phoneNumberE164: "+491234",
        phoneNumberDigits: "491234",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any,
    });

    expect(result).toMatchObject({
      handled: true,
      batchId: "batch-1",
      deliveryStage: "pre_persistence",
    });
    expect(result.reply).toContain(pendingVoiceReplyTypingFallbackMessage("de"));
    expect(result.reply).toContain(
      documentationProjectChoiceMessage({
        locale: "de",
        projects: [{ name: "Nikias Wohnung" }],
        suggestedProjectName: "Nikias Wohnung",
      }),
    );
  });

  test("accepts a transcribed clarification reply", async () => {
    const runMutationCalls: Array<Record<string, unknown>> = [];
    const runActionCalls: Array<Record<string, unknown>> = [];
    const ctx = {
      runQuery: async () =>
        ({
          id: "clarification-1",
          status: "pending",
          prompt: "Original prompt",
          assistantMessage: "Need clarification",
          questions: [
            {
              id: "question_1",
              prompt: "Which option?",
              options: [
                { id: "one", label: "Option one", description: "desc" },
                { id: "two", label: "Option two", description: "desc" },
              ],
              required: true,
            },
          ],
          expiresAt: Date.now() + 60_000,
        }) as any,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        runMutationCalls.push(args);
        return null;
      },
      runAction: async (_ref: unknown, args: Record<string, unknown>) => {
        runActionCalls.push(args);
        return null;
      },
    };

    const result = await processPendingClarification({
      ctx,
      locale: "en",
      resolvePendingReplyInput: async () => ({
        text: "1",
        source: "transcript",
        hadMedia: true,
        transcriptionAttempted: true,
      }),
      threadId: "thread-1",
      organizationId: "org-1",
      userId: "user-1",
      memberId: "member-1",
    });

    expect(result).toEqual({
      handled: true,
      reply: null,
    });
    expect(runMutationCalls).toHaveLength(1);
    expect(runMutationCalls[0]).toMatchObject({
      clarificationSessionId: "clarification-1",
      status: "answered",
    });
    expect(runActionCalls).toHaveLength(1);
    expect(runActionCalls[0]).toMatchObject({
      threadId: "thread-1",
      organizationId: "org-1",
      userId: "user-1",
      memberId: "member-1",
      locale: "en",
    });
  });
});
