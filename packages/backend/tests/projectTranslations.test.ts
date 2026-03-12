import { describe, expect, test } from "bun:test";

import {
  resolveTimelineTranslationLocale,
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
});
