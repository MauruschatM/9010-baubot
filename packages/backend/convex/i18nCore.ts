"use node";

import { generateObject } from "ai";
import type { GenericActionCtx } from "convex/server";
import { z } from "zod";

import type { DataModel } from "./_generated/dataModel";
import type { AppLocale } from "@mvp-template/i18n";
import { getOpenRouterFastModel, hasOpenRouterFastConfig, openrouter } from "./lib/openrouter";

type TranslationItem = {
  id: string;
  text: string;
};

interface TranslateTextOptions {
  organizationId: string;
  targetLocale: AppLocale;
  items: TranslationItem[];
  userId: string;
}

const translationsSchema = z.object({
  translations: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
    }),
  ),
});

const TRANSLATION_MAX_ITEMS = 20;
const TRANSLATION_MAX_TEXT_CHARS = 800;
const TRANSLATION_TIMEOUT_MS = 8000;

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

function normalizeTranslationItem(item: TranslationItem): TranslationItem {
  return {
    id: item.id,
    text: item.text.trim().slice(0, TRANSLATION_MAX_TEXT_CHARS),
  };
}

function chunkTranslationItems(items: TranslationItem[]) {
  const chunks: TranslationItem[][] = [];

  for (let index = 0; index < items.length; index += TRANSLATION_MAX_ITEMS) {
    chunks.push(items.slice(index, index + TRANSLATION_MAX_ITEMS));
  }

  return chunks;
}

export async function translateTextsWithAi(
  _ctx: GenericActionCtx<DataModel>,
  args: TranslateTextOptions,
): Promise<Record<string, string>> {
  const resultMap: Record<string, string> = {};

  for (const item of args.items) {
    resultMap[item.id] = item.text;
  }

  const modelId = getOpenRouterFastModel();

  if (args.items.length === 0 || !modelId || !hasOpenRouterFastConfig()) {
    return resultMap;
  }

  try {
    const normalizedItems = args.items
      .map(normalizeTranslationItem)
      .filter((item) => item.text.length > 0);

    for (const chunk of chunkTranslationItems(normalizedItems)) {
      const response = await generateObject({
        model: openrouter(modelId),
        timeout: { totalMs: TRANSLATION_TIMEOUT_MS },
        schema: translationsSchema,
        prompt: [
          "Translate the provided texts.",
          `Target locale: ${args.targetLocale}`,
          "Preserve meaning and formatting.",
          "Return JSON only with the schema { translations: [{ id, text }] }.",
          JSON.stringify({ items: chunk }),
        ].join("\n"),
      });

      for (const translation of response.object.translations) {
        resultMap[translation.id] = translation.text;
      }
    }

    return resultMap;
  } catch (error) {
    console.warn("Timeline translation failed", {
      itemCount: args.items.length,
      message: errorMessageFromUnknown(error),
    });
    return resultMap;
  }
}

export async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let result = "";

  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }

  return result;
}
