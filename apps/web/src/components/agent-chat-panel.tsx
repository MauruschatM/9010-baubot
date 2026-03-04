import { api } from "@mvp-template/backend/convex/_generated/api";
import {
  RiAddLine,
  RiArrowUpSLine,
  RiAttachment2,
  RiChat3Line,
  RiCloseLine,
  RiHistoryLine,
  RiMicLine,
  RiMore2Fill,
  RiSearchLine,
  RiSettings4Line,
  RiStopCircleLine,
} from "@remixicon/react";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { useI18n } from "@/lib/i18n-provider";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

type ChatRole = "system" | "user" | "assistant" | "tool";

type ChatMessageType = "text" | "tool-call" | "tool-result";

type ChatMessage = {
  id: string;
  role: ChatRole;
  type: ChatMessageType;
  content: string;
  rawContent?: unknown;
  createdAt: number;
  attachmentNames: string[];
  isOptimistic?: boolean;
};

type ChatTimelineRow =
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

type PendingAttachment = {
  id: string;
  name: string;
  contentType: string;
  dataUrl: string;
};

type ChatThreadSummary = {
  threadId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

type AgentChatPanelProps = {
  organizationId: string | null;
  agentName: string;
  agentAvatarSrc?: string | null;
  onOpenSettings: () => void;
};

type WebSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type WebSpeechRecognitionErrorEvent = Event & {
  error: string;
};

type WebSpeechRecognition = EventTarget & {
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

type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: WebSpeechRecognitionConstructor;
  webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
};

type DictationSession = {
  prefix: string;
  suffix: string;
  finalTranscript: string;
  interimTranscript: string;
};

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const AUTO_SCROLL_THRESHOLD_PX = 32;
const TOP_LOAD_THRESHOLD_PX = 120;
const INITIAL_PAGE_SIZE = 40;
const OLDER_PAGE_SIZE = 30;

function resolveSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as WindowWithSpeechRecognition;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read file"));
    };
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function buildAttachmentPrompt(attachmentNames: string[]) {
  if (attachmentNames.length === 0) {
    return "";
  }

  const fileList = attachmentNames.join(", ");
  return `Please analyze the attached file(s): ${fileList}`;
}

function getLocalDayKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatThoughtDurationLabel(durationMs: number, locale: string) {
  if (durationMs < 60_000) {
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    return `${seconds}s`;
  }

  const minutes = durationMs / 60_000;
  const roundedMinutes = Math.max(0.1, Math.round(minutes * 10) / 10);
  const hasFraction = roundedMinutes % 1 !== 0;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  });
  return `${formatter.format(roundedMinutes)}m`;
}

function formatThreadRangeLabel(
  thread: ChatThreadSummary,
  formatter: Intl.DateTimeFormat,
) {
  const startLabel = formatter.format(new Date(thread.createdAt));
  const endLabel = formatter.format(new Date(thread.updatedAt));
  return `${startLabel} - ${endLabel}`;
}

