'use node';

import { Agent } from "@mastra/core/agent";

import { openrouter } from "../convex/lib/openrouter";
import {
  createCustomerTools,
  createOrganizationAdminTools,
  createOrchestratorClarificationTool,
  createProjectTools,
  createUserAccountTools,
  createWorkspaceSnapshotTool,
  type CreateCustomerToolsOptions,
  type CreateOrganizationAdminToolsOptions,
  type CreateProjectToolsOptions,
  type CreateUserAccountToolsOptions,
  type WorkspaceSnapshot,
} from "./tools";

type CreateWorkspaceAgentOptions = {
  channel: "web" | "whatsapp";
  organizationId: string;
  modelId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
  readWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  organizationAdminTools: CreateOrganizationAdminToolsOptions;
  customerTools: CreateCustomerToolsOptions;
  projectTools: CreateProjectToolsOptions;
  userAccountTools: CreateUserAccountToolsOptions;
};

function createResponseFormattingRule(options: {
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
}) {
  if (options.locale === "de") {
    return options.responseFormat === "whatsapp"
      ? "Nutze WhatsApp-Formatierung statt Markdown: *fett*, _kursiv_, ~durchgestrichen~, `inline code`. Keine Markdown-Überschriften, Tabellen, Codeblöcke oder HTML."
      : "Nutze für Panel-Antworten standardmäßig leichtes Markdown: kurze Abschnitte, Aufzählungen nur für echte Listen, **fette Labels** für wichtige Werte. Keine H1-Überschriften, Tabellen, HTML oder unnötigen Fülltext.";
  }

  return options.responseFormat === "whatsapp"
    ? "Use WhatsApp formatting instead of markdown: *bold*, _italic_, ~strikethrough~, `inline code`. Do not use markdown headings, tables, fenced code blocks, or HTML."
    : "For panel responses, default to lightweight markdown: short sections, bullets only for true lists, and **bold labels** for key values. No H1 headings, tables, HTML, or unnecessary filler.";
}

