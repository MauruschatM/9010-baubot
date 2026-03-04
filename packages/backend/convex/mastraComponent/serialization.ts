import type { MastraChatMessageType } from "./constants";

const FILE_FALLBACK_LABEL = "Attachment";
const IMAGE_FALLBACK_LABEL = "Image";
const TOOL_RESULT_PREVIEW_MAX_LENGTH = 320;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getStringValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getArrayContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((part) => isRecord(part));
}

function getRecordArrayValue(
  record: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => isRecord(entry));
}

function getMessageParts(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    return getArrayContent(content);
  }

  if (!isRecord(content)) {
    return [];
  }

  const directParts = getRecordArrayValue(content, "parts");
  if (directParts.length > 0) {
    return directParts;
  }

  const nestedContent = content.content;
  if (Array.isArray(nestedContent)) {
    return getArrayContent(nestedContent);
  }

  if (isRecord(nestedContent)) {
    return getRecordArrayValue(nestedContent, "parts");
  }

  return [];
}

function stringifyPreview(value: unknown) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return "";
    }
    return text.slice(0, TOOL_RESULT_PREVIEW_MAX_LENGTH);
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "";
    }
    return serialized.slice(0, TOOL_RESULT_PREVIEW_MAX_LENGTH);
  } catch {
    return "";
  }
}

export function normalizeCreatedAt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

export function serializeContentForConvex(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64");
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(
      "base64",
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeContentForConvex(entry));
  }

  if (isRecord(value)) {
    const serializedEntries = Object.entries(value).map(([key, entry]) => [
      key,
      serializeContentForConvex(entry),
    ]);
    return Object.fromEntries(serializedEntries);
  }

  return String(value);
}

export function extractAttachmentNames(content: unknown) {
  const names: string[] = [];

  for (const part of getMessageParts(content)) {
    const partType = getStringValue(part, "type");
    if (partType === "image" || partType === "image-file") {
      names.push(IMAGE_FALLBACK_LABEL);
      continue;
    }

    if (partType !== "file") {
      continue;
    }

    const filename = getStringValue(part, "filename");
    if (filename) {
      names.push(filename);
      continue;
    }

    names.push(FILE_FALLBACK_LABEL);
  }

  return names;
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (isRecord(content)) {
    const directText = getStringValue(content, "content");
    if (directText) {
      return directText;
    }

    const fallbackText = getStringValue(content, "text");
    if (fallbackText) {
      return fallbackText;
    }
  }

  const chunks: string[] = [];
  for (const part of getMessageParts(content)) {
    const partType = getStringValue(part, "type");
    if (
      partType === "text" ||
      partType === "reasoning" ||
      partType === "reasoning-text"
    ) {
      const text = getStringValue(part, "text");
      if (text) {
        chunks.push(text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function summarizeToolCalls(content: unknown) {
  const summaries: string[] = [];

  for (const part of getMessageParts(content)) {
    const partType = getStringValue(part, "type");
    if (partType !== "tool-call" && partType !== "tool-invocation") {
      continue;
    }

    const toolName =
      getStringValue(part, "toolName") ??
      getStringValue(part, "toolNameNormalized") ??
      "tool";
    summaries.push(`Tool call: ${toolName}`);
  }

  return summaries.join("\n");
}

function summarizeToolResults(content: unknown) {
  const summaries: string[] = [];

  for (const part of getMessageParts(content)) {
    const partType = getStringValue(part, "type");
    if (partType !== "tool-result" && partType !== "tool-invocation") {
      continue;
    }

    const toolName =
      getStringValue(part, "toolName") ??
      getStringValue(part, "toolNameNormalized") ??
      "tool";

    const resultValue =
      part.result ??
      (isRecord(part.result) ? part.result : null) ??
      part.output ??
      (isRecord(part) ? part.value : null);

    const resultPreview = stringifyPreview(resultValue);
    summaries.push(
      resultPreview
        ? `Tool result: ${toolName} -> ${resultPreview}`
        : `Tool result: ${toolName}`,
    );
  }

  return summaries.join("\n");
}

export function toDisplayText(message: {
  type: MastraChatMessageType;
  content: unknown;
}) {
  if (message.type === "tool-call") {
    const summary = summarizeToolCalls(message.content);
    if (summary) {
      return summary;
    }
  }

  if (message.type === "tool-result") {
    const summary = summarizeToolResults(message.content);
    if (summary) {
      return summary;
    }
  }

  const text = extractTextContent(message.content);
  if (text) {
    return text;
  }

  if (message.type === "tool-call") {
    return "Tool call";
  }

  if (message.type === "tool-result") {
    return "Tool result";
  }

  return "";
}

export function toGenerationContent(message: {
  type: MastraChatMessageType;
  content: unknown;
  text?: string;
}) {
  if (message.type !== "text") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content;
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  const text =
    (typeof message.text === "string" ? message.text.trim() : "") ||
    toDisplayText({
      type: message.type,
      content: message.content,
    });

  return text || message.content;
}
