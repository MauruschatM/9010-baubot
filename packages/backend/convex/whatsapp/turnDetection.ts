import type { AppLocale } from "@mvp-template/i18n";
import { generateObject } from "ai";
import { z } from "zod";

import type { TurnDetectionDecision } from "./types";
import {
  hasOpenRouterFastConfig,
  openrouter,
  requireOpenRouterFastModel,
} from "../lib/openrouter";

const turnDetectionSchema = z.object({
  shouldSendNow: z.boolean(),
  shouldAskReadyConfirmation: z.boolean(),
  reason: z.string(),
});

function containsQuestionOrAction(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("?") ||
    normalized.includes("please") ||
    normalized.includes("bitte") ||
    normalized.includes("mach") ||
    normalized.includes("do ") ||
    normalized.includes("kannst") ||
    normalized.includes("can you")
  );
}

function toBinaryLocale(locale: AppLocale): "en" | "de" {
  return locale === "de" ? "de" : "en";
}

export function runTurnDetectionFallback(options: {
  text: string;
  hasMedia: boolean;
  mediaOnly: boolean;
  messageCountInBuffer: number;
  transcriptionText: string | null;
}): TurnDetectionDecision {
  const normalizedText = options.text.trim();
  const hasQuestionLikeText = containsQuestionOrAction(normalizedText);
  const hasQuestionLikeTranscription =
    options.transcriptionText !== null && containsQuestionOrAction(options.transcriptionText);

  if (!options.hasMedia && normalizedText.length > 0) {
    return {
      shouldSendNow: true,
      shouldAskReadyConfirmation: false,
      reason: "plain_text",
    };
  }

  if (options.mediaOnly && options.messageCountInBuffer <= 1) {
    return {
      shouldSendNow: false,
      shouldAskReadyConfirmation: true,
      reason: "single_media_wait",
    };
  }

  if (hasQuestionLikeText || hasQuestionLikeTranscription) {
    return {
      shouldSendNow: true,
      shouldAskReadyConfirmation: false,
      reason: "action_detected",
    };
  }

  return {
    shouldSendNow: false,
    shouldAskReadyConfirmation: options.hasMedia,
    reason: "awaiting_more_context",
  };
}

export async function detectTurnReadiness(options: {
  locale: AppLocale;
  text: string;
  hasMedia: boolean;
  mediaOnly: boolean;
  transcriptionText: string | null;
  messageCountInBuffer: number;
}) {
  const fallback = runTurnDetectionFallback(options);
  const locale = toBinaryLocale(options.locale);
  if (!hasOpenRouterFastConfig()) {
    return fallback;
  }

  try {
    const turnModel = requireOpenRouterFastModel();
    const decision = await generateObject({
      model: openrouter(turnModel),
      schema: turnDetectionSchema,
      prompt:
        locale === "de"
          ? `Bewerte, ob die Nachricht jetzt an den Agenten gesendet werden soll.\nText: ${options.text || "<leer>"}\nHat Medien: ${options.hasMedia}\nNur Medien: ${options.mediaOnly}\nTranskription: ${options.transcriptionText ?? "<keine>"}\nNachrichten im Buffer: ${options.messageCountInBuffer}\nRegeln: Normale Textnachrichten meist sofort senden. Einzelnes Bild/Video ohne Text meist nicht senden. Wenn unsicher, lieber nicht senden und ggf. Bereitheitsfrage stellen.`
          : `Decide if the buffered turn should be sent to the agent now.\nText: ${options.text || "<empty>"}\nHas media: ${options.hasMedia}\nMedia-only: ${options.mediaOnly}\nTranscription: ${options.transcriptionText ?? "<none>"}\nMessages in buffer: ${options.messageCountInBuffer}\nRules: Most plain text messages should send immediately. Most single image/video messages without text should not send yet. If uncertain, prefer not sending and ask readiness.`,
    });

    return decision.object;
  } catch {
    return fallback;
  }
}
