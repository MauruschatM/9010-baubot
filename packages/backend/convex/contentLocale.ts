"use node";

import type { AppLocale } from "@mvp-template/i18n";
import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import { z } from "zod";

import { appLocaleValues, normalizeAppLocale } from "./lib/locales";

const LOCALE_DETECTION_MAX_ITEMS = 24;
const LOCALE_DETECTION_MAX_TEXT_CHARS = 600;

const localeDetectionSchema = z.object({
  detections: z.array(
    z.object({
      id: z.string(),
      locale: z.string().nullable().optional(),
    }),
  ),
});

type LocaleDetectionItem = {
  id: string;
  text: string;
};

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

function normalizeDetectionText(value: string) {
  return value.trim().slice(0, LOCALE_DETECTION_MAX_TEXT_CHARS);
}

function chunkDetectionItems(items: LocaleDetectionItem[]) {
  const chunks: LocaleDetectionItem[][] = [];

  for (let index = 0; index < items.length; index += LOCALE_DETECTION_MAX_ITEMS) {
    chunks.push(items.slice(index, index + LOCALE_DETECTION_MAX_ITEMS));
  }

  return chunks;
}

export function normalizeDetectedAppLocale(value: string | null | undefined): AppLocale | null {
  return normalizeAppLocale(value);
}

export async function detectStoredLocalesForTextItems(options: {
  items: LocaleDetectionItem[];
}) {
  const normalizedItems = options.items
    .map((item) => ({
      id: item.id,
      text: normalizeDetectionText(item.text),
    }))
    .filter((item) => item.text.length > 0);

  const detectedLocales: Record<string, AppLocale> = {};
  const modelId = process.env.AI_GATEWAY_TRANSLATION_MODEL ?? process.env.AI_GATEWAY_MODEL;

  if (normalizedItems.length === 0 || !process.env.AI_GATEWAY_API_KEY || !modelId) {
    return detectedLocales;
  }

  for (const chunk of chunkDetectionItems(normalizedItems)) {
    try {
      const response = await generateObject({
        model: gateway(modelId),
        schema: localeDetectionSchema,
        prompt: [
          "Detect the original language of each text item.",
          `Return only one of these locales when it is clearly supported: ${appLocaleValues.join(", ")}.`,
          "Prefer the base language locale when the text does not reveal a specific region.",
          "Use null when the language cannot be determined reliably from the text itself.",
          "Do not infer the locale from user preferences, names, or metadata outside the text.",
          "Return JSON only with the schema { detections: [{ id, locale }] }.",
          JSON.stringify({ items: chunk }),
        ].join("\n"),
      });

      for (const detection of response.object.detections) {
        const normalizedLocale = normalizeDetectedAppLocale(detection.locale);

        if (normalizedLocale) {
          detectedLocales[detection.id] = normalizedLocale;
        }
      }
    } catch (error) {
      console.warn("Stored content locale detection failed", {
        itemCount: chunk.length,
        message: errorMessageFromUnknown(error),
      });
    }
  }

  return detectedLocales;
}
