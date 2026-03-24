import { describe, expect, test } from "bun:test";

import {
  persistInboundDocumentationMessage,
} from "../convex/whatsapp";
import {
  extractDocumentationTextFromSendCommand,
  isSendCommand,
} from "../convex/whatsapp/normalize";

describe("whatsapp send command normalization", () => {
  test("accepts the documented slash send command", () => {
    expect(isSendCommand("/send")).toBe(true);
  });

  test("accepts the german senden command", () => {
    expect(isSendCommand("Senden")).toBe(true);
  });

  test("keeps project context while stripping send control text", () => {
    expect(extractDocumentationTextFromSendCommand("Axitol Strasse senden")).toBe(
      "Axitol Strasse",
    );
    expect(extractDocumentationTextFromSendCommand("/send")).toBe("");
  });
});

describe("whatsapp command message persistence", () => {
  test("stores project text carried by a send command before batching", async () => {
    const runMutationCalls: Array<Record<string, unknown>> = [];

    const messageId = await persistInboundDocumentationMessage({
      ctx: {
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push(args);
          if (runMutationCalls.length === 1) {
            return { id: "message-1" };
          }

          return {
            _id: "buffer-1",
            bufferedMessageIds: ["message-1"],
          };
        },
        storage: {
          store: async () => "storage-1" as any,
        },
      },
      locale: "de",
      payload: {
        from: "whatsapp:+49123",
        to: "whatsapp:+49111",
        body: "Axitol Strasse senden",
        messageSid: "SM123",
        media: [],
      },
      phoneNumberE164: "+49123",
      connection: {
        _id: "connection-1",
        organizationId: "org-1",
        memberId: "member-1",
        userId: "user-1",
        phoneNumberE164: "+49123",
        phoneNumberDigits: "49123",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any,
      threadId: "thread-1",
      bodyText: extractDocumentationTextFromSendCommand("Axitol Strasse senden"),
      resolveMediaEntries: async () => [],
    });

    expect(messageId).toBe("message-1");
    expect(runMutationCalls).toHaveLength(2);
    expect(runMutationCalls[0]).toMatchObject({
      providerMessageSid: "SM123",
      text: "Axitol Strasse",
      media: [],
      turnStatus: "buffered",
    });
    expect(runMutationCalls[1]).toMatchObject({
      connectionId: "connection-1",
      threadId: "thread-1",
      messageId: "message-1",
    });
  });

  test("stores media attached to a bare send command", async () => {
    const runMutationCalls: Array<Record<string, unknown>> = [];

    const messageId = await persistInboundDocumentationMessage({
      ctx: {
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push(args);
          if (runMutationCalls.length === 1) {
            return { id: "message-2" };
          }

          return {
            _id: "buffer-2",
            bufferedMessageIds: ["message-2"],
          };
        },
        storage: {
          store: async () => "storage-1" as any,
        },
      },
      locale: "de",
      payload: {
        from: "whatsapp:+49123",
        to: "whatsapp:+49111",
        body: "senden",
        messageSid: "SM456",
        media: [
          {
            mediaUrl: "https://example.com/image.jpg",
            contentType: "image/jpeg",
            fileName: "image.jpg",
          },
        ],
      },
      phoneNumberE164: "+49123",
      connection: {
        _id: "connection-1",
        organizationId: "org-1",
        memberId: "member-1",
        userId: "user-1",
        phoneNumberE164: "+49123",
        phoneNumberDigits: "49123",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any,
      threadId: "thread-1",
      bodyText: extractDocumentationTextFromSendCommand("senden"),
      resolveMediaEntries: async () => [
        {
          storageId: "storage-1" as any,
          contentType: "image/jpeg",
          fileName: "image.jpg",
          mediaUrl: "https://example.com/image.jpg",
        },
      ],
    });

    expect(messageId).toBe("message-2");
    expect(runMutationCalls[0]).toMatchObject({
      text: "",
      media: [
        expect.objectContaining({
          contentType: "image/jpeg",
          fileName: "image.jpg",
        }),
      ],
    });
  });

  test("skips empty control-only messages", async () => {
    const runMutationCalls: Array<Record<string, unknown>> = [];

    const messageId = await persistInboundDocumentationMessage({
      ctx: {
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          runMutationCalls.push(args);
          return null;
        },
        storage: {
          store: async () => "storage-1" as any,
        },
      },
      locale: "de",
      payload: {
        from: "whatsapp:+49123",
        to: "whatsapp:+49111",
        body: "senden",
        messageSid: "SM789",
        media: [],
      },
      phoneNumberE164: "+49123",
      connection: {
        _id: "connection-1",
        organizationId: "org-1",
        memberId: "member-1",
        userId: "user-1",
        phoneNumberE164: "+49123",
        phoneNumberDigits: "49123",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any,
      threadId: "thread-1",
      bodyText: extractDocumentationTextFromSendCommand("senden"),
      resolveMediaEntries: async () => [],
    });

    expect(messageId).toBeNull();
    expect(runMutationCalls).toHaveLength(0);
  });
});
