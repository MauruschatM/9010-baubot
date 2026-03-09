import { generateObject } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";

import { WHATSAPP_TURN_DETECTION_MODEL } from "./constants";

import type { TurnDetectionDecision } from "./types";

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
    options.transcriptionText !== null &&
    containsQuestionOrAction(options.transcriptionText);

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
  locale: "en" | "de";
  text: string;
  hasMedia: boolean;
  mediaOnly: boolean;
  transcriptionText: string | null;
  messageCountInBuffer: number;
}) {
  const turnModel = process.env.AI_GATEWAY_TURN_MODEL ?? WHATSAPP_TURN_DETECTION_MODEL;
  const fallback = runTurnDetectionFallback(options);
  if (!process.env.AI_GATEWAY_API_KEY) {
    return fallback;
  }

  try {
    const decision = await generateObject({
      model: gateway(turnModel),
      schema: turnDetectionSchema,
      prompt:
        options.locale === "de"
          ? `Bewerte, ob die Nachricht jetzt an den Agenten gesendet werden soll.\nText: ${options.text || "<leer>"}\nHat Medien: ${options.hasMedia}\nNur Medien: ${options.mediaOnly}\nTranskription: ${options.transcriptionText ?? "<keine>"}\nNachrichten im Buffer: ${options.messageCountInBuffer}\nRegeln: Normale Textnachrichten meist sofort senden. Einzelnes Bild/Video ohne Text meist nicht senden. Wenn unsicher, lieber nicht senden und ggf. Bereitheitsfrage stellen.`
          : `Decide if the buffered turn should be sent to the agent now.\nText: ${options.text || "<empty>"}\nHas media: ${options.hasMedia}\nMedia-only: ${options.mediaOnly}\nTranscription: ${options.transcriptionText ?? "<none>"}\nMessages in buffer: ${options.messageCountInBuffer}\nRules: Most plain text messages should send immediately. Most single image/video messages without text should not send yet. If uncertain, prefer not sending and ask readiness.`,
    });

    return decision.object;
  } catch {
    return fallback;
  }
}
