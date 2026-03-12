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
  email: string | null;
  phoneNumberE164: string | null;
  memberType: "standard" | "phone_only";
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

export type AgentContextProjectPreview = {
  id: string;
  location: string;
  status: string;
  hasUnreviewedChanges: boolean;
  hasNachtrag: boolean;
};

export type AgentContextProjectsPageSummary = {
  totalCount: number;
  activeCount: number;
  doneCount: number;
  currentProject: {
    id: string;
    location: string;
    status: string;
  } | null;
  visibleProjects: AgentContextProjectPreview[];
};

export type AgentContextCustomerPreview = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  activeProjectCount: number;
  doneProjectCount: number;
};

export type AgentContextCustomersPageSummary = {
  totalCount: number;
  currentCustomer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  visibleCustomers: AgentContextCustomerPreview[];
};

export type AgentContextArchivedCustomerPreview = {
  id: string;
  name: string;
  deletedAt: number;
};

export type AgentContextArchivedProjectPreview = {
  id: string;
  location: string;
  status: string;
  deletedAt: number;
};

export type AgentContextArchivePageSummary = {
  archivedCustomerCount: number;
  archivedProjectCount: number;
  visibleArchivedCustomers: AgentContextArchivedCustomerPreview[];
  visibleArchivedProjects: AgentContextArchivedProjectPreview[];
};

export type AgentContextShellSummary = {
  organizationName: string | null;
  companyEmail: string | null;
  companyEmailLocale: string | null;
  agentProfileName: string | null;
  agentStyleId: string | null;
  whatsappPhoneNumberE164: string | null;
  myWhatsAppPhoneNumberE164: string | null;
  myWhatsAppConnected: boolean | null;
};

export type AgentContextPageContext = {
  routeId: string;
  routePath: string;
  title: string;
  searchQuery: string | null;
  members: AgentContextMembersPageSummary | null;
  customers: AgentContextCustomersPageSummary | null;
  projects: AgentContextProjectsPageSummary | null;
  archive: AgentContextArchivePageSummary | null;
  shell: AgentContextShellSummary | null;
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
