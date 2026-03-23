import { afterEach, describe, expect, test } from "bun:test";

import {
  bufferHasDocumentableMedia,
  doesBufferedTurnStillMatchMessageSet,
  handlePendingProjectResolution,
  processPendingClarification,
  resolvePendingReplyInput,
  shouldKeepBufferedDocumentationTurn,
  shouldDeliverBufferedTurnResponse,
  shouldDeferMediaOnlyTurn,
} from "../convex/whatsapp";
import {
  documentationProjectChoiceMessage,
  formatProjectChoiceOption,
  pendingVoiceReplyTypingFallbackMessage,
} from "../convex/whatsapp/messages";

const originalFetch = globalThis.fetch;
const originalVoyageApiKey = process.env.VOYAGE_API_KEY;

function mockVoyageEmbeddings(
  resolver: (input: string, inputType: "query" | "document") => number[],
) {
  process.env.VOYAGE_API_KEY = "test-voyage-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      input?: string[];
      input_type?: "query" | "document";
    };
    const inputs = Array.isArray(payload.input) ? payload.input : [];
    const inputType = payload.input_type === "query" ? "query" : "document";

    return new Response(
      JSON.stringify({
        data: inputs.map((input, index) => ({
          index,
          embedding: resolver(input, inputType),
        })),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalVoyageApiKey === undefined) {
    delete process.env.VOYAGE_API_KEY;
  } else {
    process.env.VOYAGE_API_KEY = originalVoyageApiKey;
  }
});

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

  test("treats application/ogg voice notes as transcribable media", async () => {
    const result = await resolvePendingReplyInput({
      body: "",
      locale: "de",
      media: [
        {
          mediaUrl: "https://example.com/voice-note",
          contentType: "application/ogg",
        },
      ],
      resolveTranscript: async () => "Sprachnachricht erkannt",
    });

    expect(result).toEqual({
      text: "Sprachnachricht erkannt",
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

  test("keeps media-only replies unresolved when transcription throws", async () => {
    const result = await resolvePendingReplyInput({
      body: "",
      locale: "de",
      media: [
        {
          mediaUrl: "https://example.com/audio.ogg",
          contentType: "audio/ogg",
        },
      ],
      resolveTranscript: async () => {
        throw new Error("Twilio media fetch failed");
      },
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

  test("treats mixed image-plus-text buffers as documentable media turns", () => {
    expect(
      bufferHasDocumentableMedia([
        {
          media: [],
        },
        {
          media: [
            {
              contentType: "image/jpeg",
            },
          ],
        },
      ] as any),
    ).toBe(true);

    expect(
      bufferHasDocumentableMedia([
        {
          media: [],
        },
      ] as any),
    ).toBe(false);
  });

  test("keeps image-plus-note turns buffered until an explicit send command arrives", () => {
    expect(
      shouldKeepBufferedDocumentationTurn({
        explicitSendCommand: false,
        shouldForceSend: false,
        messages: [
          {
            text: "",
            media: [
              {
                contentType: "image/jpeg",
              },
            ],
          },
          {
            text: "Diese Teile gehoeren zum Olivaer Platz, wir haben da einige Schrankarbeiten getaetigt.",
            media: [],
          },
        ],
      } as any),
    ).toBe(true);
  });

  test("allows explicit proactive send intents with media to continue to turn detection", () => {
    expect(
      shouldKeepBufferedDocumentationTurn({
        explicitSendCommand: false,
        shouldForceSend: false,
        messages: [
          {
            text: "Bitte schick das Bild an den Kunden per WhatsApp.",
            media: [
              {
                contentType: "image/jpeg",
              },
            ],
          },
        ],
      } as any),
    ).toBe(false);
  });

  test("suppresses buffered turn delivery once messages were claimed by a send batch", () => {
    expect(
      shouldDeliverBufferedTurnResponse([
        {
          turnStatus: "ignored",
          documentationStatus: "batched",
        },
      ] as any),
    ).toBe(false);

    expect(
      shouldDeliverBufferedTurnResponse([
        {
          turnStatus: "buffered",
          documentationStatus: undefined,
        },
      ] as any),
    ).toBe(true);
  });

  test("requires the current buffer to still match the original message set", () => {
    expect(
      doesBufferedTurnStillMatchMessageSet({
        currentBuffer: {
          _id: "buffer-1" as any,
          bufferedMessageIds: ["message-1", "message-2"] as any,
        },
        expectedBufferId: "buffer-1" as any,
        expectedMessageIds: ["message-2", "message-1"] as any,
      }),
    ).toBe(true);

    expect(
      doesBufferedTurnStillMatchMessageSet({
        currentBuffer: {
          _id: "buffer-1" as any,
          bufferedMessageIds: ["message-1", "message-2", "message-3"] as any,
        },
        expectedBufferId: "buffer-1" as any,
        expectedMessageIds: ["message-1", "message-2"] as any,
      }),
    ).toBe(false);

    expect(
      doesBufferedTurnStillMatchMessageSet({
        currentBuffer: null,
        expectedBufferId: "buffer-1" as any,
        expectedMessageIds: ["message-1", "message-2"] as any,
      }),
    ).toBe(false);
  });

  test("finalizes an awaiting project-location batch from a transcribed voice reply", async () => {
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
      location: "Nikias Wohnung",
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

  test("matches a transcribed project choice by project location", async () => {
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
              location: "Nikias Wohnung",
            },
            {
              projectId: "project-2",
              location: "Bornstedter Straße",
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
              location: "Nikias Wohnung",
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
        projects: [{ location: "Nikias Wohnung" }],
        suggestedProjectLocation: "Nikias Wohnung",
      }),
    );
  });

  test("matches a transcribed project choice by formatted option label", async () => {
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
              location: "Nikias Wohnung",
              customerName: "Nikias GmbH",
            },
            {
              projectId: "project-2",
              location: "Nikias Wohnung",
              customerName: "Andere GmbH",
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
        text: formatProjectChoiceOption({
          location: "Nikias Wohnung",
          customerName: "Nikias GmbH",
        }),
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

  test("matches a similar transcribed project choice via embeddings", async () => {
    mockVoyageEmbeddings((input, inputType) => {
      if (inputType === "query") {
        return [1, 0];
      }

      if (input.includes("Nikias Wohnung")) {
        return [0.98, 0.02];
      }

      return [0, 1];
    });

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
              location: "Nikias Wohnung",
            },
            {
              projectId: "project-2",
              location: "Bornstedter Straße",
            },
          ],
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
        text: "Niklas Wohnung",
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
      matchReason: "semantic_pending_choice_match",
    });
    expect(result).toMatchObject({
      handled: true,
      reply: "saved",
      batchId: "batch-1",
      deliveryStage: "post_persistence",
    });
  });

  test("re-prompts when a similar project choice reply is ambiguous", async () => {
    mockVoyageEmbeddings((input, inputType) => {
      if (inputType === "query") {
        return [1, 0];
      }

      if (input.includes("Nikias Wohnung")) {
        return [0.92, 0.08];
      }

      if (input.includes("Nikias Haus")) {
        return [0.9, 0.1];
      }

      return [0, 1];
    });

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
              location: "Nikias Wohnung",
            },
            {
              projectId: "project-2",
              location: "Nikias Haus",
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
        text: "Niklas",
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

    expect(result).toMatchObject({
      handled: true,
      batchId: "batch-1",
      deliveryStage: "pre_persistence",
    });
    expect(result.reply).toBe(
      documentationProjectChoiceMessage({
        locale: "de",
        projects: [
          { location: "Nikias Wohnung" },
          { location: "Nikias Haus" },
        ],
        suggestedProjectLocation: "Nikias Wohnung",
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
