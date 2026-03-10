import { SUPPORTED_LOCALES, normalizeLocale, type AppLocale } from "@mvp-template/i18n";
import { v } from "convex/values";

const APP_LOCALE_VALIDATORS = [
  v.literal("en"),
  v.literal("de"),
  v.literal("pl"),
  v.literal("ar"),
  v.literal("ro"),
  v.literal("tr"),
  v.literal("bg"),
  v.literal("hr"),
  v.literal("sr"),
  v.literal("bs"),
  v.literal("uk"),
  v.literal("ru"),
  v.literal("it"),
  v.literal("ar-PS"),
] as const;

export const appLocaleValues = [...SUPPORTED_LOCALES];
export const vAppLocale = v.union(...APP_LOCALE_VALIDATORS);
export const vNullableAppLocale = v.union(vAppLocale, v.null());

export function normalizeAppLocale(input: string | null | undefined): AppLocale | null {
  return normalizeLocale(input);
}

export function toBinaryLocale(locale: AppLocale | null | undefined): "en" | "de" {
  return locale === "de" ? "de" : "en";
}

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  if (!value) {
    return false;
  }

  return normalizeLocale(value) === value;
}
