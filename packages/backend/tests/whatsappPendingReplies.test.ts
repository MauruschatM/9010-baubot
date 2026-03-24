import { afterEach, describe, expect, test } from "bun:test";

import {
  handlePendingProjectResolution,
  processConnectedInbound,
  resolvePendingReplyInput,
  sendBufferedReminder,
} from "../convex/whatsapp";
import {
  documentationProjectChoiceMessage,
  documentationStartedMessage,
  formatProjectChoiceOption,
  pendingVoiceReplyTypingFallbackMessage,
  readyQuestionMessage,
  waitForMoreMessage,
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

function createConnection() {
  return {
    _id: "connection-1",
    organizationId: "org-1",
    memberId: "member-1",
    userId: "user-1",
    phoneNumberE164: "+491234",
    phoneNumberDigits: "491234",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any;
}

function createPayload(overrides: Partial<{
  body: string;
  messageSid: string;
  media: Array<{
    mediaUrl: string;
    contentType: string;
    fileName?: string;
  }>;
}>) {
  return {
    from: "whatsapp:+491234",
    to: "whatsapp:+491110",
    body: "",
    messageSid: "SM-1",
    media: [],
    ...overrides,
  };
}

function createTurnBuffer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "buffer-1",
    connectionId: "connection-1",
    organizationId: "org-1",
    userId: "user-1",
    memberId: "member-1",
    threadId: "thread-1",
    status: "buffering",
    bufferedMessageIds: ["message-1"],
    firstBufferedAt: Date.now() - 10_000,
    lastBufferedAt: Date.now() - 10_000,
    updatedAt: Date.now() - 10_000,
    ...overrides,
  } as any;
}

