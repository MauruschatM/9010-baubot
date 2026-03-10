import { arPsMessages } from "../../../baubot-prototype/packages/i18n/src/content/ar-PS/messages";
import { bgMessages } from "../../../baubot-prototype/packages/i18n/src/content/bg/messages";
import { bsMessages } from "../../../baubot-prototype/packages/i18n/src/content/bs/messages";
import { enMessages as prototypeEnMessages } from "../../../baubot-prototype/packages/i18n/src/content/en/messages";
import { hrMessages } from "../../../baubot-prototype/packages/i18n/src/content/hr/messages";
import { itMessages } from "../../../baubot-prototype/packages/i18n/src/content/it/messages";
import { plMessages } from "../../../baubot-prototype/packages/i18n/src/content/pl/messages";
import { roMessages } from "../../../baubot-prototype/packages/i18n/src/content/ro/messages";
import { ruMessages } from "../../../baubot-prototype/packages/i18n/src/content/ru/messages";
import { srMessages } from "../../../baubot-prototype/packages/i18n/src/content/sr/messages";
import { trMessages } from "../../../baubot-prototype/packages/i18n/src/content/tr/messages";
import { ukMessages } from "../../../baubot-prototype/packages/i18n/src/content/uk/messages";

import { type TranslationTree } from "./messages.schema";
import { messagesEn } from "./messages.en";

type PrototypeFlatMessages = Record<string, string>;

const prototypeKeyByExactText = new Map<string, string>();
const prototypeKeyByNormalizedText = new Map<string, string>();

for (const [prototypeKey, englishValue] of Object.entries(prototypeEnMessages)) {
  const normalizedValue = normalizeMessageLookup(englishValue);

  if (!prototypeKeyByExactText.has(englishValue)) {
    prototypeKeyByExactText.set(englishValue, prototypeKey);
  }

  if (normalizedValue && !prototypeKeyByNormalizedText.has(normalizedValue)) {
    prototypeKeyByNormalizedText.set(normalizedValue, prototypeKey);
  }
}

function normalizeMessageLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function resolvePrototypeKey(message: string): string | undefined {
  return (
    prototypeKeyByExactText.get(message) ??
    prototypeKeyByNormalizedText.get(normalizeMessageLookup(message))
  );
}

function buildMessagesFromPrototypeFlat(
  node: TranslationTree,
  localeMessages: PrototypeFlatMessages,
): TranslationTree {
  const translatedEntries = Object.entries(node).map(([key, value]) => {
    if (typeof value === "string") {
      const prototypeKey = resolvePrototypeKey(value);
      return [key, (prototypeKey && localeMessages[prototypeKey]) || value] as const;
    }

    return [key, buildMessagesFromPrototypeFlat(value, localeMessages)] as const;
  });

  return Object.fromEntries(translatedEntries);
}

const baseMessages = messagesEn as TranslationTree;

export const messagesPl = buildMessagesFromPrototypeFlat(baseMessages, plMessages);
export const messagesAr = buildMessagesFromPrototypeFlat(baseMessages, arPsMessages);
export const messagesRo = buildMessagesFromPrototypeFlat(baseMessages, roMessages);
export const messagesTr = buildMessagesFromPrototypeFlat(baseMessages, trMessages);
export const messagesBg = buildMessagesFromPrototypeFlat(baseMessages, bgMessages);
export const messagesHr = buildMessagesFromPrototypeFlat(baseMessages, hrMessages);
export const messagesSr = buildMessagesFromPrototypeFlat(baseMessages, srMessages);
export const messagesBs = buildMessagesFromPrototypeFlat(baseMessages, bsMessages);
export const messagesUk = buildMessagesFromPrototypeFlat(baseMessages, ukMessages);
export const messagesRu = buildMessagesFromPrototypeFlat(baseMessages, ruMessages);
export const messagesIt = buildMessagesFromPrototypeFlat(baseMessages, itMessages);
export const messagesArPs = buildMessagesFromPrototypeFlat(baseMessages, arPsMessages);