export function AgentChatPanel({
  organizationId,
  agentName,
  agentAvatarSrc,
  onOpenSettings,
}: AgentChatPanelProps) {
  const { locale, t } = useI18n();
  const chat = useAction(api.ai.chat);
  const confirmPendingAction = useAction(api.ai.confirmPendingAction);
  const cancelPendingAction = useAction(api.ai.cancelPendingAction);
  const createChatThread = useMutation(api.aiState.createChatThread);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const chatThreads = useQuery(
    api.aiState.listChatThreads,
    organizationId
      ? {
          organizationId,
        }
      : "skip",
  );
  const chatRuntimeState = useQuery(
    api.aiState.getChatRuntimeState,
    organizationId
      ? {
          organizationId,
          threadId: activeThreadId ?? undefined,
        }
      : "skip",
  );
  const paginatedMessages = usePaginatedQuery(
    api.aiState.listChatMessages,
    organizationId
      ? {
          organizationId,
          threadId: activeThreadId ?? undefined,
        }
      : "skip",
    {
      initialNumItems: INITIAL_PAGE_SIZE,
    },
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isResolvingPendingAction, setIsResolvingPendingAction] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isNearTop, setIsNearTop] = useState(false);
  const [showInputBottomFade, setShowInputBottomFade] = useState(false);
  const [isVoiceSupported, setIsVoiceSupported] = useState<boolean | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>(
    [],
  );
  const [lastThoughtDurationMs, setLastThoughtDurationMs] = useState<number | null>(
    null,
  );
  const shouldAutoScrollRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const previousVirtualSizeRef = useRef(0);
  const previousActiveThreadIdRef = useRef<string | null>(null);
  const thoughtStartedAtRef = useRef<number | null>(null);
  const hasCapturedThoughtDurationRef = useRef(false);
  const wasThinkingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const measuredRowSizeCacheRef = useRef(new Map<string, number>());
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingPrependAnchorRef = useRef<{
    previousHeight: number;
    previousTop: number;
  } | null>(null);
  const isLoadingOlderRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastServerErrorRef = useRef<string | null>(null);
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);
  const dictationSessionRef = useRef<DictationSession | null>(null);
  const manualStopRef = useRef(false);
  const agentInitial = agentName.trim().charAt(0).toUpperCase() || "A";
  const dateLabelFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [locale],
  );
  const threadRangeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const paginationStatus = paginatedMessages.status;
  const persistedMessagesDesc = paginatedMessages.results;
  const availableChatThreads = chatThreads ?? [];
  const normalizedHistorySearchQuery = historySearchQuery.trim().toLowerCase();
  const filteredChatThreads = useMemo(() => {
    const withLabels = availableChatThreads.map((thread) => {
      const label = formatThreadRangeLabel(thread, threadRangeFormatter);
      return {
        ...thread,
        label,
      };
    });

    if (!normalizedHistorySearchQuery) {
      return withLabels;
    }

    return withLabels.filter((thread) =>
      thread.label.toLowerCase().includes(normalizedHistorySearchQuery),
    );
  }, [
    availableChatThreads,
    normalizedHistorySearchQuery,
    threadRangeFormatter,
  ]);

  const messages = useMemo<ChatMessage[]>(() => {
    const normalizedPersisted = persistedMessagesDesc
      .filter(
        (message) => message.role !== "system" && message.type === "text",
      )
      .slice()
      .reverse()
      .map((message) => ({
        id: message.id,
        role: message.role,
        type: message.type,
        content: message.text,
        rawContent: message.content,
        createdAt: message.createdAt,
        attachmentNames: message.attachmentNames,
      }));

    const streamingText = chatRuntimeState?.streamingText?.trim() ?? "";
    const isAwaitingStreamStart =
      (isSubmitting || chatRuntimeState?.runStatus === "running") &&
      streamingText.length === 0;
    const lastPersistedAssistantText = [...normalizedPersisted]
      .reverse()
      .find((message) => message.role === "assistant" && message.type === "text")
      ?.content
      .trim();
    const shouldRenderStreamingMessage =
      ((streamingText.length > 0 &&
        streamingText !== (lastPersistedAssistantText ?? "") &&
        (chatRuntimeState?.runStatus === "running" ||
          chatRuntimeState?.runStatus === "error")) ||
        isAwaitingStreamStart);
    const streamingMessage =
      shouldRenderStreamingMessage
        ? [
            {
              id: "streaming-assistant",
              role: "assistant" as const,
              type: "text" as const,
              content: streamingText,
              rawContent: streamingText,
              createdAt: Date.now(),
              attachmentNames: [],
            },
          ]
        : [];

    const dedupedOptimistic = optimisticMessages.filter((optimisticMessage) => {
      return !normalizedPersisted.some((persistedMessage) => {
        if (persistedMessage.role !== optimisticMessage.role) {
          return false;
        }

        if (persistedMessage.content !== optimisticMessage.content) {
          return false;
        }

        if (
          persistedMessage.attachmentNames.length !==
          optimisticMessage.attachmentNames.length
        ) {
          return false;
        }

        return persistedMessage.attachmentNames.every(
          (attachmentName, index) =>
            attachmentName === optimisticMessage.attachmentNames[index],
        );
      });
    });

    return [...normalizedPersisted, ...dedupedOptimistic, ...streamingMessage];
  }, [
    isSubmitting,
    chatRuntimeState?.runStatus,
    chatRuntimeState?.streamingText,
    optimisticMessages,
    persistedMessagesDesc,
  ]);

  const timelineRows = useMemo<ChatTimelineRow[]>(() => {
    if (messages.length === 0) {
      return [];
    }

    const now = new Date();
    const todayKey = getLocalDayKey(now.getTime());
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayKey = getLocalDayKey(yesterdayDate.getTime());

    const rows: ChatTimelineRow[] = [];
    let previousDayKey: string | null = null;

    for (const message of messages) {
      const dayKey = getLocalDayKey(message.createdAt);
      if (dayKey !== previousDayKey) {
        const label =
          dayKey === todayKey
            ? t("app.chat.day.today")
            : dayKey === yesterdayKey
              ? t("app.chat.day.yesterday")
              : dateLabelFormatter.format(new Date(message.createdAt));

        rows.push({
          kind: "day-separator",
          id: `day-${dayKey}`,
          label,
        });
        previousDayKey = dayKey;
      }

      rows.push({
        kind: "message",
        id: message.id,
        message,
      });
    }

    return rows;
  }, [dateLabelFormatter, messages, t]);

  const estimateTimelineRowSize = useCallback(
    (index: number) => {
      const row = timelineRows[index];
      if (!row) {
        return 96;
      }

      if (row.kind === "day-separator") {
        return 32;
      }

      const cachedSize = measuredRowSizeCacheRef.current.get(row.id);
      if (cachedSize) {
        return cachedSize;
      }

      const isUserMessage = row.message.role === "user";
      const contentLength = row.message.content.trim().length;
      const estimatedCharsPerLine = isUserMessage ? 34 : 42;
      const estimatedLineCount = Math.max(
        1,
        Math.ceil(contentLength / estimatedCharsPerLine),
      );
      const explicitLineCount = row.message.content.split(/\r?\n/).length;
      const effectiveLineCount = Math.max(estimatedLineCount, explicitLineCount);
      const attachmentHeight = row.message.attachmentNames.length > 0 ? 28 : 0;
      const baseHeight = isUserMessage ? 44 : 52;
      return Math.min(420, baseHeight + attachmentHeight + effectiveLineCount * 18);
    },
    [timelineRows],
  );

  const measureTimelineRow = useCallback(
    (
      element: Element,
      entry: ResizeObserverEntry | undefined,
      instance: Parameters<typeof measureElement>[2],
    ) => {
      const measuredSize = measureElement(element, entry, instance);
      const indexAttribute = element.getAttribute("data-index");
      if (!indexAttribute) {
        return measuredSize;
      }

      const index = Number(indexAttribute);
      if (!Number.isFinite(index)) {
        return measuredSize;
      }

      const rowId = timelineRows[index]?.id;
      if (rowId) {
        measuredRowSizeCacheRef.current.set(rowId, measuredSize);
      }

      return measuredSize;
    },
    [timelineRows],
  );

  const rowVirtualizer = useVirtualizer({
    enabled: isOpen,
    count: timelineRows.length,
    getScrollElement: () => messagesContainerRef.current,
    getItemKey: (index) => timelineRows[index]?.id ?? index,
    estimateSize: estimateTimelineRowSize,
    measureElement: measureTimelineRow,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });

  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () =>
      shouldAutoScrollRef.current;
  }, [rowVirtualizer]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    rowVirtualizer.measure();
  }, [isOpen, rowVirtualizer, timelineRows]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        rowVirtualizer.measure();
      });
    };

    scheduleMeasure();
    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen, rowVirtualizer]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined" || !("fonts" in document)) {
      return;
    }

    let isCancelled = false;
    void (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => {
      if (!isCancelled) {
        rowVirtualizer.measure();
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, rowVirtualizer]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "auto",
    });
    previousScrollTopRef.current = container.scrollHeight;
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      rowVirtualizer.measure();
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
  }, [rowVirtualizer, scrollToBottom]);

  const maybeLoadOlderMessages = useCallback(() => {
    if (!organizationId || paginationStatus !== "CanLoadMore" || isLoadingOlderRef.current) {
      return;
    }

    const container = messagesContainerRef.current;
    if (container) {
      pendingPrependAnchorRef.current = {
        previousHeight: container.scrollHeight,
        previousTop: container.scrollTop,
      };
    }

    isLoadingOlderRef.current = true;
    paginatedMessages.loadMore(OLDER_PAGE_SIZE);
  }, [organizationId, paginatedMessages, paginationStatus]);
  const virtualTotalSize = rowVirtualizer.getTotalSize();

  useLayoutEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      previousScrollTopRef.current = 0;
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    setIsNearTop(false);
    pendingPrependAnchorRef.current = null;
    isLoadingOlderRef.current = false;
    shouldAutoScrollRef.current = true;
    previousMessageCountRef.current = messages.length;
    previousVirtualSizeRef.current = virtualTotalSize;
    previousScrollTopRef.current = 0;
    rowVirtualizer.measure();
    scrollToBottom();
    requestAnimationFrame(() => {
      rowVirtualizer.measure();
      scrollToBottom();
      requestAnimationFrame(() => {
        rowVirtualizer.measure();
        scrollToBottom();
      });
    });
  }, [isOpen, messages.length, rowVirtualizer, scrollToBottom, virtualTotalSize]);

  useEffect(() => {
    if (!isOpen || !shouldAutoScrollRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      rowVirtualizer.measure();
      scrollToBottom();
    });
  }, [isOpen, rowVirtualizer, scrollToBottom, timelineRows.length]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousMessageCount = previousMessageCountRef.current;
    const hasNewMessage = messages.length > previousMessageCount;
    previousMessageCountRef.current = messages.length;

    if (!hasNewMessage || !shouldAutoScrollRef.current) {
      return;
    }

    scheduleScrollToBottom();
  }, [isOpen, messages.length, scheduleScrollToBottom]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousVirtualSize = previousVirtualSizeRef.current;
    const virtualSizeIncreased = virtualTotalSize > previousVirtualSize;
    previousVirtualSizeRef.current = virtualTotalSize;

    if (!virtualSizeIncreased || !shouldAutoScrollRef.current) {
      return;
    }

    scheduleScrollToBottom();
  }, [isOpen, scheduleScrollToBottom, virtualTotalSize]);

  useEffect(() => {
    if (paginationStatus !== "LoadingMore") {
      isLoadingOlderRef.current = false;
    }
  }, [paginationStatus]);

  useEffect(() => {
    const anchor = pendingPrependAnchorRef.current;
    const container = messagesContainerRef.current;
    if (!anchor || !container || paginationStatus === "LoadingMore") {
      return;
    }

    const heightDelta = container.scrollHeight - anchor.previousHeight;
    container.scrollTop = Math.max(0, anchor.previousTop + heightDelta);
    previousScrollTopRef.current = container.scrollTop;
    pendingPrependAnchorRef.current = null;
  }, [paginationStatus, persistedMessagesDesc.length]);

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const isScrollingUp = container.scrollTop + 1 < previousScrollTopRef.current;
    previousScrollTopRef.current = container.scrollTop;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (isScrollingUp && distanceFromBottom > AUTO_SCROLL_THRESHOLD_PX) {
      shouldAutoScrollRef.current = false;
    } else {
      shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
    }

    const nearTop = container.scrollTop <= TOP_LOAD_THRESHOLD_PX;
    setIsNearTop(nearTop);

    if (nearTop) {
      maybeLoadOlderMessages();
    }
  };

  const updateInputBottomFade = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      setShowInputBottomFade(false);
      return;
    }

    const hasOverflow = textarea.scrollHeight > textarea.clientHeight + 1;
    if (!hasOverflow) {
      setShowInputBottomFade(false);
      return;
    }

    const distanceFromBottom =
      textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight;
    setShowInputBottomFade(distanceFromBottom > 2);
  }, []);

  const handleInputValueChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
    requestAnimationFrame(() => {
      updateInputBottomFade();
    });
  };

  const handleInputScroll = () => {
    updateInputBottomFade();
  };

  const isServerRunning = chatRuntimeState?.runStatus === "running";
  const isBusy =
    isSubmitting ||
    isCreatingThread ||
    isServerRunning ||
    isResolvingPendingAction;
  const isInputDisabled = !organizationId || isBusy;
  const shouldShowStreamingStatus = isSubmitting || isServerRunning;
  const isWakingAgent = isSubmitting && !isServerRunning;
  const isWaitingForAgentResponse =
    shouldShowStreamingStatus &&
    !isWakingAgent &&
    (chatRuntimeState?.streamingText?.trim().length ?? 0) === 0;
  const supportsVoiceInput = isVoiceSupported === true;
  const isVoiceUnsupported = isVoiceSupported === false;
  const isVoiceControlDisabled = !organizationId || isBusy || !supportsVoiceInput;
  const voiceButtonLabel = !supportsVoiceInput
    ? t("app.chat.voiceUnsupported")
    : isListening
      ? t("app.chat.voiceStop")
      : t("app.chat.voiceStart");
  const pendingAction = chatRuntimeState?.pendingAction ?? null;
  const thoughtDurationLabel =
    lastThoughtDurationMs === null
      ? null
      : formatThoughtDurationLabel(lastThoughtDurationMs, locale);
  const latestAssistantMessageId = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.role === "assistant" && message.type === "text")?.id ??
      null,
    [messages],
  );
  const pendingOrganizationName =
    pendingAction && typeof pendingAction.payload.organizationName === "string"
      ? pendingAction.payload.organizationName
      : null;

  const stopVoiceInputImmediately = (shouldSetListeningState = true) => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      dictationSessionRef.current = null;
      manualStopRef.current = false;
      if (shouldSetListeningState) {
        setIsListening(false);
      }
      return;
    }

    manualStopRef.current = true;
    dictationSessionRef.current = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.stop();
    recognitionRef.current = null;
    if (shouldSetListeningState) {
      setIsListening(false);
    }
  };

  const stopVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsListening(false);
      return;
    }

    manualStopRef.current = true;
    recognition.stop();
  };

  const createThreadForCurrentOrganization = useCallback(async () => {
    if (!organizationId) {
      throw new Error("No active organization");
    }

    const createdThread = await createChatThread({
      organizationId,
    });

    setActiveThreadId(createdThread.threadId);
    return createdThread.threadId;
  }, [createChatThread, organizationId]);

  const handleCreateNewChat = async () => {
    if (!organizationId || isBusy) {
      return;
    }

    stopVoiceInputImmediately();
    setIsCreatingThread(true);
    try {
      await createThreadForCurrentOrganization();
      setOptimisticMessages([]);
      setPendingAttachments([]);
      setInputValue("");
      setLastThoughtDurationMs(null);
      setIsNearTop(false);
      setShowInputBottomFade(false);
      setHistorySearchQuery("");
      setIsHistoryDialogOpen(false);
      pendingPrependAnchorRef.current = null;
      isLoadingOlderRef.current = false;
      shouldAutoScrollRef.current = true;
      previousMessageCountRef.current = 0;
      previousVirtualSizeRef.current = 0;
      setIsOpen(true);
    } catch {
      toast.error(t("app.chat.error"));
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleSelectHistoryThread = (threadId: string) => {
    stopVoiceInput();
    setActiveThreadId(threadId);
    setIsHistoryDialogOpen(false);
    setHistorySearchQuery("");
    setIsOpen(true);
  };

  const startVoiceInput = () => {
    if (!organizationId || isBusy || isListening) {
      return;
    }

    const RecognitionConstructor = resolveSpeechRecognitionConstructor();
    if (!RecognitionConstructor) {
      setIsVoiceSupported(false);
      toast.error(t("app.chat.voiceUnsupported"));
      return;
    }

    const currentValue = inputValue;
    const textarea = inputRef.current;
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? currentValue.length;
    const dictationSession: DictationSession = {
      prefix: currentValue.slice(0, selectionStart),
      suffix: currentValue.slice(selectionEnd),
      finalTranscript: "",
      interimTranscript: "",
    };

    const recognition = new RecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = locale === "de" ? "de-DE" : "en-US";

    manualStopRef.current = false;
    dictationSessionRef.current = dictationSession;
    recognitionRef.current = recognition;
    setIsListening(true);

    recognition.onresult = (event) => {
      const session = dictationSessionRef.current;
      if (!session) {
        return;
      }

      let finalTranscript = session.finalTranscript;
      let interimTranscript = "";
      for (let resultIndex = event.resultIndex; resultIndex < event.results.length; resultIndex += 1) {
        const result = event.results[resultIndex];
        const alternative = result?.[0];
        if (!alternative) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript += alternative.transcript;
        } else {
          interimTranscript += alternative.transcript;
        }
      }

      session.finalTranscript = finalTranscript;
      session.interimTranscript = interimTranscript;
      setInputValue(`${session.prefix}${finalTranscript}${interimTranscript}${session.suffix}`);
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" && manualStopRef.current) {
        return;
      }

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error(t("app.chat.voicePermissionDenied"));
        return;
      }

      if (event.error === "no-speech") {
        toast.error(t("app.chat.voiceNoSpeech"));
        return;
      }

      toast.error(t("app.chat.voiceError"));
    };

    recognition.onend = () => {
      const session = dictationSessionRef.current;
      if (session) {
        setInputValue(`${session.prefix}${session.finalTranscript}${session.suffix}`);
      }

      dictationSessionRef.current = null;
      manualStopRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      setIsListening(false);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    };

    try {
      recognition.start();
    } catch {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
      dictationSessionRef.current = null;
      manualStopRef.current = false;
      setIsListening(false);
      toast.error(t("app.chat.voiceError"));
    }
  };

  useEffect(() => {
    stopVoiceInputImmediately();
    setActiveThreadId(null);
    setOptimisticMessages([]);
    setPendingAttachments([]);
    setInputValue("");
    setLastThoughtDurationMs(null);
    setIsCreatingThread(false);
    setIsResolvingPendingAction(false);
    setIsHistoryDialogOpen(false);
    setHistorySearchQuery("");
    setIsNearTop(false);
    setShowInputBottomFade(false);
    pendingPrependAnchorRef.current = null;
    isLoadingOlderRef.current = false;
    previousScrollTopRef.current = 0;
    measuredRowSizeCacheRef.current.clear();
    thoughtStartedAtRef.current = null;
    hasCapturedThoughtDurationRef.current = false;
    wasThinkingRef.current = false;
    lastServerErrorRef.current = null;
  }, [organizationId]);

  useEffect(() => {
    if (previousActiveThreadIdRef.current === activeThreadId) {
      return;
    }

    previousActiveThreadIdRef.current = activeThreadId;
    stopVoiceInputImmediately();
    setOptimisticMessages([]);
    setPendingAttachments([]);
    setInputValue("");
    setLastThoughtDurationMs(null);
    setIsResolvingPendingAction(false);
    setIsNearTop(false);
    setShowInputBottomFade(false);
    pendingPrependAnchorRef.current = null;
    isLoadingOlderRef.current = false;
    previousScrollTopRef.current = 0;
    measuredRowSizeCacheRef.current.clear();
    thoughtStartedAtRef.current = null;
    hasCapturedThoughtDurationRef.current = false;
    wasThinkingRef.current = false;
    lastServerErrorRef.current = null;
  }, [activeThreadId]);

  useEffect(() => {
    const validRowIds = new Set(timelineRows.map((row) => row.id));
    for (const rowId of measuredRowSizeCacheRef.current.keys()) {
      if (!validRowIds.has(rowId)) {
        measuredRowSizeCacheRef.current.delete(rowId);
      }
    }
  }, [timelineRows]);

  useEffect(() => {
    if (!organizationId || chatThreads === undefined) {
      return;
    }

    if (chatThreads.length === 0) {
      if (activeThreadId !== null) {
        setActiveThreadId(null);
      }
      return;
    }

    if (
      activeThreadId &&
      chatThreads.some((thread) => thread.threadId === activeThreadId)
    ) {
      return;
    }

    setActiveThreadId(chatThreads[0]?.threadId ?? null);
  }, [activeThreadId, chatThreads, organizationId]);

  useEffect(() => {
    const streamingText = chatRuntimeState?.streamingText?.trim() ?? "";

    if (shouldShowStreamingStatus) {
      if (!wasThinkingRef.current) {
        thoughtStartedAtRef.current = Date.now();
        hasCapturedThoughtDurationRef.current = false;
        setLastThoughtDurationMs(null);
      }
      wasThinkingRef.current = true;

      const thoughtStartedAt = thoughtStartedAtRef.current;
      if (
        thoughtStartedAt &&
        !hasCapturedThoughtDurationRef.current &&
        streamingText.length > 0
      ) {
        hasCapturedThoughtDurationRef.current = true;
        setLastThoughtDurationMs(Math.max(0, Date.now() - thoughtStartedAt));
      }
      return;
    }

    if (!wasThinkingRef.current) {
      return;
    }

    wasThinkingRef.current = false;
    const thoughtStartedAt = thoughtStartedAtRef.current;
    thoughtStartedAtRef.current = null;
    if (!thoughtStartedAt) {
      return;
    }

    if (!hasCapturedThoughtDurationRef.current) {
      hasCapturedThoughtDurationRef.current = true;
      setLastThoughtDurationMs(Math.max(0, Date.now() - thoughtStartedAt));
    }
  }, [chatRuntimeState?.streamingText, shouldShowStreamingStatus]);

  useEffect(() => {
    requestAnimationFrame(() => {
      updateInputBottomFade();
    });
  }, [inputValue, isOpen, updateInputBottomFade]);

  useEffect(() => {
    setIsVoiceSupported(resolveSpeechRecognitionConstructor() !== null);
  }, []);

  useEffect(() => {
    if (!isOpen || !organizationId || isBusy || isListening) {
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [isBusy, isListening, isOpen, organizationId]);

  useEffect(() => {
    if (isOpen || !recognitionRef.current) {
      return;
    }

    stopVoiceInput();
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopVoiceInputImmediately(false);
    };
  }, []);

  useEffect(() => {
    if (!isListening || !recognitionRef.current) {
      return;
    }

    recognitionRef.current.lang = locale === "de" ? "de-DE" : "en-US";
  }, [isListening, locale]);

  useEffect(() => {
    if (!isBusy || !recognitionRef.current) {
      return;
    }

    stopVoiceInput();
  }, [isBusy]);

  useEffect(() => {
    const nextError = chatRuntimeState?.lastError ?? null;
    if (!nextError) {
      return;
    }

    if (nextError === lastServerErrorRef.current) {
      return;
    }

    lastServerErrorRef.current = nextError;
    toast.error(nextError);
  }, [chatRuntimeState?.lastError]);

  const isReadyToSend =
    !!organizationId &&
    (inputValue.trim().length > 0 || pendingAttachments.length > 0) &&
    !isBusy &&
    !isListening;

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    const availableSlots = MAX_ATTACHMENTS - pendingAttachments.length;
    if (availableSlots <= 0) {
      toast.error(t("app.chat.tooManyFiles"));
      return;
    }

    if (selectedFiles.length > availableSlots) {
      toast.error(t("app.chat.tooManyFiles"));
    }

    const filesToProcess = selectedFiles.slice(0, availableSlots);
    const processedFiles: PendingAttachment[] = [];

    for (const file of filesToProcess) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(t("app.chat.fileTooLarge"));
        continue;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        processedFiles.push({
          id: createMessageId(),
          name: file.name,
          contentType: file.type || "application/octet-stream",
          dataUrl,
        });
      } catch {
        toast.error(t("app.chat.fileReadError"));
      }
    }

    if (processedFiles.length === 0) {
      return;
    }

    setPendingAttachments((current) => [...current, ...processedFiles]);
  };

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organizationId || isBusy || isListening) {
      return;
    }

    const content = inputValue.trim();
    if (!content && pendingAttachments.length === 0) {
      return;
    }

    const attachmentNames = pendingAttachments.map((attachment) => attachment.name);
    const fallbackContent =
      attachmentNames.length > 0 ? attachmentNames.join(", ") : "";
    const userMessageContent = content || fallbackContent;
    const prompt = content || buildAttachmentPrompt(attachmentNames);

    const optimisticMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      type: "text",
      content: userMessageContent,
      rawContent: userMessageContent,
      createdAt: Date.now(),
      attachmentNames,
      isOptimistic: true,
    };

    const attachmentsForSend = pendingAttachments.map((attachment) => ({
      name: attachment.name,
      contentType: attachment.contentType,
      dataUrl: attachment.dataUrl,
    }));

    shouldAutoScrollRef.current = true;
    previousMessageCountRef.current = messages.length;
    setOptimisticMessages((current) => [...current, optimisticMessage]);
    setInputValue("");
    setPendingAttachments([]);
    setIsSubmitting(true);
    let createdThreadForMessage = false;

    try {
      let threadIdForMessage = activeThreadId;
      if (!threadIdForMessage) {
        createdThreadForMessage = true;
        setIsCreatingThread(true);
        threadIdForMessage = await createThreadForCurrentOrganization();
      }

      await chat({
        organizationId,
        threadId: threadIdForMessage,
        locale,
        prompt,
        attachments: attachmentsForSend,
      });
    } catch {
      toast.error(t("app.chat.error"));
    } finally {
      if (createdThreadForMessage) {
        setIsCreatingThread(false);
      }
      setOptimisticMessages((current) =>
        current.filter((message) => message.id !== optimisticMessage.id),
      );
      setIsSubmitting(false);
    }
  };

  const appendOptimisticAssistantMessage = (content: string) => {
    if (!content.trim()) {
      return;
    }

    const optimisticAssistantMessage: ChatMessage = {
      id: createMessageId(),
      role: "assistant",
      type: "text",
      content,
      rawContent: content,
      createdAt: Date.now(),
      attachmentNames: [],
      isOptimistic: true,
    };

    setOptimisticMessages((current) => [...current, optimisticAssistantMessage]);
  };

  const handleConfirmPendingAction = async () => {
    if (!organizationId || !pendingAction) {
      return;
    }

    setIsResolvingPendingAction(true);
    try {
      const result = await confirmPendingAction({
        organizationId,
        pendingActionId: pendingAction.id,
        locale,
      });

      appendOptimisticAssistantMessage(result.text);

      if (result.status === "error") {
        toast.error(result.text);
      }
    } catch {
      toast.error(t("app.chat.error"));
    } finally {
      setIsResolvingPendingAction(false);
    }
  };

  const handleCancelPendingAction = async () => {
    if (!organizationId || !pendingAction) {
      return;
    }

    setIsResolvingPendingAction(true);
    try {
      const result = await cancelPendingAction({
        organizationId,
        pendingActionId: pendingAction.id,
        locale,
      });

      appendOptimisticAssistantMessage(result.text);

      if (result.status === "error") {
        toast.error(result.text);
      }
    } catch {
      toast.error(t("app.chat.error"));
    } finally {
      setIsResolvingPendingAction(false);
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isListening && event.key === "Enter") {
      event.preventDefault();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const isConversationLoading =
    !!organizationId &&
    (chatRuntimeState === undefined || paginationStatus === "LoadingFirstPage");
  const canLoadOlder = paginationStatus === "CanLoadMore";
  const isLoadingOlder = paginationStatus === "LoadingMore";
  const showLoadOlderButton =
    !!organizationId && isNearTop && (canLoadOlder || isLoadingOlder);

  return (
    <>
      <Button
        type="button"
        size="icon-lg"
        variant="outline"
        className={cn(
          "fixed right-6 bottom-6 z-[80] size-14 rounded-full border-zinc-300 bg-white text-zinc-700 shadow-xl transition-all duration-200 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:border-zinc-400 focus-visible:ring-zinc-300 dark:border-zinc-500 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-100",
          isOpen ? "scale-95" : "scale-100",
        )}
        onClick={() => setIsOpen((previous) => !previous)}
        aria-label={isOpen ? t("common.actions.close") : t("app.chat.open")}
      >
        {isOpen ? (
          <RiCloseLine className="size-6" />
        ) : (
          <RiChat3Line className="size-6" />
        )}
      </Button>

      <div className="pointer-events-none fixed inset-x-4 top-10 bottom-24 z-[70] flex justify-end sm:top-14 sm:right-6 sm:bottom-24 sm:left-auto sm:w-[23rem]">
        <section
          aria-hidden={!isOpen}
          className={cn(
            "relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl origin-bottom-right transition-all duration-300 ease-out",
            isOpen
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-4 opacity-0",
          )}
        >
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto"
            onScroll={handleMessagesScroll}
          >
            <div className="min-h-full px-4 pt-24 pb-56">
              {!organizationId ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {t("app.chat.noOrganization")}
                </p>
              ) : isConversationLoading ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {t("common.state.loading")}
                </p>
              ) : messages.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {t("app.chat.empty")}
                </p>
              ) : (
                <>
                  {showLoadOlderButton ? (
                    <div className="pb-3 text-center">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={maybeLoadOlderMessages}
                        disabled={isLoadingOlder || !canLoadOlder}
                      >
                        {isLoadingOlder
                          ? t("app.chat.loadingOlder")
                          : t("app.chat.loadOlder")}
                      </Button>
                    </div>
                  ) : null}
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const row = timelineRows[virtualRow.index];
                      if (!row) {
                        return null;
                      }

                      return (
                        <div
                          key={virtualRow.key}
                          data-index={virtualRow.index}
                          ref={rowVirtualizer.measureElement}
                          className="absolute left-0 w-full"
                          style={{
                            top: 0,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {row.kind === "day-separator" ? (
                            <div className="py-2">
                              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                                <span className="h-px flex-1 bg-border/70" />
                                <span>{row.label}</span>
                                <span className="h-px flex-1 bg-border/70" />
                              </div>
                            </div>
                          ) : (() => {
                            const message = row.message;
                            const isUserMessage = message.role === "user";
                            const isStreamingAssistantMessage =
                              !isUserMessage &&
                              shouldShowStreamingStatus &&
                              message.id === "streaming-assistant";
                            const showInlineThinking =
                              isStreamingAssistantMessage && isWaitingForAgentResponse;
                            const showInlineWaking =
                              isStreamingAssistantMessage && isWakingAgent;
                            const showInlineThoughtDuration =
                              !isUserMessage &&
                              !!thoughtDurationLabel &&
                              message.id === latestAssistantMessageId;

                            return (
                              <div
                                className={cn(
                                  "flex flex-col gap-1 pb-3",
                                  isUserMessage ? "items-end" : "items-start",
                                )}
                              >
                                {message.attachmentNames.length > 0 ? (
                                  <div
                                    className={cn(
                                      "max-w-[80%] flex flex-wrap gap-1",
                                      isUserMessage ? "justify-end" : "justify-start",
                                    )}
                                  >
                                    {message.attachmentNames.map((attachmentName, index) => (
                                      <span
                                        key={`${message.id}-attachment-${index}`}
                                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50/90 px-2.5 py-1 text-[11px] text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                                      >
                                        <RiAttachment2 className="size-3 shrink-0 opacity-70" />
                                        <span className="max-w-[10.5rem] truncate">
                                          {attachmentName}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div
                                  className={cn(
                                    "text-sm leading-relaxed",
                                    isUserMessage
                                      ? "w-[80%] rounded-2xl rounded-br-sm bg-zinc-100 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                                      : "w-full bg-transparent px-0 py-1 text-foreground",
                                  )}
                                >
                                  {showInlineWaking ? (
                                    <p className="chat-shimmer-text pb-1 text-xs text-muted-foreground">
                                      {t("app.chat.wakingAgent", {
                                        agentName,
                                      })}
                                    </p>
                                  ) : null}

                                  {showInlineThinking ? (
                                    <p className="chat-shimmer-text pb-1 text-xs text-muted-foreground">
                                      {t("app.chat.thinking")}
                                    </p>
                                  ) : null}

                                  {showInlineThoughtDuration ? (
                                    <p className="pb-1 text-xs text-muted-foreground">
                                      {t("app.chat.thoughtFor", {
                                        duration: thoughtDurationLabel,
                                      })}
                                    </p>
                                  ) : null}

                                  {!isUserMessage ? (
                                    <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                                      <ReactMarkdown
                                        components={{
                                          h1: ({ children }) => (
                                            <h1 className="mt-2 mb-1 text-base font-semibold">
                                              {children}
                                            </h1>
                                          ),
                                          h2: ({ children }) => (
                                            <h2 className="mt-2 mb-1 text-sm font-semibold">
                                              {children}
                                            </h2>
                                          ),
                                          h3: ({ children }) => (
                                            <h3 className="mt-2 mb-1 text-sm font-medium">
                                              {children}
                                            </h3>
                                          ),
                                          p: ({ children }) => (
                                            <p className="mb-2 whitespace-pre-wrap last:mb-0">
                                              {children}
                                            </p>
                                          ),
                                          ul: ({ children }) => (
                                            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
                                              {children}
                                            </ul>
                                          ),
                                          ol: ({ children }) => (
                                            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
                                              {children}
                                            </ol>
                                          ),
                                          li: ({ children }) => <li>{children}</li>,
                                          blockquote: ({ children }) => (
                                            <blockquote className="mt-2 mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
                                              {children}
                                            </blockquote>
                                          ),
                                          pre: ({ children }) => (
                                            <pre className="mb-2 last:mb-0">{children}</pre>
                                          ),
                                          code: ({ children, className }) => {
                                            const isBlock = !!className;
                                            if (isBlock) {
                                              return (
                                                <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
                                                  {children}
                                                </code>
                                              );
                                            }

                                            return (
                                              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                                                {children}
                                              </code>
                                            );
                                          },
                                          a: ({ children, href }) => (
                                            <a
                                              href={href}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-primary underline underline-offset-2"
                                            >
                                              {children}
                                            </a>
                                          ),
                                        }}
                                      >
                                        {message.content}
                                      </ReactMarkdown>
                                    </div>
                                  ) : isUserMessage ? (
                                    <p className="whitespace-pre-wrap">{message.content}</p>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {pendingAction?.actionType === "delete-organization" ? (
                <div className="mt-3 rounded-xl border bg-card/60 p-3">
                  <p className="text-xs font-semibold text-foreground">
                    {t("app.chat.confirmation.deleteOrganization.title")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pendingOrganizationName
                      ? t("app.chat.confirmation.deleteOrganization.descriptionNamed", {
                          organizationName: pendingOrganizationName,
                        })
                      : t("app.chat.confirmation.deleteOrganization.description")}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isResolvingPendingAction}
                      onClick={() => {
                        void handleConfirmPendingAction();
                      }}
                    >
                      {t("app.chat.confirmation.deleteOrganization.confirm")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isResolvingPendingAction}
                      onClick={() => {
                        void handleCancelPendingAction();
                      }}
                    >
                      {t("app.chat.confirmation.deleteOrganization.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}

            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-white/76 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 dark:bg-zinc-950/78 dark:supports-[backdrop-filter]:bg-zinc-950/72">
            <header
              className={cn(
                "px-4 pt-4 pb-3",
                isOpen ? "pointer-events-auto" : "pointer-events-none",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar size="sm" className="size-4 !rounded-md after:!rounded-md">
                    <AvatarImage src={agentAvatarSrc ?? undefined} className="!rounded-md" />
                    <AvatarFallback className="!rounded-md text-[10px]">
                      {agentInitial}
                    </AvatarFallback>
                  </Avatar>
                  <p className="truncate text-xs font-medium text-foreground">{agentName}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7"
                    onClick={() => {
                      void handleCreateNewChat();
                    }}
                    disabled={!organizationId || isBusy}
                    aria-label={t("app.chat.menu.newChat")}
                    title={t("app.chat.menu.newChat")}
                  >
                    <RiAddLine className="size-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="size-7"
                          aria-label={t("app.chat.menu.open")}
                        />
                      }
                      disabled={!organizationId}
                    >
                      <RiMore2Fill className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      side="bottom"
                      sideOffset={8}
                      className="w-44 rounded-xl bg-card px-1.5 py-1.5"
                    >
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={() => setIsHistoryDialogOpen(true)}
                        disabled={!organizationId}
                      >
                        <RiHistoryLine />
                        <span>{t("app.chat.menu.chatHistory")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-8 px-2"
                        onClick={onOpenSettings}
                        disabled={!organizationId}
                      >
                        <RiSettings4Line />
                        <span>{t("app.chat.menu.settings")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </header>
            <div className="h-px bg-border/70" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-white/76 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 dark:bg-zinc-950/78 dark:supports-[backdrop-filter]:bg-zinc-950/72">
            <div className="h-px bg-border/70" />
            <form
              onSubmit={submitMessage}
              className={cn(
                "space-y-2 px-4 pt-3 pb-0",
                isOpen ? "pointer-events-auto" : "pointer-events-none",
              )}
            >
              {pendingAttachments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {pendingAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs"
                    >
                      <span className="truncate">{attachment.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-5"
                        onClick={() => {
                          setPendingAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id),
                          );
                        }}
                        aria-label={t("app.chat.removeFile")}
                        disabled={isBusy || isListening}
                      >
                        <RiCloseLine className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div
                className={cn(
                  "relative overflow-hidden rounded-lg border border-input",
                  isInputDisabled ? "bg-input/50 dark:bg-input/80" : "bg-white dark:bg-zinc-900",
                )}
              >
                <Textarea
                  ref={inputRef}
                  rows={2}
                  value={inputValue}
                  onChange={handleInputValueChange}
                  onScroll={handleInputScroll}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder={t("app.chat.inputPlaceholder")}
                  className={cn(
                    "field-sizing-content min-h-16 max-h-[13rem] resize-none overflow-y-auto border-0 bg-transparent px-3 pb-2 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent",
                    isListening
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-zinc-900 dark:text-zinc-100",
                  )}
                  disabled={isInputDisabled}
                  readOnly={isListening}
                  aria-busy={isListening}
                />
                <div
                  className={cn(
                    "pointer-events-none relative z-10 flex items-center gap-1.5 px-2 pb-2",
                    isInputDisabled
                      ? "bg-input/50 dark:bg-input/80 [&>[data-slot=button]]:disabled:border-input [&>[data-slot=button]]:disabled:bg-transparent [&>[data-slot=button]]:disabled:text-muted-foreground"
                      : "bg-white dark:bg-zinc-900",
                  )}
                >
                  {showInputBottomFade ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-full h-12 bg-gradient-to-b from-transparent via-white/70 to-white dark:via-zinc-900/70 dark:to-zinc-900" />
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="pointer-events-auto"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!organizationId || isBusy || isListening}
                    aria-label={t("app.chat.attach")}
                    title={t("app.chat.attach")}
                  >
                    <RiAttachment2 />
                  </Button>
                  <div className="flex-1" />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant={isListening ? "destructive" : "outline"}
                    className="pointer-events-auto"
                    onClick={() => {
                      if (isListening) {
                        stopVoiceInput();
                        return;
                      }

                      startVoiceInput();
                    }}
                    disabled={isVoiceControlDisabled}
                    aria-label={voiceButtonLabel}
                    title={voiceButtonLabel}
                  >
                    {isListening ? (
                      <RiStopCircleLine />
                    ) : (
                      <RiMicLine />
                    )}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="pointer-events-auto"
                    disabled={!isReadyToSend}
                    aria-label={t("app.chat.send")}
                    title={t("app.chat.send")}
                  >
                    <span>{t("app.chat.send")}</span>
                    <RiArrowUpSLine />
                  </Button>
                </div>
              </div>
              {isVoiceUnsupported ? (
                <p className="text-xs text-muted-foreground">{t("app.chat.voiceUnsupported")}</p>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(event) => {
                  void handleFileSelection(event);
                }}
                disabled={!organizationId || isBusy || isListening}
              />
              <p className="pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                {t("app.chat.disclaimer", {
                  agentName,
                })}
              </p>
            </form>
          </div>
        </section>
      </div>

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("app.chat.history.title")}</DialogTitle>
            <DialogDescription>{t("app.chat.history.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground">
                <RiSearchLine className="size-4" />
              </span>
              <Input
                type="search"
                value={historySearchQuery}
                onChange={(event) => setHistorySearchQuery(event.target.value)}
                placeholder={t("app.chat.history.searchPlaceholder")}
                className="pl-8"
                disabled={!organizationId || chatThreads === undefined}
              />
            </div>

            {!organizationId ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                {t("app.chat.noOrganization")}
              </p>
            ) : chatThreads === undefined ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                {t("common.state.loading")}
              </p>
            ) : availableChatThreads.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                {t("app.chat.history.empty")}
              </p>
            ) : filteredChatThreads.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                {t("app.chat.history.noResults")}
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
                {filteredChatThreads.map((thread) => (
                  <button
                    key={thread.threadId}
                    type="button"
                    onClick={() => handleSelectHistoryThread(thread.threadId)}
                    className={cn(
                      "flex w-full items-center justify-start rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                      activeThreadId === thread.threadId
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {thread.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
