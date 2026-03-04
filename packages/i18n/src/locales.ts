export const SUPPORTED_LOCALES = ["en", "de"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const SYSTEM_LOCALE = "system" as const;
export type LocalePreference = AppLocale | typeof SYSTEM_LOCALE;

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "locale";

const SUPPORTED_SET = new Set<AppLocale>(SUPPORTED_LOCALES);

export function isAppLocale(value: string): value is AppLocale {
  return SUPPORTED_SET.has(value as AppLocale);
}

export function normalizeLocale(input: string | null | undefined): AppLocale | null {
  if (!input) {
    return null;
  }

  const normalized = input.trim().replace("_", "-").toLowerCase();
  if (!normalized) {
    return null;
  }

  if (isAppLocale(normalized)) {
    return normalized;
  }

  const [language] = normalized.split("-");
  if (language && isAppLocale(language)) {
    return language;
  }

  return null;
}

export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName !== name) {
      continue;
    }

    const value = rawValueParts.join("=");
    return value ? decodeURIComponent(value) : "";
  }

  return null;
}