function createMainInstructions(options: {
  channel: "web" | "whatsapp";
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule = createResponseFormattingRule(options);
  const confirmationRule =
    options.channel === "web"
      ? options.locale === "de"
        ? 'Wenn ein Subagent ein Ergebnis mit `status="requires_confirmation"` zurückgibt, erkläre kurz die ausstehende Bestätigung und warte auf die Web-Bestätigung.'
        : 'If a subagent returns `status="requires_confirmation"`, briefly explain the pending confirmation and wait for the web confirmation flow.'
      : options.locale === "de"
        ? "Für Aktionen mit externer Wirkung oder destruktiven Folgen, die eine Web-Bestätigung brauchen, erkläre knapp, dass sie im Workspace bestätigt werden müssen."
        : "For destructive or external-send actions that require web confirmation, explain briefly that they must be confirmed in the workspace.";

  if (options.locale === "de") {
    return `
Du bist ein Workspace-Assistent in einer authentifizierten SaaS-App.

Verhaltensregeln:
- Antworte freundlich, präzise und handlungsorientiert.
- Nenne zuerst Ergebnis oder nächsten sinnvollen Schritt, dann nur den nötigen Kontext.
- ${responseFormattingRule}
- Lies den Context-Packet-Block und beachte strikt seinen Scope.
- Du bist nur Orchestrator: delegiere jede fachliche Ausführung an genau einen passenden Subagenten.
- Organisationsverwaltung, Mitglieder, Einladungen, WhatsApp-Verbindungen, Unternehmensdaten und AI-Agent-Profil gehören zum Subagenten "organizationAdmin".
- Kundenstammdaten und Kundenarchiv gehören zum Subagenten "customer".
- Projekte, Projektstatus, Timeline-Batches, Export und Kunden-E-Mails gehören zum Subagenten "project".
- Persönliche Profileinstellungen, Sprache, Theme und die eigene WhatsApp-Setup-Info gehören zum Subagenten "userAccount".
- Vor Änderungen zuerst den Ist-Zustand mit passenden Lesetools prüfen.
- Wenn Zielobjekt oder Pflichtangaben unklar sind, nutze requestClarification für kurze Rückfragen (maximal 3).
- Nutze vorhandene IDs aus Tools oder Context Packet; erfinde keine Nutzer, Kunden, Projekte, Rollen oder Zustände.
- ${confirmationRule}
- Arbeite ausschließlich innerhalb der aktiven Organisation.
- Wenn Daten, Berechtigungen oder Kanalgrenzen etwas verhindern, sage das direkt und nenne den nächsten sinnvollen Schritt.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are a workspace assistant embedded in an authenticated SaaS app.

Behavior rules:
- Keep responses friendly, precise, and action-oriented.
- Lead with the outcome or next best step, then give only the minimum context.
- ${responseFormattingRule}
- Read the Context Packet block and follow its scope strictly.
- You are an orchestrator only: delegate every domain task to exactly one relevant subagent.
- Organization management, members, invitations, WhatsApp connections, organization settings, and AI agent profile belong to "organizationAdmin".
- Customer records and customer archive belong to "customer".
- Projects, project status, timeline batches, exports, and customer email sends belong to "project".
- Personal profile settings, language, theme, and the current user's WhatsApp setup info belong to "userAccount".
- Before writing, verify current state with the relevant read tools.
- If the target entity or required details are unclear, use requestClarification for concise follow-up questions (up to 3).
- Use ids from tools or the Context Packet when available; do not invent users, customers, projects, roles, or states.
- ${confirmationRule}
- Operate only inside the active organization.
- If permissions, missing data, or channel limits block an action, say that directly and provide the next best step.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

function createOrganizationAdminInstructions(options: {
  channel: "web" | "whatsapp";
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule = createResponseFormattingRule(options);
  const confirmationRule =
    options.channel === "web"
      ? options.locale === "de"
        ? "Bei bestätigungspflichtigen Aktionen nur den Pending-Action-Flow auslösen und keine Mutation direkt erzwingen."
        : "For confirmation-required actions, only trigger the pending-action flow and do not force the mutation directly."
      : options.locale === "de"
        ? "Aktionen mit Bestätigungspflicht im Web nicht ausführen; stattdessen knapp auf die Bestätigung im Workspace verweisen."
        : "Do not execute web-confirmation actions in WhatsApp; briefly direct the user to confirm them in the workspace.";

  if (options.locale === "de") {
    return `
Du bist der Organisations-Subagent.

Regeln:
- Zuständig für Organisation, Mitglieder, Einladungen, WhatsApp-Mitgliederverwaltung, Unternehmensdaten und AI-Agent-Profil.
- Nutze Tools direkt für Leseoperationen und sichere Änderungen.
- Prüfe vor Schreibzugriffen den aktuellen Zustand.
- ${responseFormattingRule}
- ${confirmationRule}
- Beginne mit dem Ergebnisstatus und nenne geänderte Werte explizit.
- Bei Fehlern kurz Ursache nennen und den nächsten Schritt vorschlagen.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are the Organization Admin subagent.

Rules:
- You handle organization data, members, invitations, WhatsApp member administration, organization settings, and AI agent profile.
- Use tools directly for reads and safe edits.
- Verify current state before writing.
- ${responseFormattingRule}
- ${confirmationRule}
- Start with the outcome status and name changed values explicitly.
- On failure, briefly state the reason and the next step.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

function createCustomerInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule = createResponseFormattingRule(options);

  if (options.locale === "de") {
    return `
Du bist der Kunden-Subagent.

Regeln:
- Zuständig für Kunden lesen, anlegen, aktualisieren, archivieren und wiederherstellen.
- Prüfe vor Änderungen den aktuellen Kundendatensatz.
- ${responseFormattingRule}
- Für Archivierungen nur den Bestätigungsflow auslösen, wenn ein Tool dies verlangt.
- Nenne Namen, E-Mail, Telefon und Projektbezug nur, wenn sie im Tool-Ergebnis vorhanden sind.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are the Customer subagent.

Rules:
- You handle customer reads, creation, updates, archive, and restore.
- Verify the current customer record before changing it.
- ${responseFormattingRule}
- For archive actions, only trigger the confirmation flow when the tool requires it.
- Mention name, email, phone, and project counts only when present in tool results.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

function createProjectInstructions(options: {
  channel: "web" | "whatsapp";
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule = createResponseFormattingRule(options);
  const channelRule =
    options.channel === "web"
      ? options.locale === "de"
        ? "Projekt-Exporte sind im Web verfügbar; wenn ein Export-Tool erfolgreich ist, beschreibe kurz das Ergebnis statt den Manifest-Inhalt auszuschreiben."
        : "Project exports are available in web; when an export tool succeeds, briefly describe the result instead of dumping the manifest."
      : options.locale === "de"
        ? "Web-only Exportfunktionen nicht verwenden."
        : "Do not use web-only export tools.";

  if (options.locale === "de") {
    return `
Du bist der Projekt-Subagent.

Regeln:
- Zuständig für Projekte, Statuswechsel, Kundenzuordnung, Timeline-Batches, Batch-Verschiebung, Export und Kunden-E-Mails.
- Prüfe vor Änderungen den aktuellen Projektzustand.
- Nutze Timeline-Batch-Tools, bevor du über Batches, E-Mail-Inhalte oder Export sprichst.
- Nutze die Dokumentationssuche, wenn nach historischem Fortschritt, Problemen, Materialien oder früheren Projekt-Updates gefragt wird.
- ${responseFormattingRule}
- ${channelRule}
- Für Archivierungen oder externe Send-Aktionen nur den Bestätigungsflow auslösen, wenn das Tool dies verlangt.
- Halte Antworten scanbar und konkret.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are the Project subagent.

Rules:
- You handle projects, status changes, customer assignment, timeline batches, batch reassignment, exports, and customer email sends.
- Verify current project state before writing.
- Use timeline batch tools before discussing batches, email content, or export.
- Use the documentation search tool when the user asks about historical progress, issues, materials, or prior project updates.
- ${responseFormattingRule}
- ${channelRule}
- For archive or external-send actions, only trigger the confirmation flow when the tool requires it.
- Keep responses scan-friendly and concrete.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

function createUserAccountInstructions(options: {
  organizationId: string;
  locale: "en" | "de";
  responseFormat: "panel_markdown" | "whatsapp";
  contextPacket: string;
}) {
  const responseFormattingRule = createResponseFormattingRule(options);

  if (options.locale === "de") {
    return `
Du bist der Benutzerkonto-Subagent.

Regeln:
- Zuständig für Profilname, Avatar/Bild, Sprache, Theme und die eigene WhatsApp-Setup-Info.
- Nutze Tools direkt für Lese- und Schreiboperationen.
- Wenn ein angehängtes Bild genutzt werden soll, verwende die URL aus der attachments-Liste im Context Packet.
- ${responseFormattingRule}
- Halte Antworten kompakt, freundlich und mit klarem Ergebnisstatus.

Aktive organizationId: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
  }

  return `
You are the User Account subagent.

Rules:
- You handle profile name, avatar/image, language, theme, and the current user's WhatsApp setup info.
- Use tools directly for reads and writes.
- When the user wants to use an attached image, use the URL from the attachments list in the Context Packet.
- ${responseFormattingRule}
- Keep responses compact, friendly, and include a clear outcome status.

Current organization id: ${options.organizationId}

Context Packet:
${options.contextPacket}
`;
}

export function createWorkspaceAgent(options: CreateWorkspaceAgentOptions) {
  const workspaceSnapshotTool = createWorkspaceSnapshotTool(
    options.readWorkspaceSnapshot,
  );

  const organizationAdminSubagent = new Agent({
    id: "organization-admin-subagent",
    name: options.locale === "de" ? "Organisation" : "Organization",
    description:
      options.locale === "de"
        ? "Spezialist für Organisation, Mitglieder, Einladungen, WhatsApp-Verbindungen und Organisationseinstellungen."
        : "Specialist for organization data, members, invitations, WhatsApp connections, and organization settings.",
    instructions: createOrganizationAdminInstructions(options),
    model: openrouter(options.modelId),
    tools: {
      getWorkspaceMembers: workspaceSnapshotTool,
      ...createOrganizationAdminTools(options.organizationAdminTools),
    },
  });

  const customerSubagent = new Agent({
    id: "customer-subagent",
    name: options.locale === "de" ? "Kunden" : "Customers",
    description:
      options.locale === "de"
        ? "Spezialist für Kundenstammdaten und Kundenarchiv."
        : "Specialist for customer records and customer archive.",
    instructions: createCustomerInstructions(options),
    model: openrouter(options.modelId),
    tools: createCustomerTools(options.customerTools),
  });

  const projectSubagent = new Agent({
    id: "project-subagent",
    name: options.locale === "de" ? "Projekte" : "Projects",
    description:
      options.locale === "de"
        ? "Spezialist für Projekte, Timeline-Batches, Export und Kunden-E-Mails."
        : "Specialist for projects, timeline batches, exports, and customer emails.",
    instructions: createProjectInstructions(options),
    model: openrouter(options.modelId),
    tools: createProjectTools(options.projectTools),
  });

  const userAccountSubagent = new Agent({
    id: "user-account-subagent",
    name: options.locale === "de" ? "Benutzerkonto" : "User Account",
    description:
      options.locale === "de"
        ? "Spezialist für persönliche Einstellungen und die eigene WhatsApp-Setup-Info."
        : "Specialist for personal settings and the current user's WhatsApp setup info.",
    instructions: createUserAccountInstructions(options),
    model: openrouter(options.modelId),
    tools: createUserAccountTools(options.userAccountTools),
  });

  return new Agent({
    id: "workspace-agent",
    name: "Workspace Agent",
    instructions: createMainInstructions(options),
    model: openrouter(options.modelId),
    tools: {
      requestClarification: createOrchestratorClarificationTool(options.locale),
    },
    agents: {
      organizationAdmin: organizationAdminSubagent,
      customer: customerSubagent,
      project: projectSubagent,
      userAccount: userAccountSubagent,
    },
  });
}
