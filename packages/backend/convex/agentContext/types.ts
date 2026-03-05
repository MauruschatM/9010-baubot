export type AgentContextLocale = "en" | "de";

export type AgentToolPermissionFlags = {
  canUpdateOrganization: boolean;
  canInviteMembers: boolean;
  canUpdateMembers: boolean;
  canRemoveMembers: boolean;
  canCancelInvitations: boolean;
  canDeleteOrganization: boolean;
  canLeaveOrganization: boolean;
};

export type AgentContextCapability =
  | "read_organization"
  | "invite_member"
  | "update_organization"
  | "update_member_role"
  | "remove_member"
  | "cancel_invitation"
  | "delete_organization"
  | "leave_organization";

export type AgentContextHistoryPreview = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
};

export type AgentContextAttachment = {
  name: string;
  contentType: string;
  storageId: string;
  fileUrl: string | null;
};

export type AgentContextMemberPreview = {
  name: string;
  email: string;
  role: string;
};

export type AgentContextInvitationPreview = {
  email: string;
  role: string;
};

export type AgentContextMembersPageSummary = {
  totalCount: number;
  filteredCount: number;
  pendingInvitationCount: number;
  currentMemberRole: string | null;
  visibleMembers: AgentContextMemberPreview[];
  visibleInvitations: AgentContextInvitationPreview[];
};

export type AgentContextPageContext = {
  routeId: string;
  routePath: string;
  title: string;
  searchQuery: string | null;
  members: AgentContextMembersPageSummary | null;
};

export type AgentContextPacket = {
  version: string;
  generatedAt: number;
  locale: AgentContextLocale;
  organizationId: string;
  threadId: string;
  userId: string;
  currentMemberRole: string;
  prompt: string;
  attachmentNames: string[];
  attachments: AgentContextAttachment[];
  permissions: AgentToolPermissionFlags;
  capabilities: AgentContextCapability[];
  historyPreview: AgentContextHistoryPreview[];
  pageContext: AgentContextPageContext | null;
};

export type ClarificationIntent =
  | "generic"
  | "invite_member"
  | "remove_member"
  | "update_member_role"
  | "cancel_invitation"
  | "update_organization";

export type ClarificationQuestionOption = {
  id: string;
  label: string;
  description: string;
};

export type ClarificationQuestion = {
  id: string;
  prompt: string;
  options: ClarificationQuestionOption[];
  allowOther: boolean;
  required: boolean;
};

export type ClarificationPromptTemplate = {
  title: string;
  description: string;
  assistantMessage: string;
  questions: ClarificationQuestion[];
};

export type ClarificationPromptPack = {
  generic: ClarificationPromptTemplate;
  invite_member: ClarificationPromptTemplate;
  remove_member: ClarificationPromptTemplate;
  update_member_role: ClarificationPromptTemplate;
  cancel_invitation: ClarificationPromptTemplate;
  update_organization: ClarificationPromptTemplate;
};

export type ClarificationGateDecision =
  | {
      kind: "continue";
    }
  | {
      kind: "clarification";
      intent: ClarificationIntent;
      template: ClarificationPromptTemplate;
    };

export type AgentResponseKind = "answer" | "clarification" | "approval_required";
