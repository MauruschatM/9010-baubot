import { afterEach, describe, expect, test } from "bun:test";

import {
  OPENROUTER_NOT_CONFIGURED_ERROR_MESSAGE,
  getOpenRouterApiKey,
  getOpenRouterFastModel,
  getOpenRouterSmartModel,
  hasOpenRouterFastConfig,
  hasOpenRouterSmartConfig,
  isOpenRouterConfigured,
  requireOpenRouterFastModel,
  requireOpenRouterSmartModel,
} from "../convex/lib/openrouter";

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalOpenRouterSmartModel = process.env.OPENROUTER_SMART_MODEL;
const originalOpenRouterFastModel = process.env.OPENROUTER_FAST_MODEL;

function restoreEnv(name: "OPENROUTER_API_KEY" | "OPENROUTER_SMART_MODEL" | "OPENROUTER_FAST_MODEL", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterEach(() => {
  restoreEnv("OPENROUTER_API_KEY", originalOpenRouterApiKey);
  restoreEnv("OPENROUTER_SMART_MODEL", originalOpenRouterSmartModel);
  restoreEnv("OPENROUTER_FAST_MODEL", originalOpenRouterFastModel);
});

describe("openrouter config helpers", () => {
  test("trimmed env values are returned for the api key and both model tiers", () => {
    process.env.OPENROUTER_API_KEY = "  test-openrouter-key  ";
    process.env.OPENROUTER_SMART_MODEL = "  anthropic/claude-sonnet-4.5  ";
    process.env.OPENROUTER_FAST_MODEL = "  google/gemini-2.5-flash  ";

    expect(getOpenRouterApiKey()).toBe("test-openrouter-key");
    expect(getOpenRouterSmartModel()).toBe("anthropic/claude-sonnet-4.5");
    expect(getOpenRouterFastModel()).toBe("google/gemini-2.5-flash");
    expect(isOpenRouterConfigured()).toBe(true);
  });

  test("missing config disables the provider guards and throws a consistent error", () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_SMART_MODEL = "anthropic/claude-sonnet-4.5";
    process.env.OPENROUTER_FAST_MODEL = "google/gemini-2.5-flash";

    expect(hasOpenRouterSmartConfig()).toBe(false);
    expect(hasOpenRouterFastConfig()).toBe(false);
    expect(isOpenRouterConfigured()).toBe(false);
    expect(() => requireOpenRouterSmartModel()).toThrow(
      OPENROUTER_NOT_CONFIGURED_ERROR_MESSAGE,
    );
    expect(() => requireOpenRouterFastModel()).toThrow(
      OPENROUTER_NOT_CONFIGURED_ERROR_MESSAGE,
    );
  });

  test("smart and fast model resolution stay isolated", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_SMART_MODEL = "openai/gpt-5";
    process.env.OPENROUTER_FAST_MODEL = "openai/gpt-5-mini";

    expect(requireOpenRouterSmartModel()).toBe("openai/gpt-5");
    expect(requireOpenRouterFastModel()).toBe("openai/gpt-5-mini");
    expect(hasOpenRouterSmartConfig()).toBe(true);
    expect(hasOpenRouterFastConfig()).toBe(true);
  });
});