function createInboundHarness(options?: {
  initialBuffer?: any | null;
  nextBuffer?: any | null;
  pendingResolution?: any | null;
  activeSendBatch?: any | null;
  sendBatchResult?: any;
}) {
  const runMutationCalls: Array<Record<string, unknown>> = [];
  const runActionCalls: Array<Record<string, unknown>> = [];
  const scheduledCalls: Array<Record<string, unknown>> = [];
  let connectionQueryCount = 0;
  let orgPhoneQueryCount = 0;

  const nextBuffer =
    options?.nextBuffer ??
    createTurnBuffer({
      status: "buffering",
      bufferedMessageIds: ["message-1"],
    });

  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("connectionId" in args) {
        connectionQueryCount += 1;
        return connectionQueryCount === 1 ? options?.initialBuffer ?? null : nextBuffer;
      }

      if ("organizationId" in args && "phoneE164" in args) {
        orgPhoneQueryCount += 1;
        return orgPhoneQueryCount === 1
          ? options?.pendingResolution ?? null
          : options?.activeSendBatch ?? null;
      }

      throw new Error(`Unexpected runQuery args: ${JSON.stringify(args)}`);
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);

      if ("providerMessageSid" in args) {
        return { id: `message-${runMutationCalls.length}` };
      }

      if ("messageId" in args && "connectionId" in args) {
        return nextBuffer;
      }

      if ("commandMessageSid" in args) {
        return (
          options?.sendBatchResult ?? {
            status: "queued",
            messageCount: 1,
          }
        );
      }

      return null;
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      runActionCalls.push(args);
      return { ok: true };
    },
    scheduler: {
      runAfter: async (
        delayMs: number,
        functionReference: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduledCalls.push({
          delayMs,
          functionReference,
          args,
        });
        return "job-1" as any;
      },
    },
    storage: {
      store: async () => "storage-1" as any,
    },
  };

  return {
    ctx,
    runMutationCalls,
    runActionCalls,
    scheduledCalls,
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

  test("buffers a normal text message and schedules one inactivity reminder", async () => {
    const harness = createInboundHarness({
      nextBuffer: createTurnBuffer({
        bufferedMessageIds: ["message-1"],
      }),
    });

    await processConnectedInbound({
      ctx: harness.ctx as any,
      payload: createPayload({
        body: "Olivaer Platz, Fensterrahmen sind fertig.",
      }),
      locale: "de",
      phoneNumberE164: "+491234",
      connection: createConnection(),
    });

    expect(harness.runMutationCalls[0]).toMatchObject({
      providerMessageSid: "SM-1",
      text: "Olivaer Platz, Fensterrahmen sind fertig.",
      turnStatus: "buffered",
    });
    expect(harness.scheduledCalls).toHaveLength(1);
    expect(harness.scheduledCalls[0]).toMatchObject({
      delayMs: 5 * 60 * 1000,
      args: {
        bufferId: "buffer-1",
        connectionId: "connection-1",
        phoneNumberE164: "+491234",
        locale: "de",
      },
    });
    expect(harness.runActionCalls).toHaveLength(0);
  });

  test("keeps buffering while a previous send batch is already processing", async () => {
    const harness = createInboundHarness({
      activeSendBatch: {
        _id: "batch-1",
        status: "processing",
      },
      nextBuffer: createTurnBuffer({
        bufferedMessageIds: ["message-1"],
      }),
    });

    await processConnectedInbound({
      ctx: harness.ctx as any,
      payload: createPayload({
        body: "Noch ein Bild vom Badezimmer.",
      }),
      locale: "de",
      phoneNumberE164: "+491234",
      connection: createConnection(),
    });

    expect(harness.runMutationCalls[0]).toMatchObject({
      text: "Noch ein Bild vom Badezimmer.",
      turnStatus: "buffered",
    });
    expect(harness.scheduledCalls).toHaveLength(1);
    expect(harness.runActionCalls).toHaveLength(0);
  });

  test("starts documentation when send is confirmed from the inactivity reminder", async () => {
    const harness = createInboundHarness({
      initialBuffer: createTurnBuffer({
        status: "awaiting_confirmation",
        bufferedMessageIds: ["message-0"],
      }),
      sendBatchResult: {
        status: "queued",
        messageCount: 2,
      },
    });

    await processConnectedInbound({
      ctx: harness.ctx as any,
      payload: createPayload({
        body: "Olivaer Platz senden",
      }),
      locale: "de",
      phoneNumberE164: "+491234",
      connection: createConnection(),
    });

    expect(harness.runMutationCalls[0]).toMatchObject({
      text: "Olivaer Platz",
      turnStatus: "buffered",
    });
    expect(harness.runMutationCalls[2]).toMatchObject({
      commandMessageSid: "SM-1",
      phoneE164: "+491234",
    });
    expect(harness.runActionCalls).toEqual([
      expect.objectContaining({
        phoneNumberE164: "+491234",
        text: documentationStartedMessage("de"),
      }),
    ]);
    expect(harness.scheduledCalls).toHaveLength(0);
  });

  test("waits for more input when the user declines the inactivity reminder", async () => {
    const harness = createInboundHarness({
      initialBuffer: createTurnBuffer({
        status: "awaiting_confirmation",
        bufferedMessageIds: ["message-0"],
      }),
    });

    await processConnectedInbound({
      ctx: harness.ctx as any,
      payload: createPayload({
        body: "Nein",
      }),
      locale: "de",
      phoneNumberE164: "+491234",
      connection: createConnection(),
    });

    expect(harness.runMutationCalls).toEqual([
      expect.objectContaining({
        bufferId: "buffer-1",
        status: "buffering",
        readyPromptSentAt: undefined,
        documentationPromptSentAt: undefined,
        documentationReminderJobId: undefined,
      }),
    ]);
    expect(harness.runActionCalls).toEqual([
      expect.objectContaining({
        phoneNumberE164: "+491234",
        text: waitForMoreMessage("de"),
      }),
    ]);
    expect(harness.scheduledCalls).toHaveLength(0);
  });

  test("treats a follow-up message after the reminder as new buffered content and restarts the timer", async () => {
    const harness = createInboundHarness({
      initialBuffer: createTurnBuffer({
        status: "awaiting_confirmation",
        bufferedMessageIds: ["message-0"],
      }),
      nextBuffer: createTurnBuffer({
        bufferedMessageIds: ["message-0", "message-1"],
      }),
    });

    await processConnectedInbound({
      ctx: harness.ctx as any,
      payload: createPayload({
        body: "Hier ist noch die letzte Notiz vom Flur.",
      }),
      locale: "de",
      phoneNumberE164: "+491234",
      connection: createConnection(),
    });

    expect(harness.runMutationCalls[0]).toMatchObject({
      text: "Hier ist noch die letzte Notiz vom Flur.",
      turnStatus: "buffered",
    });
    expect(harness.scheduledCalls).toHaveLength(1);
    expect(harness.runActionCalls).toHaveLength(0);
  });

  test("sends the inactivity reminder once the buffer has been idle long enough", async () => {
    const now = Date.now();
    const runMutationCalls: Array<Record<string, unknown>> = [];
    const runActionCalls: Array<Record<string, unknown>> = [];

    await sendBufferedReminder({
      ctx: {
        runQuery: async () =>
          createTurnBuffer({
            status: "buffering",
            bufferedMessageIds: ["message-1", "message-2"],
            lastBufferedAt: now - 5 * 60 * 1000 - 1,
          }),
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push(args);
          return null;
        },
        runAction: async (_ref: unknown, args: Record<string, unknown>) => {
          runActionCalls.push(args);
          return { ok: true };
        },
      } as any,
      bufferId: "buffer-1" as any,
      connectionId: "connection-1" as any,
      phoneNumberE164: "+491234",
      locale: "de",
      now,
    });

    expect(runMutationCalls).toEqual([
      expect.objectContaining({
        bufferId: "buffer-1",
        status: "awaiting_confirmation",
        readyPromptSentAt: now,
        documentationReminderJobId: undefined,
      }),
    ]);
    expect(runActionCalls).toEqual([
      expect.objectContaining({
        phoneNumberE164: "+491234",
        text: readyQuestionMessage("de"),
      }),
    ]);
  });

  test("does not send the inactivity reminder before the timeout elapses", async () => {
    const runMutationCalls: Array<Record<string, unknown>> = [];
    const runActionCalls: Array<Record<string, unknown>> = [];

    await sendBufferedReminder({
      ctx: {
        runQuery: async () =>
          createTurnBuffer({
            status: "buffering",
            bufferedMessageIds: ["message-1"],
            lastBufferedAt: Date.now(),
          }),
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push(args);
          return null;
        },
        runAction: async (_ref: unknown, args: Record<string, unknown>) => {
          runActionCalls.push(args);
          return { ok: true };
        },
      } as any,
      bufferId: "buffer-1" as any,
      connectionId: "connection-1" as any,
      phoneNumberE164: "+491234",
      locale: "de",
    });

    expect(runMutationCalls).toHaveLength(0);
    expect(runActionCalls).toHaveLength(0);
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
      connection: createConnection(),
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
      connection: createConnection(),
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
      connection: createConnection(),
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
      connection: createConnection(),
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
      connection: createConnection(),
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
      connection: createConnection(),
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
});
