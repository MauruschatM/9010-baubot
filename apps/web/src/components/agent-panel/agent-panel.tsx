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
import { toast } from "@/components/ui/sonner";

import { useI18n } from "@/lib/i18n-provider";
import { downloadExportZip } from "@/lib/export-zip";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  AUTO_SCROLL_THRESHOLD_PX,
  INITIAL_PAGE_SIZE,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  OLDER_PAGE_SIZE,
  TOP_LOAD_THRESHOLD_PX,
} from "./constants";
import type {
  AgentChatPanelProps,
  ChatMessage,
  ChatThreadSummary,
  ChatTimelineRow,
  DictationSession,
  PendingAttachment,
  TimelineAttachment,
  WebSpeechRecognition,
} from "./types";
import {
  buildAttachmentPrompt,
  createMessageId,
  extractExportReadyResults,
  extractTimelineAttachments,
  formatThreadRangeLabel,
  formatThoughtDurationLabel,
  getLocalDayKey,
  getStorageIdFromUploadResult,
  resolveSpeechRecognitionConstructor,
} from "./utils";

const ACTIVE_THREAD_STORAGE_KEY_PREFIX = "agent-panel-active-thread";

const getActiveThreadStorageKey = (organizationId: string) =>
  `${ACTIVE_THREAD_STORAGE_KEY_PREFIX}:${organizationId}`;

const isWhatsappThread = (thread: Pick<ChatThreadSummary, "channel">) =>
  thread.channel === "whatsapp";

const isWebThread = (thread: Pick<ChatThreadSummary, "channel">) =>
  !isWhatsappThread(thread);

