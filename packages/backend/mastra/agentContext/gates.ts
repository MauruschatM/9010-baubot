import { clarificationPromptsDe } from "./prompts.de";
import { clarificationPromptsEn } from "./prompts.en";
import type {
  AgentContextPacket,
  ClarificationGateDecision,
  ClarificationIntent,
  ClarificationPromptPack,
} from "./types";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LOOKS_LIKE_ID_PATTERN =
  /\b(id|member[-_ ]?id|invitation[-_ ]?id|mitglieds[-_ ]?id|einladungs[-_ ]?id)\b/i;
const ROLE_PATTERN = /\b(owner|admin|member|inhaber|mitglied)\b/i;
const ORG_FIELD_PATTERN = /\b(name|slug|logo|titel|bezeichnung)\b/i;
const VALUE_PATTERN = /["'`][^"'`]{2,}["'`]/;

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function detectIntent(prompt: string): ClarificationIntent {
  const normalizedPrompt = prompt.toLowerCase();

  if (
    includesAny(normalizedPrompt, [
      "invite member",
      "invite user",
      "add member",
      "create invitation",
      "einladen",
      "mitglied hinzuf",
    ])
  ) {
    return "invite_member";
  }

  if (
    includesAny(normalizedPrompt, [
      "change role",
      "update role",
      "set role",
      "promote",
      "demote",
      "rolle ändern",
      "rolle aendern",
      "rolle setzen",
      "mitgliederrolle",
    ])
  ) {
    return "update_member_role";
  }

  if (
    includesAny(normalizedPrompt, [
      "remove member",
      "kick member",
      "delete member",
      "mitglied entfernen",
      "mitglied loeschen",
      "mitglied löschen",
    ])
  ) {
    return "remove_member";
  }

  if (
    includesAny(normalizedPrompt, [
      "cancel invitation",
      "revoke invitation",
      "delete invitation",
      "einladung widerrufen",
      "einladung entfernen",
      "einladung loeschen",
      "einladung löschen",
    ])
  ) {
    return "cancel_invitation";
  }

  if (
    includesAny(normalizedPrompt, [
      "update organization",
      "rename organization",
      "change organization",
      "update company",
      "rename company",
      "organisation aktualisieren",
      "organisation umbenennen",
      "unternehmen umbenennen",
      "unternehmensdaten ändern",
      "unternehmensdaten aendern",
    ])
  ) {
    return "update_organization";
  }

  return "generic";
}

function hasTargetIdentifier(prompt: string) {
  return EMAIL_PATTERN.test(prompt) || LOOKS_LIKE_ID_PATTERN.test(prompt);
}

function needsClarification(intent: ClarificationIntent, prompt: string) {
  if (intent === "generic") {
    return false;
  }

  if (intent === "invite_member") {
    return !EMAIL_PATTERN.test(prompt);
  }

  if (intent === "remove_member") {
    return !hasTargetIdentifier(prompt);
  }

  if (intent === "cancel_invitation") {
    return !hasTargetIdentifier(prompt);
  }

  if (intent === "update_member_role") {
    const hasTarget = hasTargetIdentifier(prompt);
    const hasRole = ROLE_PATTERN.test(prompt);
    return !hasTarget || !hasRole;
  }

  if (intent === "update_organization") {
    const hasField = ORG_FIELD_PATTERN.test(prompt);
    const hasValue = VALUE_PATTERN.test(prompt);
    return !hasField || !hasValue;
  }

  return false;
}

function getPromptPack(locale: "en" | "de"): ClarificationPromptPack {
  return locale === "de" ? clarificationPromptsDe : clarificationPromptsEn;
}

export function runClarificationGate(packet: AgentContextPacket): ClarificationGateDecision {
  const intent = detectIntent(packet.prompt);

  if (!needsClarification(intent, packet.prompt)) {
    return {
      kind: "continue",
    };
  }

  const promptPack = getPromptPack(packet.locale);

  return {
    kind: "clarification",
    intent,
    template: promptPack[intent],
  };
}
