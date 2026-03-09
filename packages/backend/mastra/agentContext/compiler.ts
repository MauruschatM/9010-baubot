import {
  type AgentContextCapability,
  type AgentContextHistoryPreview,
  type AgentContextLocale,
  type AgentContextPageContext,
  type AgentContextPacket,
  type AgentToolPermissionFlags,
} from "./types";
import { AGENT_CONTEXT_PACKET_VERSION } from "./version";

const MAX_HISTORY_PREVIEW_MESSAGES = 8;
const MAX_HISTORY_PREVIEW_TEXT_LENGTH = 300;

function toHistoryPreviewText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_HISTORY_PREVIEW_TEXT_LENGTH);
}

function toCapabilities(
  permissions: AgentToolPermissionFlags,
): AgentContextCapability[] {
  const capabilities: AgentContextCapability[] = ["read_organization"];

  if (permissions.canInviteMembers) {
    capabilities.push("invite_member");
  }
  if (permissions.canUpdateOrganization) {
    capabilities.push("update_organization");
  }
  if (permissions.canUpdateMembers) {
    capabilities.push("update_member_role");
  }
  if (permissions.canRemoveMembers) {
    capabilities.push("remove_member");
  }
  if (permissions.canCancelInvitations) {
    capabilities.push("cancel_invitation");
  }
  if (permissions.canDeleteOrganization) {
    capabilities.push("delete_organization");
  }
  if (permissions.canLeaveOrganization) {
    capabilities.push("leave_organization");
  }

  return capabilities;
}

export function compileAgentContextPacket(options: {
  locale: AgentContextLocale;
  organizationId: string;
  threadId: string;
  userId: string;
  currentMemberRole: string;
  prompt: string;
  attachmentNames: string[];
  attachments: Array<{
    name: string;
    contentType: string;
    storageId: string;
    fileUrl: string | null;
  }>;
  pageContext: AgentContextPageContext | null;
  permissions: AgentToolPermissionFlags;
  historyMessages: Array<{
    id: string;
    role: "system" | "user" | "assistant" | "tool";
    content: unknown;
    createdAt: number;
  }>;
}): AgentContextPacket {
  const historyPreview = options.historyMessages.reduce<AgentContextHistoryPreview[]>(
    (preview, message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return preview;
      }

      const text = toHistoryPreviewText(message.content);
      if (text.length === 0) {
        return preview;
      }

      preview.push({
        id: message.id,
        role: message.role,
        text,
        createdAt: message.createdAt,
      });
      return preview;
    },
    [],
  );

  const slicedHistoryPreview =
    historyPreview.length > MAX_HISTORY_PREVIEW_MESSAGES
      ? historyPreview.slice(-MAX_HISTORY_PREVIEW_MESSAGES)
      : historyPreview;

  return {
    version: AGENT_CONTEXT_PACKET_VERSION,
    generatedAt: Date.now(),
    locale: options.locale,
    organizationId: options.organizationId,
    threadId: options.threadId,
    userId: options.userId,
    currentMemberRole: options.currentMemberRole,
    prompt: options.prompt,
    attachmentNames: options.attachmentNames,
    attachments: options.attachments,
    permissions: options.permissions,
    capabilities: toCapabilities(options.permissions),
    historyPreview: slicedHistoryPreview,
    pageContext: options.pageContext,
  };
}

export function formatContextPacketForInstructions(
  packet: AgentContextPacket,
): string {
  const preview = packet.historyPreview.map((message) => ({
    role: message.role,
    text: message.text,
  }));

  return JSON.stringify(
    {
      version: packet.version,
      locale: packet.locale,
      organizationId: packet.organizationId,
      threadId: packet.threadId,
      userId: packet.userId,
      currentMemberRole: packet.currentMemberRole,
      capabilities: packet.capabilities,
      attachmentNames: packet.attachmentNames,
      attachments: packet.attachments.map((attachment) => ({
        name: attachment.name,
        contentType: attachment.contentType,
        fileUrl: attachment.fileUrl,
      })),
      pageContext: packet.pageContext,
      historyPreview: preview,
      latestUserPrompt: packet.prompt,
    },
    null,
    2,
  );
}
