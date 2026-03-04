'use node';

import { gateway } from "@ai-sdk/gateway";
import { Agent } from "@mastra/core/agent";

import {
  createOrganizationTools,
  createWorkspaceSnapshotTool,
  type CreateOrganizationToolsOptions,
  type WorkspaceSnapshot,
} from "./tools";

export const DEFAULT_AI_GATEWAY_MODEL = "google/gemini-3.1-pro-preview";

type CreateWorkspaceAgentOptions = {
  organizationId: string;
  modelId: string;
  locale: "en" | "de";
  readWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  organizationTools: CreateOrganizationToolsOptions;
};

function createMainInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
}) {
  if (options.locale === "de") {
    return `
Du bist ein Workspace-Assistent in einer authentifizierten SaaS-App.

Verhaltensregeln:
- Antworte kurz, klar und handlungsorientiert.
- Nutze Markdown sparsam und nur wenn es die Lesbarkeit verbessert.
- Für Mitglieder-/Einladungsfragen nutze zuerst getWorkspaceMembers.
- Für Organisations-/Unternehmens-Themen (Org-Daten, Mitglieder, Rollen, Einladungen, Verlassen/Löschen) delegiere immer an den Subagenten "organization".
- Arbeite ausschließlich innerhalb der aktiven Organisation.
- Erfinde keine Nutzer, Organisationen, Rollen oder Einladungszustände.
- Wenn Daten oder Berechtigungen fehlen, erkläre das direkt und nenne den nächsten sinnvollen Schritt.

Aktive organizationId: ${options.organizationId}
`;
  }

  return `
You are a workspace assistant embedded in an authenticated SaaS app.

Behavior rules:
- Keep responses concise, clear, and action-oriented.
- Use markdown only when it improves readability.
- For membership or invitation questions, call getWorkspaceMembers first.
- For organization/company tasks (org data, members, roles, invitations, leave/delete), always delegate to the "organization" subagent.
- Operate only inside the active organization scope.
- Do not invent users, organizations, roles, or invitation states.
- If data or permissions are missing, state that directly and provide the next best step.

Current organization id: ${options.organizationId}
`;
}

function createOrganizationInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
}) {
  if (options.locale === "de") {
    return `
Du bist der Unternehmens-Subagent für Organisationsverwaltung.

Regeln:
- Nutze Tools direkt für Lese- und Schreiboperationen.
- Halte Antworten kompakt und mit klarem Ergebnisstatus.
- Arbeite ausschließlich in der aktiven Organisation.
- Vor destruktiven Aktionen immer die vorhandenen Bestätigungsflüsse respektieren.
- Bei Fehlern: kurz Grund nennen (z. B. Berechtigung, fehlende Eingaben) und nächsten Schritt vorschlagen.

Aktive organizationId: ${options.organizationId}
`;
  }

  return `
You are the Organization subagent for company/organization management.

Rules:
- Use tools directly for reads and edits.
- Keep responses compact and include a clear outcome status.
- Operate strictly within the active organization.
- Respect confirmation flows before destructive operations.
- On failure, state the reason briefly (permission, missing input, invalid state) and provide the next step.

Current organization id: ${options.organizationId}
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
    tools: createOrganizationTools(options.organizationTools),
  });

  return new Agent({
    id: "workspace-agent",
    name: "Workspace Agent",
    instructions: createMainInstructions(options),
    model: gateway(options.modelId),
    tools: {
      getWorkspaceMembers: workspaceSnapshotTool,
    },
    agents: {
      organization: organizationSubagent,
    },
  });
}
