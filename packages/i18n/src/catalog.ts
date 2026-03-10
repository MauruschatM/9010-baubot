import { z } from "zod";

import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import { messagesDe } from "./messages.de";
import { messagesEn } from "./messages.en";
import {
  messagesAr,
  messagesArPs,
  messagesBg,
  messagesBs,
  messagesHr,
  messagesIt,
  messagesPl,
  messagesRo,
  messagesRu,
  messagesSr,
  messagesTr,
  messagesUk,
} from "./messages.prototype";
import {
  createTranslationSchema,
  type TranslationLeafPaths,
  type TranslationTree,
} from "./messages.schema";
import { validateMessagesCatalog } from "./validate";

const rawCatalog = {
  en: messagesEn,
  de: messagesDe,
  pl: messagesPl,
  ar: messagesAr,
  ro: messagesRo,
  tr: messagesTr,
  bg: messagesBg,
  hr: messagesHr,
  sr: messagesSr,
  bs: messagesBs,
  uk: messagesUk,
  ru: messagesRu,
  it: messagesIt,
  "ar-PS": messagesArPs,
} satisfies Record<AppLocale, unknown>;

export const messagesCatalog = validateMessagesCatalog(rawCatalog, {
  baseLocale: DEFAULT_LOCALE,
});

export type Messages = (typeof messagesCatalog)[AppLocale];
export const messagesSchema = createTranslationSchema(messagesEn);
export type BaseMessages = z.infer<typeof messagesSchema>;
export type TranslationKey = TranslationLeafPaths<BaseMessages>;

export type TranslationVariables = Record<string, string | number>;

function collectLeafPaths(tree: TranslationTree, pathPrefix = "", target: string[] = []) {
  for (const [key, value] of Object.entries(tree)) {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (typeof value === "string") {
      target.push(nextPath);
      continue;
    }

    collectLeafPaths(value, nextPath, target);
  }

  return target;
}

export const translationKeys = collectLeafPaths(messagesEn) as TranslationKey[];
const translationKeySet = new Set<string>(translationKeys);

export const translationKeySchema: z.ZodType<TranslationKey> = z.custom<TranslationKey>(
  (value) => typeof value === "string" && translationKeySet.has(value),
  {
    message: "Invalid translation key",
  },
);

export function isTranslationKey(value: string): value is TranslationKey {
  return translationKeySchema.safeParse(value).success;
}

function getByPath(tree: TranslationTree, path: string): string | undefined {
  const parts = path.split(".");
  let cursor: string | TranslationTree | undefined = tree;

  for (const part of parts) {
    if (!cursor || typeof cursor === "string") {
      return undefined;
    }

    cursor = cursor[part];
  }

  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, variables?: TranslationVariables) {
  if (!variables) {
    return template;
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return full;
    }

    return String(value);
  });
}

export function getMessagesForLocale(locale: AppLocale): Messages {
  return messagesCatalog[locale] ?? messagesCatalog[DEFAULT_LOCALE];
}

export function hasMessage(locale: AppLocale, key: TranslationKey | string): boolean {
  return getByPath(getMessagesForLocale(locale), key) !== undefined;
}

export function translateForLocale(
  locale: AppLocale,
  key: TranslationKey,
  variables?: TranslationVariables,
) {
  const localeMessages = getMessagesForLocale(locale);
  const message =
    getByPath(localeMessages, key) ?? getByPath(messagesCatalog[DEFAULT_LOCALE], key);

  if (!message) {
    return key;
  }

  return interpolate(message, variables);
}

export type Translator = (key: TranslationKey, variables?: TranslationVariables) => string;

export function createTranslator(locale: AppLocale): Translator {
  return (key, variables) => translateForLocale(locale, key, variables);
}
