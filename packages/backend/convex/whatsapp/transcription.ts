import type { AppLocale } from "@mvp-template/i18n";
import { experimental_transcribe as transcribe } from "ai";
import { groq } from "@ai-sdk/groq";

import { WHATSAPP_TRANSCRIPTION_MODEL } from "./constants";

const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

function supportsTranscription(contentType: string) {
  return contentType.startsWith("audio/") || contentType.startsWith("video/");
}

export async function transcribeWhatsAppMedia(options: {
  fileBytes: Uint8Array;
  contentType: string;
  locale: AppLocale;
}) {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }

  if (!supportsTranscription(options.contentType)) {
    return null;
  }

  if (options.fileBytes.byteLength > MAX_TRANSCRIBE_BYTES) {
    return null;
  }

  const language = options.locale === "de" ? "de" : "en";

  try {
    const result = await transcribe({
      model: groq.transcription(WHATSAPP_TRANSCRIPTION_MODEL),
      audio: options.fileBytes,
      providerOptions: {
        groq: {
          language,
          responseFormat: "text",
        },
      },
    });

    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
