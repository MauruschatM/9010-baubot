"use node";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";

type OpenRouterEnvKey =
  | "OPENROUTER_API_KEY"
  | "OPENROUTER_SMART_MODEL"
  | "OPENROUTER_FAST_MODEL";

export const OPENROUTER_NOT_CONFIGURED_ERROR_MESSAGE = "OpenRouter is not configured";

function readTrimmedEnv(key: OpenRouterEnvKey) {
  const value = process.env[key];
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function getOpenRouterApiKey() {
  return readTrimmedEnv("OPENROUTER_API_KEY");
}

export function getOpenRouterSmartModel() {
  return readTrimmedEnv("OPENROUTER_SMART_MODEL");
}

export function getOpenRouterFastModel() {
  return readTrimmedEnv("OPENROUTER_FAST_MODEL");
}

export function hasOpenRouterSmartConfig() {
  return Boolean(getOpenRouterApiKey() && getOpenRouterSmartModel());
}

export function hasOpenRouterFastConfig() {
  return Boolean(getOpenRouterApiKey() && getOpenRouterFastModel());
}

export function isOpenRouterConfigured() {
  return hasOpenRouterSmartConfig() && hasOpenRouterFastConfig();
}

export function requireOpenRouterSmartModel() {
  const modelId = getOpenRouterSmartModel();
  if (!getOpenRouterApiKey() || !modelId) {
    throw new Error(OPENROUTER_NOT_CONFIGURED_ERROR_MESSAGE);
  }

  return modelId;
}

export function requireOpenRouterFastModel() {
  const modelId = getOpenRouterFastModel();
  if (!getOpenRouterApiKey() || !modelId) {
    throw new Error(OPENROUTER_NOT_CONFIGURED_ERROR_MESSAGE);
  }

  return modelId;
}

const openRouterApiKey = getOpenRouterApiKey();

export const openrouter = createOpenRouter(
  openRouterApiKey ? { apiKey: openRouterApiKey } : {},
);
