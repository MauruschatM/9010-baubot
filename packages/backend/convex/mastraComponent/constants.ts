import { v } from "convex/values";

export const vMastraChatRole = v.union(
  v.literal("system"),
  v.literal("user"),
  v.literal("assistant"),
  v.literal("tool"),
);

export const vMastraChatMessageType = v.union(
  v.literal("text"),
  v.literal("tool-call"),
  v.literal("tool-result"),
);

export const vMastraChatRunStatus = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("error"),
);

export const vMastraChatStreamPhase = v.union(
  v.literal("idle"),
  v.literal("thinking"),
  v.literal("delegating"),
  v.literal("tool"),
  v.literal("responding"),
);

export const vMastraChatStreamActor = v.union(
  v.literal("main"),
  v.literal("organization"),
);

export type MastraChatRole = "system" | "user" | "assistant" | "tool";
export type MastraChatMessageType = "text" | "tool-call" | "tool-result";
export type MastraChatRunStatus = "idle" | "running" | "error";
export type MastraChatStreamPhase =
  | "idle"
  | "thinking"
  | "delegating"
  | "tool"
  | "responding";
export type MastraChatStreamActor = "main" | "organization";

export const MAX_CHAT_HISTORY_MESSAGES = 200;
export const GENERATION_CONTEXT_MIN_MESSAGES = 20;
export const GENERATION_CONTEXT_MAX_MESSAGES = 40;
export const GENERATION_CONTEXT_LOOKBACK_MS = 12 * 60 * 60 * 1000;
export const MAX_PROMPT_LENGTH = 4000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_DATA_URL_LENGTH = 6_000_000;

export function getMastraResourceId(options: {
  organizationId: string;
  userId: string;
}) {
  return `org:${options.organizationId}:user:${options.userId}`;
}

export function getMastraThreadId(options: {
  organizationId: string;
  userId: string;
}) {
  return `thread:${options.organizationId}:${options.userId}`;
}

export function isMastraChatRole(value: unknown): value is MastraChatRole {
  return (
    value === "system" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool"
  );
}

export function isMastraChatMessageType(
  value: unknown,
): value is MastraChatMessageType {
  return (
    value === "text" ||
    value === "tool-call" ||
    value === "tool-result"
  );
}
