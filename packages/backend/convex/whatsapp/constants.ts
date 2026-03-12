export const WHATSAPP_CHANNEL = "whatsapp" as const;

export const WHATSAPP_THREAD_READINESS_BUFFER_MS = 5 * 60 * 1000;
export const WHATSAPP_ONBOARDING_TTL_MS = 30 * 60 * 1000;
export const WHATSAPP_READY_PROMPT_COOLDOWN_MS = 90 * 1000;
export const WHATSAPP_TYPING_FALLBACK_DELAY_MS = 10 * 1000;
export const WHATSAPP_OUTBOUND_CHUNK_TARGET_CHARS = 700;
export const WHATSAPP_OUTBOUND_CHUNK_HARD_LIMIT_CHARS = 1200;
export const WHATSAPP_OUTBOUND_CHUNK_DELAY_MS = 450;
export const WHATSAPP_OUTBOUND_MAX_CHUNKS = 12;

export const WHATSAPP_TURN_DETECTION_MODEL = "google/gemini-3-flash";
export const WHATSAPP_AGENT_MODEL = "google/gemini-3.1-pro";
export const WHATSAPP_TRANSCRIPTION_MODEL = "whisper-large-v3";

export const WHATSAPP_SUPPORTED_SEND_COMMANDS = [
  "/send",
  "abschicken",
  "abschicken bitte",
  "dokumentiere das",
  "senden",
  "send",
  "submit",
  "go",
] as const;

export const WHATSAPP_SUPPORTED_NEGATIVE_COMMANDS = [
  "nein",
  "noch nicht",
  "not yet",
  "no",
  "warte",
] as const;
