import { experimental_transcribe as transcribe } from "ai";
import { groq } from "@ai-sdk/groq";

import { normalizeAppLocale } from "../lib/locales";
import { WHATSAPP_TRANSCRIPTION_MODEL } from "./constants";

const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
let hasLoggedMissingGroqApiKey = false;

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}

export function isTranscribableWhatsAppContentType(contentType: string) {
  const normalized = contentType.trim().toLowerCase();

  return (
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized.startsWith("application/ogg") ||
    normalized.includes("opus")
  );
}

export async function transcribeWhatsAppMedia(options: {
  fileBytes: Uint8Array;
  contentType: string;
}) {
  if (!process.env.GROQ_API_KEY) {
    if (!hasLoggedMissingGroqApiKey) {
      console.warn(
        "WhatsApp media transcription skipped because GROQ_API_KEY is not configured.",
      );
      hasLoggedMissingGroqApiKey = true;
    }
    return null;
  }

  if (!isTranscribableWhatsAppContentType(options.contentType)) {
    return null;
  }

  if (options.fileBytes.byteLength > MAX_TRANSCRIBE_BYTES) {
    return null;
  }

  try {
    const result = await transcribe({
      model: groq.transcription(WHATSAPP_TRANSCRIPTION_MODEL),
      audio: options.fileBytes,
      providerOptions: {
        groq: {
          responseFormat: "verbose_json",
        },
      },
    });

    const text = result.text.trim();
    return text.length > 0
      ? {
          text,
          detectedLocale: normalizeAppLocale(result.language),
        }
      : null;
  } catch (error) {
    console.warn("WhatsApp media transcription failed", {
      contentType: options.contentType,
      message: errorMessageFromUnknown(error),
    });
    return null;
  }
}
