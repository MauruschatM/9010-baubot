import type { ExportManifest } from "@/lib/export-zip";

import { IMAGE_FILENAME_PATTERN } from "./constants";
import type {
  ChatThreadSummary,
  TimelineAttachment,
  WindowWithSpeechRecognition,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRecordStringValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function getMessageParts(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    return content.filter((entry) => isRecord(entry));
  }

  if (!isRecord(content)) {
    return [];
  }

  const directParts = content.parts;
  if (Array.isArray(directParts)) {
    return directParts.filter((entry) => isRecord(entry));
  }

  const nestedContent = content.content;
  if (Array.isArray(nestedContent)) {
    return nestedContent.filter((entry) => isRecord(entry));
  }

  if (!isRecord(nestedContent)) {
    return [];
  }

  const nestedParts = nestedContent.parts;
  if (!Array.isArray(nestedParts)) {
    return [];
  }

  return nestedParts.filter((entry) => isRecord(entry));
}

function getToolResultValue(part: Record<string, unknown>) {
  if ("result" in part) {
    return part.result;
  }

  if ("output" in part) {
    return part.output;
  }

  if ("value" in part) {
    return part.value;
  }

  return null;
}

function buildImageDataUrl(part: Record<string, unknown>) {
  const imageUrl = getRecordStringValue(part, "url");
  if (imageUrl) {
    return imageUrl;
  }

  const imageData =
    getRecordStringValue(part, "image") ?? getRecordStringValue(part, "data");
  if (!imageData) {
    return null;
  }

  if (
    imageData.startsWith("data:") ||
    imageData.startsWith("http://") ||
    imageData.startsWith("https://") ||
    imageData.startsWith("blob:")
  ) {
    return imageData;
  }

  const mimeType = getRecordStringValue(part, "mimeType") ?? "image/*";
  return `data:${mimeType};base64,${imageData}`;
}

export function extractTimelineAttachments(options: {
  rawContent: unknown;
  attachmentNames: string[];
}) {
  const parts = getMessageParts(options.rawContent);
  if (parts.length === 0) {
    return options.attachmentNames.map((attachmentName, index) => ({
      id: `fallback-${index}`,
      name: attachmentName,
      imageSrc: null,
    })) satisfies TimelineAttachment[];
  }

  const extractedAttachments: TimelineAttachment[] = [];
  let attachmentNameIndex = 0;

  parts.forEach((part, index) => {
    const partType = getRecordStringValue(part, "type");
    if (
      partType !== "file" &&
      partType !== "image" &&
      partType !== "image-file"
    ) {
      return;
    }

    const fallbackName = options.attachmentNames[attachmentNameIndex];
    attachmentNameIndex += 1;

    const filename = getRecordStringValue(part, "filename");
    const name =
      filename ??
      fallbackName ??
      (partType === "file" ? "Attachment" : `Image ${extractedAttachments.length + 1}`);
    const isLikelyImage =
      partType === "image" ||
      partType === "image-file" ||
      IMAGE_FILENAME_PATTERN.test(name);
    const imageSrc = isLikelyImage ? buildImageDataUrl(part) : null;

    extractedAttachments.push({
      id: `${index}-${name}`,
      name,
      imageSrc,
    });
  });

  if (extractedAttachments.length === 0) {
    return options.attachmentNames.map((attachmentName, index) => ({
      id: `fallback-${index}`,
      name: attachmentName,
      imageSrc: null,
    })) satisfies TimelineAttachment[];
  }

  for (
    let remainingNameIndex = attachmentNameIndex;
    remainingNameIndex < options.attachmentNames.length;
    remainingNameIndex += 1
  ) {
    const remainingName = options.attachmentNames[remainingNameIndex];
    extractedAttachments.push({
      id: `remaining-${remainingNameIndex}-${remainingName}`,
      name: remainingName,
      imageSrc: null,
    });
  }

  return extractedAttachments;
}

export function extractExportReadyResults(rawContent: unknown): Array<{
  exportMode: "customers" | "projects";
  manifest: ExportManifest;
}> {
  const results: Array<{
    exportMode: "customers" | "projects";
    manifest: ExportManifest;
  }> = [];

  for (const part of getMessageParts(rawContent)) {
    const partType = getRecordStringValue(part, "type");
    if (partType !== "tool-result" && partType !== "tool-invocation") {
      continue;
    }

    const result = getToolResultValue(part);
    if (!isRecord(result) || result.status !== "export_ready") {
      continue;
    }

    const exportMode =
      result.exportMode === "customers" || result.exportMode === "projects"
        ? result.exportMode
        : null;
    const manifest = result.manifest;
    if (!exportMode || !isRecord(manifest)) {
      continue;
    }

    results.push({
      exportMode,
      manifest: manifest as ExportManifest,
    });
  }

  return results;
}

export function resolveSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as WindowWithSpeechRecognition;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
}

export function getStorageIdFromUploadResult(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const storageId = value.storageId;
  return typeof storageId === "string" && storageId.trim().length > 0
    ? storageId
    : null;
}

export function buildAttachmentPrompt(attachmentNames: string[]) {
  if (attachmentNames.length === 0) {
    return "";
  }

  const fileList = attachmentNames.join(", ");
  return `Please analyze the attached file(s): ${fileList}`;
}

export function getLocalDayKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatThoughtDurationLabel(durationMs: number, locale: string) {
  if (durationMs < 60_000) {
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    return `${seconds}s`;
  }

  const minutes = durationMs / 60_000;
  const roundedMinutes = Math.max(0.1, Math.round(minutes * 10) / 10);
  const hasFraction = roundedMinutes % 1 !== 0;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  });
  return `${formatter.format(roundedMinutes)}m`;
}

export function formatThreadRangeLabel(
  thread: ChatThreadSummary,
  formatter: Intl.DateTimeFormat,
) {
  const startLabel = formatter.format(new Date(thread.createdAt));
  const endLabel = formatter.format(new Date(thread.updatedAt));
  return `${startLabel} - ${endLabel}`;
}
