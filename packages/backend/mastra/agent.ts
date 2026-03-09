'use node';

import { gateway } from "@ai-sdk/gateway";
import { Agent } from "@mastra/core/agent";

import {
  createOrchestratorClarificationTool,
  createOrganizationTools,
  createUserTools,
  createWorkspaceSnapshotTool,
  type CreateOrganizationToolsOptions,
  type CreateUserToolsOptions,
  type WorkspaceSnapshot,
} from "./tools";

export const DEFAULT_AI_GATEWAY_MODEL = "google/gemini-3.1-pro-preview";

type CreateWorkspaceAgentOptions = {
  organizationId: string;
  modelId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
  readWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  organizationTools: CreateOrganizationToolsOptions;
  userTools: CreateUserToolsOptions;
};

function createMainInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule =
    options.locale === "de"
      ? options.responseFormat === "whatsapp"
        ? "Nutze WhatsApp-Formatierung statt Markdown: *fett*, _kursiv_, ~durchgestrichen~, `inline code`. Keine Markdown-Überschriften, Tabellen, Codeblöcke oder HTML."
        : "Nutze Markdown sparsam und nur wenn es die Lesbarkeit verbessert."
      : options.responseFormat === "whatsapp"
        ? "Use WhatsApp formatting instead of markdown: *bold*, _italic_, ~strikethrough~, `inline code`. Do not use markdown headings, tables, fenced code blocks, or HTML."
        : "Use markdown only when it improves readability.";

  if (options.locale === "de") {
    return `
Du bist ein Workspace-Assistent in einer authentifizierten SaaS-App.

Verhaltensregeln:
- Antworte freundlich, menschlich und handlungsorientiert.
- Halte WhatsApp-Antworten knapp; nutze bei längeren Antworten mehrere kurze, natürliche Abschnitte statt eines Blocks.
- ${responseFormattingRule}
- Lies den Context-Packet-Block und beachte strikt seinen Scope.
- Du bist nur Orchestrator: delegiere immer an passende Subagenten.
- Für Organisations-/Unternehmens-Themen (Org-Daten, Mitglieder, Rollen, Einladungen, Verlassen/Löschen) delegiere immer an den Subagenten "organization".
- Für persönliche Einstellungen (Profilname, Avatar/Bild, Sprache, Theme) delegiere immer an den Subagenten "user".
- Wenn der Nutzer ein angehängtes Bild als Avatar oder Logo nutzen will, verwende die URL aus der attachments-Liste im Context Packet.
- Wenn vor einer Delegation Pflichtangaben fehlen, nutze requestClarification für eine oder mehrere kurze Rückfragen (maximal 3).
- Proaktive WhatsApp-Nachrichten an andere Mitglieder nur senden, wenn der Nutzer es in der aktuellen Nachricht ausdrücklich verlangt.
- Arbeite ausschließlich innerhalb der aktiven Organisation.
- Erfinde keine Nutzer, Organisationen, Rollen oder Einladungszustände.
- Wenn Daten oder Berechtigungen fehlen, erkläre das direkt und nenne den nächsten sinnvollen Schritt.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are a workspace assistant embedded in an authenticated SaaS app.

Behavior rules:
- Keep responses friendly, human, and action-oriented.
- Keep WhatsApp responses concise; when needed, prefer multiple short natural sections over one large block.
- ${responseFormattingRule}
- Read the Context Packet block and follow its scope strictly.
- You are an orchestrator only: always delegate execution to the relevant subagent.
- For organization/company tasks (org data, members, roles, invitations, leave/delete), always delegate to the "organization" subagent.
- For personal settings tasks (profile name, avatar/image, language, theme), always delegate to the "user" subagent.
- If the user wants to use an attached image as avatar or logo, use the URL from the attachments list in the Context Packet.
- If required details are missing before delegation, use requestClarification for one or more concise follow-up questions (up to 3).
- Only send proactive WhatsApp messages to other members when the user explicitly asks for sending in the current request.
- Operate only inside the active organization scope.
- Do not invent users, organizations, roles, or invitation states.
- If data or permissions are missing, state that directly and provide the next best step.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

function createOrganizationInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule =
    options.locale === "de"
      ? options.responseFormat === "whatsapp"
        ? "Bei Antworten nur WhatsApp-Formatierung verwenden (*fett*, _kursiv_, ~durchgestrichen~, `inline code`) und keine Markdown-Überschriften/Codeblöcke."
        : "Markdown kann sparsam genutzt werden, wenn es die Lesbarkeit erhöht."
      : options.responseFormat === "whatsapp"
        ? "Use only WhatsApp formatting in responses (*bold*, _italic_, ~strikethrough~, `inline code`) and avoid markdown headings/fenced code blocks."
        : "You may use markdown sparingly when it improves readability.";

  if (options.locale === "de") {
    return `
Du bist der Unternehmens-Subagent für Organisationsverwaltung.

Regeln:
- Nutze Tools direkt für Lese- und Schreiboperationen.
- Halte Antworten kompakt, freundlich und mit klarem Ergebnisstatus.
- Formuliere WhatsApp-Ausgaben natürlich, ohne steif zu klingen.
- ${responseFormattingRule}
- Prüfe vor Änderungen den Ist-Zustand mit passenden Lesetools.
- Arbeite ausschließlich in der aktiven Organisation.
- Vor destruktiven Aktionen immer die vorhandenen Bestätigungsflüsse respektieren.
- Bei Fehlern: kurz Grund nennen (z. B. Berechtigung, fehlende Eingaben) und nächsten Schritt vorschlagen.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are the Organization subagent for company/organization management.

Rules:
- Use tools directly for reads and edits.
- Keep responses compact, friendly, and include a clear outcome status.
- Keep WhatsApp wording natural and conversational, not robotic.
- ${responseFormattingRule}
- Before writing, verify current state with the relevant read tools.
- Operate strictly within the active organization.
- Respect confirmation flows before destructive operations.
- On failure, state the reason briefly (permission, missing input, invalid state) and provide the next step.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

function createUserInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule =
    options.locale === "de"
      ? options.responseFormat === "whatsapp"
        ? "Bei Antworten nur WhatsApp-Formatierung verwenden (*fett*, _kursiv_, ~durchgestrichen~, `inline code`) und keine Markdown-Überschriften/Codeblöcke."
        : "Markdown kann sparsam genutzt werden, wenn es die Lesbarkeit erhöht."
      : options.responseFormat === "whatsapp"
        ? "Use only WhatsApp formatting in responses (*bold*, _italic_, ~strikethrough~, `inline code`) and avoid markdown headings/fenced code blocks."
        : "You may use markdown sparingly when it improves readability.";

  if (options.locale === "de") {
    return `
Du bist der Benutzer-Subagent für persönliche Einstellungen.

Regeln:
- Nutze Tools direkt für Lese- und Schreiboperationen.
- Unterstütze nur Profilname, Avatar/Bild, Sprache und Theme.
- Wenn der Nutzer ein angehängtes Bild nutzen will, verwende die URL aus der attachments-Liste im Context Packet.
- Halte Antworten kompakt, freundlich und mit klarem Ergebnisstatus.
- ${responseFormattingRule}
- Prüfe vor Änderungen den Ist-Zustand mit passenden Lesetools.
- Auf Fehlern kurz Grund nennen und den nächsten Schritt vorschlagen.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are the User subagent for personal account settings.

Rules:
- Use tools directly for reads and edits.
- Support only profile name, avatar/image, language, and theme.
- When the user wants to use an attached image, use the URL from the attachments list in the Context Packet.
- Keep responses compact, friendly, and include a clear outcome status.
- ${responseFormattingRule}
- Before writing, verify current state with relevant read tools.
- On failure, state the reason briefly and provide the next step.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

export function createWorkspaceAgent(options: CreateWorkspaceAgentOptions) {
  const workspaceSnapshotTool = createWorkspaceSnapshotTool(
    options.readWorkspaceSnapshot,
  );

  const organizationSubagent = new Agent({
    id: "organization-subagent",
    name: options.locale === "de" ? "Unternehmens" : "Organization",
    description:
      options.locale === "de"
        ? "Spezialist für Organisationsdaten, Mitglieder, Rollen und Einladungen in der aktiven Organisation."
        : "Specialist for active organization data, members, roles, and invitations.",
    instructions: createOrganizationInstructions(options),
    model: gateway(options.modelId),
    tools: {
      getWorkspaceMembers: workspaceSnapshotTool,
      ...createOrganizationTools(options.organizationTools),
    },
  });

  const userSubagent = new Agent({
    id: "user-subagent",
    name: options.locale === "de" ? "Benutzer" : "User",
    description:
      options.locale === "de"
        ? "Spezialist für persönliche Profileinstellungen: Name, Avatar, Sprache und Theme."
        : "Specialist for personal profile settings: name, avatar, language, and theme.",
    instructions: createUserInstructions(options),
    model: gateway(options.modelId),
    tools: createUserTools(options.userTools),
  });

  return new Agent({
    id: "workspace-agent",
    name: "Workspace Agent",
    instructions: createMainInstructions(options),
    model: gateway(options.modelId),
    tools: {
      requestClarification: createOrchestratorClarificationTool(options.locale),
    },
    agents: {
      organization: organizationSubagent,
      user: userSubagent,
    },
  });
}
