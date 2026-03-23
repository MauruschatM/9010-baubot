import { describe, expect, test } from "bun:test";

import {
  resolveTimelineTranslationLocale,
  resolveStoredTranslationDecision,
  shouldTranslateStoredValue,
} from "../convex/projectTranslations";

describe("project timeline localization helpers", () => {
  test("uses the viewer locale when no explicit user preference is stored", () => {
    expect(resolveTimelineTranslationLocale(null, "de")).toBe("de");
  });

  test("keeps explicit user preferences ahead of the viewer locale", () => {
    expect(resolveTimelineTranslationLocale("en", "de")).toBe("en");
  });

  test("does not translate stored content when source and target locales already match", () => {
    expect(shouldTranslateStoredValue("de", "de")).toBe(false);
  });

  test("translates stored content when source and target locales differ", () => {
    expect(shouldTranslateStoredValue("de", "en")).toBe(true);
  });

  test("reuses matching cached translations without queueing another model call", () => {
    expect(
      resolveStoredTranslationDecision({
        currentValue: "Steckdosen montiert",
        sourceLocale: "de",
        targetLocale: "en",
        sourceHash: "hash-1",
        cached: {
          sourceHash: "hash-1",
          text: "Steckdosen montiert",
        },
      }),
    ).toEqual({
      localizedValue: "Steckdosen montiert",
      shouldQueueTranslation: false,
    });
  });

  test("queues translations only when the stored source locale differs and no cache exists", () => {
    expect(
      resolveStoredTranslationDecision({
        currentValue: "Steckdosen montiert",
        sourceLocale: "de",
        targetLocale: "en",
        sourceHash: "hash-1",
      }),
    ).toEqual({
      localizedValue: "Steckdosen montiert",
      shouldQueueTranslation: true,
    });
  });
});
