import { describe, expect, test } from "bun:test";

import { derivePreparedTimelineFieldLocales } from "../convex/whatsappProcessing";

describe("whatsapp timeline locale derivation", () => {
  test("stores the message text locale for sourceText, text, and summary when summary reuses the text", () => {
    expect(
      derivePreparedTimelineFieldLocales({
        sourceText: "Bitte im Hof weiterarbeiten",
        sourceTextLocale: "de",
        summary: "Bitte im Hof weiterarbeiten",
      }),
    ).toEqual({
      sourceText: "de",
      text: "de",
      summary: "de",
    });
  });

  test("reuses the transcript locale when the timeline summary falls back to the transcript", () => {
    expect(
      derivePreparedTimelineFieldLocales({
        transcript: "Please leave the materials by the garage.",
        transcriptLocale: "en",
        summary: "Please leave the materials by the garage.",
      }),
    ).toEqual({
      transcript: "en",
      summary: "en",
    });
  });
});
