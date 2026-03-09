export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessageType = "text" | "tool-call" | "tool-result";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  type: ChatMessageType;
  content: string;
  rawContent?: unknown;
  createdAt: number;
  attachmentNames: string[];
  isOptimistic?: boolean;
};

export type ChatTimelineRow =
  | {
      kind: "day-separator";
      id: string;
      label: string;
    }
  | {
      kind: "message";
      id: string;
      message: ChatMessage;
    };

export type PendingAttachment = {
  id: string;
  name: string;
  contentType: string;
  storageId: string;
};

export type TimelineAttachment = {
  id: string;
  name: string;
  imageSrc: string | null;
};

export type ChatThreadSummary = {
  threadId: string;
  channel: "web" | "whatsapp";
  memberId: string | null;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenUpdatedAt: number | null;
};

export type AgentChatPageContext = {
  routeId: string;
  routePath: string;
  title: string;
  searchQuery: string | null;
  members: {
    totalCount: number;
    filteredCount: number;
    pendingInvitationCount: number;
    currentMemberRole: string | null;
    visibleMembers: Array<{
      name: string;
      email: string;
      role: string;
    }>;
    visibleInvitations: Array<{
      email: string;
      role: string;
    }>;
  } | null;
};

export type AgentChatPanelProps = {
  organizationId: string | null;
  agentName: string;
  agentAvatarSrc?: string | null;
  onOpenSettings: () => void;
  pageContext?: AgentChatPageContext | null;
};

export type WebSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

export type WebSpeechRecognitionErrorEvent = Event & {
  error: string;
};

export type WebSpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

export type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: WebSpeechRecognitionConstructor;
  webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
};

export type DictationSession = {
  prefix: string;
  suffix: string;
  finalTranscript: string;
  interimTranscript: string;
};
