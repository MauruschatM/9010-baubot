import {
  WHATSAPP_SUPPORTED_NEGATIVE_COMMANDS,
  WHATSAPP_SUPPORTED_SEND_COMMANDS,
} from "./constants";

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

export function normalizePhoneNumber(raw: string) {
  const withoutPrefix = raw.replace(/^whatsapp:/i, "").trim();
  const prefixed = withoutPrefix.startsWith("+")
    ? withoutPrefix
    : `+${withoutPrefix}`;
  const digits = digitsOnly(prefixed);

  if (digits.length < 7 || digits.length > 16) {
    return null;
  }

  return {
    e164: `+${digits}`,
    digits,
  };
}

const GERMAN_LOCALE_COUNTRY_CODES = ["49", "43", "423"];

export function inferLocaleFromPhoneNumber(phoneNumberE164: string): "en" | "de" {
  const digits = digitsOnly(phoneNumberE164);
  return GERMAN_LOCALE_COUNTRY_CODES.some((countryCode) => digits.startsWith(countryCode))
    ? "de"
    : "en";
}

export function normalizeIncomingText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function normalizeCommandText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function extractEmailCandidate(value: string) {
  const match = value
    .trim()
    .toLowerCase()
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);

  return match?.[0] ?? null;
}

export function extractOtpCandidate(value: string) {
  const match = value.replace(/\s+/g, "").match(/\b\d{6}\b/);
  return match?.[0] ?? null;
}

export function isSendCommand(value: string) {
  const normalized = normalizeCommandText(value);
  return (
    WHATSAPP_SUPPORTED_SEND_COMMANDS.some((command) => normalized === command) ||
    normalized.includes(" abschicken") ||
    normalized.includes(" send")
  );
}

export function extractDocumentationTextFromSendCommand(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = normalizeCommandText(trimmed);
  if (WHATSAPP_SUPPORTED_SEND_COMMANDS.some((command) => normalized === command)) {
    return "";
  }

  return trimmed
    .replace(/(^|\s)\/send(?=$|\s)/gi, " ")
    .replace(/(^|\s)send(?=$|\s)/gi, " ")
    .replace(/(^|\s)senden(?=$|\s)/gi, " ")
    .replace(/(^|\s)abschicken(?=$|\s)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNegativeCommand(value: string) {
  const normalized = normalizeCommandText(value);
  return WHATSAPP_SUPPORTED_NEGATIVE_COMMANDS.some((command) => normalized === command);
}

export function isSwitchCommand(value: string) {
  const normalized = normalizeCommandText(value);
  return normalized === "/switch" || normalized === "switch" || normalized === "wechseln";
}

export function isUnlinkCommand(value: string) {
  const normalized = normalizeCommandText(value);
  return normalized === "/unlink" || normalized === "unlink" || normalized === "trennen";
}

export function isAffirmativeAnswer(value: string) {
  const normalized = normalizeCommandText(value);
  return (
    normalized === "ja" ||
    normalized === "yes" ||
    normalized === "ok" ||
    normalized === "okay" ||
    normalized === "confirm"
  );
}

export function slugFromOrganizationSeed(seed: string) {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);

  const fallback = normalized.length > 0 ? normalized : "workspace";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${fallback}-${suffix}`;
}

const EXPLICIT_SEND_PATTERNS = [
  /\bsend\b/,
  /\bmessage\b/,
  /\btext\b/,
  /\bnotify\b/,
  /\bping\b/,
  /\bwhatsapp\b/,
  /\bsende\b/,
  /\bschick(?:e|en)?\b/,
  /\bnachricht\b/,
  /\bbenachrichtige\b/,
  /\bschreibe\b/,
];

export function hasExplicitProactiveSendIntent(value: string) {
  const normalized = normalizeCommandText(value);
  if (!normalized) {
    return false;
  }

  return EXPLICIT_SEND_PATTERNS.some((pattern) => pattern.test(normalized));
}
