"use node";

import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { GenericActionCtx } from "convex/server";
import { z } from "zod";

import type { DataModel } from "./_generated/dataModel";
import type { AppLocale } from "@mvp-template/i18n";

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

export async function translateTextsWithGemini(
  _ctx: GenericActionCtx<DataModel>,
  args: TranslateTextOptions,
): Promise<Record<string, string>> {
  const resultMap: Record<string, string> = {};

  for (const item of args.items) {
    resultMap[item.id] = item.text;
  }

  if (args.items.length === 0 || !process.env.AI_GATEWAY_API_KEY) {
    return resultMap;
  }

  try {
    const modelId = process.env.AI_GATEWAY_TRANSLATION_MODEL ?? process.env.AI_GATEWAY_MODEL;
    if (!modelId) {
      return resultMap;
    }

    const response = await generateObject({
      model: gateway(modelId),
      schema: translationsSchema,
      prompt: [
        "Translate the provided texts.",
        `Target locale: ${args.targetLocale}`,
        "Preserve meaning and formatting.",
        "Return JSON only with the schema { translations: [{ id, text }] }.",
        JSON.stringify({ items: args.items }),
      ].join("\n"),
    });

    for (const translation of response.object.translations) {
      resultMap[translation.id] = translation.text;
    }
  } catch {
    return resultMap;
  }

  return resultMap;
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