export function AgentChatPanel({
  organizationId,
  agentName,
  agentAvatarSrc,
  onOpenSettings,
  pageContext,
}: AgentChatPanelProps) {
  const { locale, t } = useI18n();
  const aiActions = api.ai as any;
  const chat = useAction(aiActions.chat as any) as any;
  const submitClarificationAnswers = useAction(
    aiActions.submitClarificationAnswers as any,
  ) as any;
  const cancelClarificationSession = useAction(api.ai.cancelClarificationSession);
  const resumeFromClarification = useAction(
    aiActions.resumeFromClarification as any,
  ) as any;
  const confirmPendingAction = useAction(api.ai.confirmPendingAction);
  const cancelPendingAction = useAction(api.ai.cancelPendingAction);
  const createChatThread = useMutation(api.aiState.createChatThread);
  const markChatSeenState = useMutation(api.aiState.markChatSeenState);
  const generateUploadUrl = useMutation(api.aiAttachments.generateUploadUrl);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pendingCreatedThreadId, setPendingCreatedThreadId] = useState<string | null>(
    null,
  );
  const [persistedActiveThreadId, setPersistedActiveThreadId] = useState<
    string | null
  >(null);
  const [hydratedPersistedThreadOrgId, setHydratedPersistedThreadOrgId] = useState<
    string | null
  >(null);
  const chatThreads = useQuery(
    api.aiState.listChatThreads,
    organizationId
      ? {
          organizationId,
        }
      : "skip",
  );
  const hasUnreadChatUpdates = useQuery(
    api.aiState.hasUnreadChatUpdates,
    organizationId
      ? {
          organizationId,
        }
      : {},
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
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isResolvingPendingAction, setIsResolvingPendingAction] = useState(false);
  const [isResolvingClarification, setIsResolvingClarification] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isNearTop, setIsNearTop] = useState(false);
  const [showInputBottomFade, setShowInputBottomFade] = useState(false);
  const [isVoiceSupported, setIsVoiceSupported] = useState<boolean | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [expandedImageAttachment, setExpandedImageAttachment] = useState<{
    src: string;
    name: string;
  } | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<
    Record<
      string,
      {
        optionId: string | null;
        otherText: string;
      }
    >
  >({});
  const [clarificationQuestionIndex, setClarificationQuestionIndex] = useState(0);
  const [missingClarificationQuestionId, setMissingClarificationQuestionId] = useState<
    string | null
  >(null);
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
  const handledExportResultIdsRef = useRef(new Set<string>());
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const clarificationAnswersRef = useRef<
    Record<
      string,
      {
        optionId: string | null;
        otherText: string;
      }
    >
  >({});
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
  const markSeenInFlightForUpdatedAtRef = useRef<string | null>(null);
  const hasAttemptedAutoCreateThreadRef = useRef(false);
  const hasUserOpenedPanelRef = useRef(false);
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
  const hasAvailableWebChatThreads = availableChatThreads.some(isWebThread);
  type LabeledChatThread = (typeof availableChatThreads)[number] & {
    label: string;
  };
  const normalizedHistorySearchQuery = historySearchQuery.trim().toLowerCase();
  const filteredChatThreads = useMemo<LabeledChatThread[]>(() => {
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

    return withLabels.filter((thread) => {
      const normalizedTitle = thread.title?.toLowerCase() ?? "";
      const normalizedChannelLabel =
        thread.channel === "whatsapp" ? "whatsapp" : "web";
      return (
        thread.label.toLowerCase().includes(normalizedHistorySearchQuery) ||
        normalizedTitle.includes(normalizedHistorySearchQuery) ||
        normalizedChannelLabel.includes(normalizedHistorySearchQuery)
      );
    });
  }, [
    availableChatThreads,
    normalizedHistorySearchQuery,
    threadRangeFormatter,
  ]);
  const activeChatThread = useMemo(
    () =>
      activeThreadId
        ? availableChatThreads.find((thread) => thread.threadId === activeThreadId) ?? null
        : null,
    [activeThreadId, availableChatThreads],
  );
  const filteredWebChatThreads = useMemo(
    () => filteredChatThreads.filter(isWebThread),
    [filteredChatThreads],
  );
  const filteredWhatsappChatThreads = useMemo(
    () => filteredChatThreads.filter(isWhatsappThread),
    [filteredChatThreads],
  );
  const hasFilteredChatThreads = filteredChatThreads.length > 0;
  const isReadOnlyThread = activeChatThread ? isWhatsappThread(activeChatThread) : false;

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

  useEffect(() => {
    let canceled = false;

    const handleExportDownloads = async () => {
      for (const message of persistedMessagesDesc) {
        if (message.type !== "tool-result") {
          continue;
        }

        const exportResults = extractExportReadyResults(message.content);
        for (const [index, exportResult] of exportResults.entries()) {
          const handledId = `${message.id}:${index}`;
          if (handledExportResultIdsRef.current.has(handledId)) {
            continue;
          }

          handledExportResultIdsRef.current.add(handledId);

          try {
            await downloadExportZip(exportResult.manifest, exportResult.exportMode, t);
            if (canceled) {
              return;
            }

            toast.success(
              t(
                exportResult.exportMode === "customers"
                  ? "app.customers.toasts.exportDownloaded"
                  : "app.projects.toasts.exportDownloaded",
              ),
            );
          } catch (error) {
            handledExportResultIdsRef.current.delete(handledId);
            if (canceled) {
              return;
            }

            toast.error(error instanceof Error ? error.message : t("app.chat.error"));
          }
        }
      }
    };

    void handleExportDownloads();

    return () => {
      canceled = true;
    };
  }, [persistedMessagesDesc, t]);

  const timelineAttachmentsByMessageId = useMemo(() => {
    const attachmentMap = new Map<string, TimelineAttachment[]>();

    for (const message of messages) {
      if (message.attachmentNames.length === 0) {
        continue;
      }

      const extractedAttachments = extractTimelineAttachments({
        rawContent: message.rawContent,
        attachmentNames: message.attachmentNames,
      });

      if (extractedAttachments.length > 0) {
        attachmentMap.set(message.id, extractedAttachments);
      }
    }

    return attachmentMap;
  }, [messages]);

  const estimateTimelineRowSize = useCallback(
    (index: number) => {
      const row = timelineRows[index];
      if (!row) {
        return 96;
      }

      const cachedSize = measuredRowSizeCacheRef.current.get(row.id);
      if (cachedSize) {
        return cachedSize;
      }

      if (row.kind === "day-separator") {
        return 80;
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
      const timelineAttachments =
        timelineAttachmentsByMessageId.get(row.message.id) ?? [];
      const hasImageAttachments = timelineAttachments.some(
        (attachment) => attachment.imageSrc !== null,
      );
      const hasFileAttachments = timelineAttachments.some(
        (attachment) => attachment.imageSrc === null,
      );
      const attachmentHeight =
        (hasImageAttachments ? 76 : 0) + (hasFileAttachments ? 30 : 0);
      const baseHeight = isUserMessage ? 44 : 52;
      return Math.min(420, baseHeight + attachmentHeight + effectiveLineCount * 18);
    },
    [timelineAttachmentsByMessageId, timelineRows],
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
  const pendingAction = chatRuntimeState?.pendingAction ?? null;
  const pendingClarification = chatRuntimeState?.pendingClarification ?? null;
  const clarificationQuestions = pendingClarification?.questions ?? [];
  const clarificationQuestionCount = clarificationQuestions.length;
  const activeClarificationQuestion = clarificationQuestions[clarificationQuestionIndex] ?? null;
  const isFirstClarificationQuestion = clarificationQuestionIndex <= 0;
  const isLastClarificationQuestion =
    clarificationQuestionCount === 0 ||
    clarificationQuestionIndex >= clarificationQuestionCount - 1;
  const isBusy =
    isSubmitting ||
    isUploadingAttachments ||
    isCreatingThread ||
    isServerRunning ||
    isResolvingPendingAction ||
    isResolvingClarification;
  const hasPendingClarification = !!pendingClarification;
  const isInputDisabled =
    !organizationId ||
    isBusy ||
    hasPendingClarification ||
    isReadOnlyThread;
  const shouldShowStreamingStatus = isSubmitting || isServerRunning;
  const isWakingAgent = isSubmitting && !isServerRunning;
  const isWaitingForAgentResponse =
    shouldShowStreamingStatus &&
    !isWakingAgent &&
    (chatRuntimeState?.streamingText?.trim().length ?? 0) === 0;
  const supportsVoiceInput = isVoiceSupported === true;
  const isVoiceUnsupported = isVoiceSupported === false;
  const isVoiceControlDisabled =
    !organizationId ||
    isBusy ||
    !supportsVoiceInput ||
    hasPendingClarification ||
    isReadOnlyThread;
  const voiceButtonLabel = !supportsVoiceInput
    ? t("app.chat.voiceUnsupported")
    : isListening
      ? t("app.chat.voiceStop")
      : t("app.chat.voiceStart");
  const streamActor = chatRuntimeState?.streamActor ?? "main";
  const streamPhase = chatRuntimeState?.streamPhase ?? "idle";
  const shouldShimmerStreamLabel =
    shouldShowStreamingStatus &&
    (streamPhase === "thinking" ||
      streamPhase === "delegating" ||
      streamPhase === "tool");
  const thinkingStatusLabel =
    streamActor === "organization"
      ? t("app.chat.stream.organizationWorking")
      : streamActor === "customer"
        ? t("app.chat.stream.customerWorking")
        : streamActor === "project"
          ? t("app.chat.stream.projectWorking")
      : streamActor === "user"
        ? t("app.chat.stream.userWorking")
      : t("app.chat.thinking");
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
      throw new Error(t("app.chat.noOrganization"));
    }

    const createdThread = await createChatThread({
      organizationId,
    });

    setPendingCreatedThreadId(createdThread.threadId);
    setActiveThreadId(createdThread.threadId);
    return createdThread.threadId;
  }, [createChatThread, organizationId, t]);

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
      hasUserOpenedPanelRef.current = true;
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
    hasUserOpenedPanelRef.current = true;
    setIsOpen(true);
  };

  const startVoiceInput = () => {
    if (!organizationId || isBusy || isListening || isReadOnlyThread) {
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
    setClarificationAnswers({});
    setLastThoughtDurationMs(null);
    setIsCreatingThread(false);
    setIsResolvingPendingAction(false);
    setIsResolvingClarification(false);
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
    markSeenInFlightForUpdatedAtRef.current = null;
    setPendingCreatedThreadId(null);
    hasAttemptedAutoCreateThreadRef.current = false;
    hasUserOpenedPanelRef.current = false;
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
    setClarificationAnswers({});
    setLastThoughtDurationMs(null);
    setIsResolvingPendingAction(false);
    setIsResolvingClarification(false);
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
    markSeenInFlightForUpdatedAtRef.current = null;
  }, [activeThreadId]);

  useEffect(() => {
    if (!organizationId) {
      setPersistedActiveThreadId(null);
      setHydratedPersistedThreadOrgId(null);
      return;
    }

    let nextPersistedThreadId: string | null = null;
    try {
      const storedThreadId = window.localStorage.getItem(
        getActiveThreadStorageKey(organizationId),
      );
      nextPersistedThreadId =
        storedThreadId && storedThreadId.trim().length > 0 ? storedThreadId : null;
    } catch {
      nextPersistedThreadId = null;
    }

    setPersistedActiveThreadId(nextPersistedThreadId);
    setHydratedPersistedThreadOrgId(organizationId);
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !activeThreadId) {
      return;
    }

    try {
      window.localStorage.setItem(
        getActiveThreadStorageKey(organizationId),
        activeThreadId,
      );
    } catch {
      // Ignore storage write failures (e.g. private mode restrictions).
    }
  }, [activeThreadId, organizationId]);

  const markThreadAsSeen = useCallback(
    (thread: ChatThreadSummary | null) => {
      if (!organizationId || !thread) {
        return;
      }

      const seenUpdatedAt = thread.lastSeenUpdatedAt ?? 0;
      const threadUpdatedAt = thread.updatedAt;
      if (threadUpdatedAt <= seenUpdatedAt) {
        markSeenInFlightForUpdatedAtRef.current = null;
        return;
      }

      const markSeenRequestKey = `${thread.threadId}:${threadUpdatedAt}`;
      if (markSeenInFlightForUpdatedAtRef.current === markSeenRequestKey) {
        return;
      }

      markSeenInFlightForUpdatedAtRef.current = markSeenRequestKey;
      void markChatSeenState({
        organizationId,
        threadId: thread.threadId,
        seenUpToUpdatedAt: threadUpdatedAt,
      }).catch(() => {
        if (markSeenInFlightForUpdatedAtRef.current === markSeenRequestKey) {
          markSeenInFlightForUpdatedAtRef.current = null;
        }
      });
    },
    [markChatSeenState, organizationId],
  );

  useEffect(() => {
    if (!isOpen || !hasUserOpenedPanelRef.current) {
      return;
    }

    markThreadAsSeen(activeChatThread);
  }, [activeChatThread, isOpen, markThreadAsSeen]);

  useEffect(() => {
    const validRowIds = new Set(timelineRows.map((row) => row.id));
    for (const rowId of measuredRowSizeCacheRef.current.keys()) {
      if (!validRowIds.has(rowId)) {
        measuredRowSizeCacheRef.current.delete(rowId);
      }
    }
  }, [timelineRows]);

  useEffect(() => {
    if (!pendingCreatedThreadId) {
      return;
    }

    if (activeThreadId !== pendingCreatedThreadId) {
      setPendingCreatedThreadId(null);
      return;
    }

    if (chatThreads?.some((thread) => thread.threadId === pendingCreatedThreadId)) {
      setPendingCreatedThreadId(null);
    }
  }, [activeThreadId, chatThreads, pendingCreatedThreadId]);

  useEffect(() => {
    if (!isOpen) {
      hasAttemptedAutoCreateThreadRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!organizationId || chatThreads === undefined) {
      return;
    }

    if (hydratedPersistedThreadOrgId !== organizationId) {
      return;
    }

    if (
      activeThreadId &&
      (chatThreads.some((thread) => thread.threadId === activeThreadId) ||
        activeThreadId === pendingCreatedThreadId)
    ) {
      return;
    }

    if (chatThreads.length === 0) {
      if (activeThreadId !== null) {
        setActiveThreadId(null);
      }
      return;
    }

    const nextPersistedThreadId =
      persistedActiveThreadId &&
      chatThreads.some(
        (thread) =>
          thread.threadId === persistedActiveThreadId && isWebThread(thread),
      )
        ? persistedActiveThreadId
        : null;

    const nextAutomaticThreadId =
      nextPersistedThreadId ?? chatThreads.find(isWebThread)?.threadId ?? null;

    setActiveThreadId(nextAutomaticThreadId);
  }, [
    activeThreadId,
    chatThreads,
    hydratedPersistedThreadOrgId,
    organizationId,
    pendingCreatedThreadId,
    persistedActiveThreadId,
  ]);

  useEffect(() => {
    if (
      !isOpen ||
      !hasUserOpenedPanelRef.current ||
      !organizationId ||
      chatThreads === undefined ||
      hydratedPersistedThreadOrgId !== organizationId ||
      hasAvailableWebChatThreads ||
      activeThreadId !== null ||
      isCreatingThread ||
      hasAttemptedAutoCreateThreadRef.current
    ) {
      return;
    }

    let isCancelled = false;
    hasAttemptedAutoCreateThreadRef.current = true;
    setIsCreatingThread(true);

    void createThreadForCurrentOrganization()
      .catch(() => {
        if (!isCancelled) {
          toast.error(t("app.chat.error"));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsCreatingThread(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    activeThreadId,
    chatThreads,
    createThreadForCurrentOrganization,
    hasAvailableWebChatThreads,
    hydratedPersistedThreadOrgId,
    isCreatingThread,
    isOpen,
    organizationId,
    t,
  ]);

  useEffect(() => {
    if (!pendingClarification) {
      setClarificationAnswers({});
      clarificationAnswersRef.current = {};
      setClarificationQuestionIndex(0);
      setMissingClarificationQuestionId(null);
      return;
    }

    setClarificationAnswers((current) => {
      const nextAnswers: Record<
        string,
        {
          optionId: string | null;
          otherText: string;
        }
      > = {};

      pendingClarification.questions.forEach((question) => {
        nextAnswers[question.id] = {
          optionId: current[question.id]?.optionId ?? null,
          otherText: current[question.id]?.otherText ?? "",
        };
      });

      clarificationAnswersRef.current = nextAnswers;
      return nextAnswers;
    });

    setClarificationQuestionIndex((current) =>
      current >= pendingClarification.questions.length ? 0 : current,
    );
  }, [pendingClarification]);

  const isClarificationQuestionAnswered = useCallback(
    (
      question: {
        id: string;
        required: boolean;
      },
      answers: Record<
        string,
        {
          optionId: string | null;
          otherText: string;
        }
      >,
    ) => {
      if (!question.required) {
        return true;
      }

      const answer = answers[question.id];
      if (!answer) {
        return false;
      }

      const hasOption = !!answer.optionId;
      const hasOtherText = answer.otherText.trim().length > 0;
      return hasOption || hasOtherText;
    },
    [],
  );

  const handleNextClarificationQuestion = useCallback(() => {
    setMissingClarificationQuestionId(null);
    setClarificationQuestionIndex((current) =>
      Math.min(current + 1, Math.max(0, clarificationQuestionCount - 1)),
    );
  }, [clarificationQuestionCount]);

  const handlePreviousClarificationQuestion = useCallback(() => {
    setMissingClarificationQuestionId(null);
    setClarificationQuestionIndex((current) => Math.max(0, current - 1));
  }, []);

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
    if (
      !isOpen ||
      !organizationId ||
      isBusy ||
      isListening ||
      isReadOnlyThread
    ) {
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [isBusy, isListening, isOpen, isReadOnlyThread, organizationId]);

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
    !isListening &&
    !hasPendingClarification &&
    !isReadOnlyThread;

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!organizationId || isBusy || isReadOnlyThread) {
      event.target.value = "";
      return;
    }

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
    setIsUploadingAttachments(true);
    try {
      for (const file of filesToProcess) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error(t("app.chat.fileTooLarge"));
          continue;
        }

        const contentType = file.type || "application/octet-stream";

        try {
          const uploadUrl = await generateUploadUrl({
            organizationId,
          });
          const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": contentType,
            },
            body: file,
          });

          if (!uploadResponse.ok) {
            throw new Error("Upload failed");
          }

          const uploadResult = await uploadResponse.json();
          const storageId = getStorageIdFromUploadResult(uploadResult);
          if (!storageId) {
            throw new Error("Missing storage id");
          }

          processedFiles.push({
            id: createMessageId(),
            name: file.name,
            contentType,
            storageId,
          });
        } catch {
          toast.error(t("app.chat.fileReadError"));
        }
      }

      if (processedFiles.length === 0) {
        return;
      }

      setPendingAttachments((current) => [...current, ...processedFiles]);
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organizationId || isBusy || isListening || isReadOnlyThread) {
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

    const attachmentsForSend = pendingAttachments.map((attachment) => ({
      name: attachment.name,
      contentType: attachment.contentType,
      storageId: attachment.storageId,
    }));

    const optimisticRawContent =
      attachmentsForSend.length === 0
        ? userMessageContent
        : [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...attachmentsForSend.map((attachment) => ({
              type: attachment.contentType.startsWith("image/")
                ? ("image-file" as const)
                : ("file" as const),
              mimeType: attachment.contentType,
              filename: attachment.name,
              storageId: attachment.storageId,
            })),
          ];

    const optimisticMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      type: "text",
      content: userMessageContent,
      rawContent: optimisticRawContent,
      createdAt: Date.now(),
      attachmentNames,
      isOptimistic: true,
    };

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
        pageContext: pageContext ?? undefined,
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
    if (!organizationId || !pendingAction || isReadOnlyThread) {
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
    if (!organizationId || !pendingAction || isReadOnlyThread) {
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

  const handleClarificationOptionSelect = (questionId: string, optionId: string) => {
    if (isReadOnlyThread) {
      return;
    }

    setClarificationAnswers((current) => {
      const nextAnswers = {
        ...current,
        [questionId]: {
          optionId,
          otherText: current[questionId]?.otherText ?? "",
        },
      };
      clarificationAnswersRef.current = nextAnswers;
      return nextAnswers;
    });

    if (missingClarificationQuestionId === questionId) {
      setMissingClarificationQuestionId(null);
    }
  };

  const handleClarificationOtherTextChange = (
    questionId: string,
    otherText: string,
  ) => {
    if (isReadOnlyThread) {
      return;
    }

    setClarificationAnswers((current) => {
      const nextAnswers = {
        ...current,
        [questionId]: {
          optionId: current[questionId]?.optionId ?? null,
          otherText,
        },
      };
      clarificationAnswersRef.current = nextAnswers;
      return nextAnswers;
    });

    if (missingClarificationQuestionId === questionId) {
      setMissingClarificationQuestionId(null);
    }
  };

  const handleSubmitClarification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organizationId || !pendingClarification || isBusy || isReadOnlyThread) {
      return;
    }

    if (!isLastClarificationQuestion) {
      handleNextClarificationQuestion();
      return;
    }

    const currentAnswers = clarificationAnswersRef.current;
    const answers = pendingClarification.questions.map((question) => ({
      questionId: question.id,
      optionId: currentAnswers[question.id]?.optionId ?? undefined,
      otherText: currentAnswers[question.id]?.otherText?.trim() || undefined,
    }));

    const firstMissingRequiredQuestionIndex = pendingClarification.questions.findIndex(
      (question) => !isClarificationQuestionAnswered(question, currentAnswers),
    );

    if (firstMissingRequiredQuestionIndex >= 0) {
      setClarificationQuestionIndex(firstMissingRequiredQuestionIndex);
      setMissingClarificationQuestionId(
        pendingClarification.questions[firstMissingRequiredQuestionIndex]?.id ?? null,
      );
      return;
    }

    setIsResolvingClarification(true);
    try {
      const submitResult = await submitClarificationAnswers({
        organizationId,
        clarificationSessionId: pendingClarification.id,
        locale,
        answers,
      });

      if (submitResult.status !== "answered") {
        if (submitResult.status === "error") {
          const firstMissingAfterSubmitIndex = pendingClarification.questions.findIndex(
            (question) => !isClarificationQuestionAnswered(question, currentAnswers),
          );
          const normalizedErrorText = submitResult.text.toLowerCase();
          const isRequiredClarificationError =
            normalizedErrorText.includes("clarification questions") ||
            normalizedErrorText.includes("rückfragen beantworten");
          if (firstMissingAfterSubmitIndex >= 0) {
            setClarificationQuestionIndex(firstMissingAfterSubmitIndex);
            setMissingClarificationQuestionId(
              pendingClarification.questions[firstMissingAfterSubmitIndex]?.id ?? null,
            );
          } else if (isRequiredClarificationError) {
            setMissingClarificationQuestionId(activeClarificationQuestion?.id ?? null);
          } else {
            toast.error(submitResult.text);
          }
        } else {
          appendOptimisticAssistantMessage(submitResult.text);
        }
        return;
      }

      const resumeResult = await resumeFromClarification({
        organizationId,
        clarificationSessionId: pendingClarification.id,
        locale,
      });

      if (resumeResult.status === "error") {
        toast.error(resumeResult.text);
        return;
      }

      if (resumeResult.status === "resumed") {
        if (!resumeResult.resumePrompt || !resumeResult.threadId) {
          appendOptimisticAssistantMessage(resumeResult.text);
          return;
        }

        setIsSubmitting(true);
        try {
          await chat({
            organizationId,
            threadId: resumeResult.threadId,
            locale,
            prompt: resumeResult.resumePrompt,
            pageContext: pageContext ?? undefined,
          });
        } catch {
          toast.error(t("app.chat.error"));
        } finally {
          setIsSubmitting(false);
        }
        return;
      }

      if (resumeResult.status === "expired" || resumeResult.status === "missing") {
        appendOptimisticAssistantMessage(resumeResult.text);
      }
    } catch {
      toast.error(t("app.chat.error"));
    } finally {
      setIsResolvingClarification(false);
    }
  };

  const handleCancelClarification = async () => {
    if (!organizationId || !pendingClarification || isBusy || isReadOnlyThread) {
      return;
    }

    setIsResolvingClarification(true);
    try {
      const result = await cancelClarificationSession({
        organizationId,
        clarificationSessionId: pendingClarification.id,
        locale,
      });
      appendOptimisticAssistantMessage(result.text);
      if (result.status === "error") {
        toast.error(result.text);
      }
    } catch {
      toast.error(t("app.chat.error"));
    } finally {
      setIsResolvingClarification(false);
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
  const hasUnseenAgentEvent = hasUnreadChatUpdates === true;
  const shouldBlinkChatBubble = !isOpen && hasUnseenAgentEvent;
  const renderHistoryThreadButton = (thread: LabeledChatThread) => (
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
  );

  return (
    <>
      <Button
        type="button"
        size="icon-lg"
        variant="outline"
        className={cn(
          "fixed right-6 bottom-6 z-[80] size-14 rounded-full border-zinc-300 bg-white text-zinc-700 shadow-xl transition-all duration-200 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:border-zinc-400 focus-visible:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
          isOpen ? "scale-95" : "scale-100",
          shouldBlinkChatBubble && "chat-bubble-blink",
        )}
        onClick={() =>
          setIsOpen((previous) => {
            const next = !previous;
            if (previous && !next) {
              markThreadAsSeen(activeChatThread);
            }
            hasUserOpenedPanelRef.current = next;
            return next;
          })
        }
        aria-label={isOpen ? t("common.actions.close") : t("app.chat.open")}
      >
        {isOpen ? (
          <RiCloseLine className="size-6" />
        ) : (
          <RiChat3Line className="size-6" />
        )}
      </Button>

      <div className="pointer-events-none fixed inset-x-4 top-10 bottom-24 z-[70] flex justify-end sm:top-14 sm:right-6 sm:bottom-24 sm:left-auto sm:w-[23rem]">
        <TooltipProvider>
          <section
            aria-hidden={!isOpen}
            inert={!isOpen}
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
                            <div className="py-8">
                              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                                <span className="h-px flex-1 bg-border/70" />
                                <span>{row.label}</span>
                                <span className="h-px flex-1 bg-border/70" />
                              </div>
                            </div>
                          ) : (() => {
                            const message = row.message;
                            const timelineAttachments =
                              timelineAttachmentsByMessageId.get(message.id) ?? [];
                            const imageAttachments = timelineAttachments.filter(
                              (attachment) => attachment.imageSrc !== null,
                            );
                            const fileAttachments = timelineAttachments.filter(
                              (attachment) => attachment.imageSrc === null,
                            );
                            const isUserMessage = message.role === "user";
                            const isStreamingAssistantMessage =
                              !isUserMessage &&
                              shouldShowStreamingStatus &&
                              message.id === "streaming-assistant";
                            const showInlineThinking =
                              isStreamingAssistantMessage &&
                              (isWaitingForAgentResponse || isWakingAgent);
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
                                {timelineAttachments.length > 0 ? (
                                  <div
                                    className={cn(
                                      "max-w-[80%] space-y-1.5",
                                      isUserMessage ? "text-right" : "text-left",
                                    )}
                                  >
                                    {imageAttachments.length > 0 ? (
                                      <div
                                        className={cn(
                                          "flex flex-wrap gap-1.5",
                                          isUserMessage ? "justify-end" : "justify-start",
                                        )}
                                      >
                                        {imageAttachments.map((attachment) => (
                                          <button
                                            key={`${message.id}-image-${attachment.id}`}
                                            type="button"
                                            className="group relative size-16 overflow-hidden rounded-md border border-border/70 bg-background"
                                            onClick={() => {
                                              if (!attachment.imageSrc) {
                                                return;
                                              }

                                              setExpandedImageAttachment({
                                                src: attachment.imageSrc,
                                                name: attachment.name,
                                              });
                                            }}
                                            aria-label={attachment.name}
                                          >
                                            <img
                                              src={attachment.imageSrc ?? undefined}
                                              alt={attachment.name}
                                              loading="lazy"
                                              className="size-full object-cover transition-transform duration-150 group-hover:scale-[1.03]"
                                            />
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                    {fileAttachments.length > 0 ? (
                                      <div
                                        className={cn(
                                          "flex flex-wrap gap-1.5",
                                          isUserMessage ? "justify-end" : "justify-start",
                                        )}
                                      >
                                        {fileAttachments.map((attachment) => (
                                          <span
                                            key={`${message.id}-file-${attachment.id}`}
                                            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground"
                                          >
                                            <RiAttachment2 className="size-3 shrink-0 opacity-70" />
                                            <span className="max-w-[10.5rem] truncate">
                                              {attachment.name}
                                            </span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
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
                                  {showInlineThinking ? (
                                    <p
                                      className={cn(
                                        "pb-1 text-xs text-muted-foreground",
                                        shouldShimmerStreamLabel && "chat-shimmer-text",
                                      )}
                                    >
                                      {thinkingStatusLabel}
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

              {pendingAction ? (
                <div className="mt-3 rounded-xl border bg-card/60 p-3">
                  <p className="text-xs font-semibold text-foreground">
                    {pendingAction.payload.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pendingAction.payload.description}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        pendingAction.actionType === "delete-organization" ||
                        pendingAction.actionType === "archive-customer" ||
                        pendingAction.actionType === "archive-project" ||
                        pendingAction.actionType === "remove-member"
                          ? "destructive"
                          : "default"
                      }
                      disabled={isResolvingPendingAction || isReadOnlyThread}
                      onClick={() => {
                        void handleConfirmPendingAction();
                      }}
                    >
                      {pendingAction.payload.confirmLabel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isResolvingPendingAction || isReadOnlyThread}
                      onClick={() => {
                        void handleCancelPendingAction();
                      }}
                    >
                      {pendingAction.payload.cancelLabel}
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
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
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
                      >
                        <RiAddLine className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t("app.chat.menu.newChat")}</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
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
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{t("app.chat.menu.open")}</TooltipContent>
                    </Tooltip>
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
            {hasPendingClarification && pendingClarification ? (
              <form
                onSubmit={handleSubmitClarification}
                className={cn(
                  "space-y-2 px-4 pt-3 pb-0",
                  isOpen ? "pointer-events-auto" : "pointer-events-none",
                )}
              >
                <div className="rounded-xl border bg-card/70 p-3">
                  {activeClarificationQuestion ? (
                    <div className="space-y-2.5">
                      <p className="text-sm font-medium leading-snug text-foreground">
                        {activeClarificationQuestion.prompt}
                      </p>

                      {missingClarificationQuestionId === activeClarificationQuestion.id ? (
                        <p className="text-xs text-destructive">
                          {t("app.chat.clarification.completeRequired")}
                        </p>
                      ) : null}

                      <div className="space-y-1.5">
                        {activeClarificationQuestion.options.map((option) => {
                          const selectedOptionId =
                            clarificationAnswers[activeClarificationQuestion.id]?.optionId ??
                            null;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                handleClarificationOptionSelect(
                                  activeClarificationQuestion.id,
                                  option.id,
                                )
                              }
                              className={cn(
                                "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                                selectedOptionId === option.id
                                  ? "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100"
                                  : "border-border/80 text-foreground hover:border-zinc-300 dark:hover:border-zinc-600",
                              )}
                              disabled={isBusy || isReadOnlyThread}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      {activeClarificationQuestion.allowOther ? (
                        <Input
                          value={
                            clarificationAnswers[activeClarificationQuestion.id]?.otherText ??
                            ""
                          }
                          onChange={(event) =>
                            handleClarificationOtherTextChange(
                              activeClarificationQuestion.id,
                              event.target.value,
                            )
                          }
                          placeholder={t("app.chat.clarification.otherPlaceholder")}
                          disabled={isBusy || isReadOnlyThread}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy || isReadOnlyThread}
                      onClick={() => {
                        void handleCancelClarification();
                      }}
                    >
                      {t("common.actions.cancel")}
                    </Button>

                    {clarificationQuestionCount > 1 ? (
                      <p className="text-center text-[11px] text-muted-foreground">
                        {clarificationQuestionIndex + 1}/{clarificationQuestionCount}
                      </p>
                    ) : (
                      <span />
                    )}

                    <div className="flex items-center gap-2">
                      {clarificationQuestionCount > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            isBusy ||
                            isReadOnlyThread ||
                            isFirstClarificationQuestion
                          }
                          onClick={handlePreviousClarificationQuestion}
                        >
                          {t("common.actions.previous")}
                        </Button>
                      ) : null}

                      {clarificationQuestionCount > 1 && !isLastClarificationQuestion ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy || isReadOnlyThread}
                          onClick={handleNextClarificationQuestion}
                        >
                          {t("common.actions.next")}
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isBusy || isReadOnlyThread}
                        >
                          {t("app.chat.clarification.continue")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <p className="pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                  {t("app.chat.disclaimer", {
                    agentName,
                  })}
                </p>
              </form>
            ) : (
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
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex" />}>
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
                              disabled={isInputDisabled || isListening}
                            >
                              <RiCloseLine className="size-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("app.chat.removeFile")}</TooltipContent>
                        </Tooltip>
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
                      "field-sizing-content min-h-16 max-h-[13rem] resize-none overflow-y-auto border-0 bg-transparent px-3 pb-2 shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent",
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
                        ? "bg-transparent [&_[data-slot=button]:disabled]:border-input [&_[data-slot=button]:disabled]:bg-transparent [&_[data-slot=button]:disabled]:text-muted-foreground [&_[data-slot=button]:disabled]:opacity-100"
                        : "bg-white dark:bg-zinc-900",
                    )}
                  >
                    {showInputBottomFade ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-full h-12 bg-gradient-to-b from-transparent via-white/70 to-white dark:via-zinc-900/70 dark:to-zinc-900" />
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger
                        className="pointer-events-auto inline-flex"
                        render={<span />}
                      >
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          className={cn(
                            "pointer-events-auto",
                            isInputDisabled &&
                              "border-input bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent",
                          )}
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isInputDisabled || isListening}
                          aria-label={t("app.chat.attach")}
                        >
                          <RiAttachment2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("app.chat.attach")}</TooltipContent>
                    </Tooltip>
                    <div className="flex-1" />
                    <Tooltip>
                      <TooltipTrigger
                        className="pointer-events-auto inline-flex"
                        render={<span />}
                      >
                        <Button
                          type="button"
                          size="icon-sm"
                          variant={isListening ? "destructive" : "outline"}
                          className={cn(
                            "pointer-events-auto",
                            isInputDisabled &&
                              "border-input bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent",
                          )}
                          onClick={() => {
                            if (isListening) {
                              stopVoiceInput();
                              return;
                            }

                            startVoiceInput();
                          }}
                          disabled={isVoiceControlDisabled}
                          aria-label={voiceButtonLabel}
                        >
                          {isListening ? (
                            <RiStopCircleLine />
                          ) : (
                            <RiMicLine />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{voiceButtonLabel}</TooltipContent>
                    </Tooltip>
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
                {isReadOnlyThread ? (
                  <p className="text-xs text-muted-foreground">
                    {t("app.chat.readOnly.whatsapp")}
                  </p>
                ) : null}
                {!isReadOnlyThread && isVoiceUnsupported ? (
                  <p className="text-xs text-muted-foreground">
                    {t("app.chat.voiceUnsupported")}
                  </p>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    void handleFileSelection(event);
                  }}
                  disabled={isInputDisabled || isListening}
                />
                <p className="pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                  {t("app.chat.disclaimer", {
                    agentName,
                  })}
                </p>
              </form>
            )}
          </div>
          </section>
        </TooltipProvider>
      </div>

      <Dialog
        open={expandedImageAttachment !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setExpandedImageAttachment(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[calc(100vw-2rem)] max-w-3xl gap-0"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{expandedImageAttachment?.name ?? t("app.chat.attach")}</DialogTitle>
          </DialogHeader>
          {expandedImageAttachment ? (
            <div className="space-y-2">
              <img
                src={expandedImageAttachment.src}
                alt={expandedImageAttachment.name}
                className="max-h-[80vh] w-full rounded-lg object-contain"
              />
              <DialogFooter className="mt-2 sm:items-center sm:justify-between">
                <p className="truncate text-xs text-muted-foreground">
                  {expandedImageAttachment.name}
                </p>
                <DialogClose
                  render={
                    <Button type="button" variant="outline" size="sm" className="shrink-0" />
                  }
                >
                  {t("common.actions.close")}
                </DialogClose>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
            ) : !hasFilteredChatThreads ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                {t("app.chat.history.noResults")}
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
                {filteredWebChatThreads.map(renderHistoryThreadButton)}
                {filteredWhatsappChatThreads.length > 0 ? (
                  <div className="mt-1 border-t px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("app.chat.history.whatsappChannel")}
                  </div>
                ) : null}
                {filteredWhatsappChatThreads.map(renderHistoryThreadButton)}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
