import {
  normalizeLocale,
  type AppLocale,
} from "@mvp-template/i18n";

export const SELECTABLE_LANGUAGE_LOCALES = [
  "en",
  "de",
  "pl",
  "ar",
  "ro",
  "tr",
  "bg",
  "hr",
  "sr",
  "bs",
  "uk",
  "ru",
  "it",
] as const satisfies readonly AppLocale[];
export type SelectableLanguageLocale = (typeof SELECTABLE_LANGUAGE_LOCALES)[number];
export const FREQUENT_LANGUAGE_LOCALES = ["en", "de", "pl", "ar"] as const satisfies
  readonly SelectableLanguageLocale[];
export const EUROPE_LANGUAGE_LOCALES = [
  "ro",
  "tr",
  "bg",
  "hr",
  "sr",
  "bs",
  "uk",
  "ru",
  "it",
] as const satisfies readonly SelectableLanguageLocale[];

const LOCALE_OPTION_META: Record<AppLocale, { flag: string; name: string }> = {
  en: { flag: "🇬🇧", name: "English" },
  de: { flag: "🇩🇪", name: "Deutsch" },
  pl: { flag: "🇵🇱", name: "Polski" },
  ar: { flag: "🇸🇦", name: "العربية" },
  ro: { flag: "🇷🇴", name: "Română" },
  tr: { flag: "🇹🇷", name: "Türkçe" },
  bg: { flag: "🇧🇬", name: "Български" },
  hr: { flag: "🇭🇷", name: "Hrvatski" },
  sr: { flag: "🇷🇸", name: "Srpski" },
  bs: { flag: "🇧🇦", name: "Bosanski" },
  uk: { flag: "🇺🇦", name: "Українська" },
  ru: { flag: "🇷🇺", name: "Русский" },
  it: { flag: "🇮🇹", name: "Italiano" },
  "ar-PS": { flag: "🇵🇸", name: "العربية (فلسطين)" },
};

export function localeOptionFlag(locale: AppLocale): string {
  return LOCALE_OPTION_META[locale].flag;
}

export function localeOptionName(locale: AppLocale): string {
  return LOCALE_OPTION_META[locale].name;
}

export function localeOptionLabel(locale: AppLocale): string {
  return `${localeOptionFlag(locale)} ${localeOptionName(locale)}`;
}

export function normalizeSelectableLocale(
  value: string | null | undefined,
): SelectableLanguageLocale | null {
  const normalized = normalizeLocale(value);
  if (!normalized) {
    return null;
  }

  if (normalized === "ar-PS") {
    return "ar";
  }

  return SELECTABLE_LANGUAGE_LOCALES.includes(normalized as SelectableLanguageLocale)
    ? (normalized as SelectableLanguageLocale)
    : null;
}
