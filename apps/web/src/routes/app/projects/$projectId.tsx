import type { Translator } from "@mvp-template/i18n";
import { api } from "@mvp-template/backend/convex/_generated/api";
import type { Id } from "@mvp-template/backend/convex/_generated/dataModel";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDownloadLine,
  RiEditLine,
  RiFolderTransferLine,
  RiMailSendLine,
  RiSearchLine,
  RiVideoLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/sonner";

import { ProjectCustomerDialog } from "@/components/customers/project-customer-dialog";
import {
  DetailHeaderActionsSkeleton,
  ProjectDetailSkeleton,
  ProjectTimelineLoadingSkeleton,
} from "@/components/loading/projects-customers-skeletons";
import { ProjectFormFields } from "@/components/projects/project-form-fields";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentOrganizationState } from "@/lib/current-organization";
import { downloadExportZip } from "@/lib/export-zip";
import { useI18n } from "@/lib/i18n-provider";

export const Route = createFileRoute("/app/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    customerId:
      typeof search.customerId === "string" && search.customerId.trim().length > 0
        ? search.customerId
        : undefined,
  }),
  component: ProjectDetailRoute,
});

type ProjectStatus = "active" | "done";
type LanguageView = "original" | "translation";

type CustomerSummary = {
  _id: Id<"customers">;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
};

type TimelineMediaItem = {
  mediaAssetId: Id<"whatsappMediaAssets">;
  mimeType: string;
  kind: "image" | "audio" | "video" | "file";
  url?: string;
  summary?: string;
  transcript?: string;
  extractedText?: string;
};

type TimelineItem = {
  _id: Id<"projectTimelineItems">;
  batchId: Id<"whatsappSendBatches">;
  sourceType: "whatsapp_message" | "whatsapp_batch_summary";
  messageId?: Id<"whatsappMessages">;
  addedAt: number;
  dayBucketUtc: string;
  addedByMemberId: string;
  addedByUserId: string;
  addedByName?: string;
  sourceText?: string;
  text?: string;
  transcript?: string;
  extractedText?: string;
  summary?: string;
  batchTitle?: string;
  batchOverview?: string;
  hasNachtrag?: boolean;
  nachtragNeedsClarification?: boolean;
  nachtragItems?: string[];
  nachtragDetails?: string;
  nachtragLanguage?: string;
  keywords?: string[];
  media: TimelineMediaItem[];
};

type ProjectRecord = {
  _id: Id<"projects">;
  customerId?: Id<"customers">;
  customer?: CustomerSummary;
  location: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
};

type BatchAccumulator = {
  badgeDate: number;
  batchId: Id<"whatsappSendBatches">;
  messages: TimelineItem[];
  summaryRow?: TimelineItem;
};

type BatchViewModel = {
  badgeDate: number;
  batchId: Id<"whatsappSendBatches">;
  hasNachtrag: boolean;
  memberLabel: string;
  messages: TimelineItem[];
  nachtragDetails?: string;
  nachtragItems: string[];
  nachtragNeedsClarification: boolean;
  oneSentenceSummary: string;
  overview: string;
  overviewMedia: TimelineMediaItem[];
  title: string;
  allMedia: TimelineMediaItem[];
};

const EMPTY_CAPTION_TRACK = "data:text/vtt;charset=utf-8,WEBVTT%0A%0A";
const INLINE_MARKDOWN_TOKEN_PATTERN =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
const MARKDOWN_PARAGRAPH_SPLIT_PATTERN = /\n{2,}/;
const MARKDOWN_PREFIX_PATTERN = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)/g;
const MARKDOWN_LINE_BREAK_PATTERN = /\s*\n\s*/g;
const NAME_PARTS_SPLIT_PATTERN = /\s+/;
const IMAGE_ZOOM_MIN = 1;
const IMAGE_CLICK_ZOOM = 5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mediaKey(media: TimelineMediaItem) {
  return `${media.mediaAssetId}:${media.kind}:${media.mimeType}`;
}

function toDisplayName(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function initialsFromName(value: string) {
  const parts = value
    .trim()
    .split(NAME_PARTS_SPLIT_PATTERN)
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "ME";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  INLINE_MARKDOWN_TOKEN_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(INLINE_MARKDOWN_TOKEN_PATTERN)) {
    const token = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`markdown-strong-${tokenIndex}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={`markdown-code-${tokenIndex}`}
          className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <em key={`markdown-emphasis-${tokenIndex}`}>{token.slice(1, -1)}</em>,
      );
    } else {
      parts.push(token);
    }

    cursor = matchIndex + token.length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : [text];
}

function normalizeOverviewMarkdown(markdown: string, fallbackText: string) {
  const paragraphs = markdown
    .split(MARKDOWN_PARAGRAPH_SPLIT_PATTERN)
    .map((paragraph) =>
      paragraph
        .replace(MARKDOWN_PREFIX_PATTERN, "")
        .replace(MARKDOWN_LINE_BREAK_PATTERN, " ")
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.length > 0 ? paragraphs : [fallbackText];
}

function OverviewMarkdown(props: { content: string; fallbackText: string }) {
  const paragraphs = normalizeOverviewMarkdown(props.content, props.fallbackText);
  const paragraphKeyCounts = new Map<string, number>();

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {paragraphs.map((paragraph) => {
        const seen = paragraphKeyCounts.get(paragraph) ?? 0;
        paragraphKeyCounts.set(paragraph, seen + 1);

        return (
          <p key={`${paragraph}-${seen}`}>{renderInlineMarkdown(paragraph)}</p>
        );
      })}
    </div>
  );
}

function collectOverviewMedia(messages: TimelineItem[]) {
  const mediaIndex = new Map<string, TimelineMediaItem>();

  for (const message of messages) {
    for (const media of message.media) {
      if (!(media.kind === "image" || media.kind === "video")) {
        continue;
      }

      mediaIndex.set(mediaKey(media), media);
    }
  }

  return Array.from(mediaIndex.values());
}

function collectBatchMedia(messages: TimelineItem[]) {
  const mediaIndex = new Map<string, TimelineMediaItem>();

  for (const message of messages) {
    for (const media of message.media) {
      mediaIndex.set(mediaKey(media), media);
    }
  }

  return Array.from(mediaIndex.values());
}

function buildTimelineBatches(rows: TimelineItem[], t: Translator): BatchViewModel[] {
  const byBatch = new Map<string, BatchAccumulator>();

  for (const row of rows) {
    const key = String(row.batchId);
    const current = byBatch.get(key) ?? {
      batchId: row.batchId,
      badgeDate: row.addedAt,
      messages: [],
    };
    current.badgeDate = Math.max(current.badgeDate, row.addedAt);

    if (row.sourceType === "whatsapp_batch_summary") {
      current.summaryRow = row;
    } else {
      current.messages.push(row);
    }

    byBatch.set(key, current);
  }

  return Array.from(byBatch.values())
    .map((group) => {
      const messages = [...group.messages].sort((left, right) => left.addedAt - right.addedAt);
      const summaryRow = group.summaryRow;
      const oneSentenceSummary =
        summaryRow?.summary?.trim() ||
        messages.find((message) => message.summary?.trim())?.summary?.trim() ||
        t("app.projects.detail.defaultSummary");
      const memberLabel = toDisplayName(
        summaryRow?.addedByName || messages[0]?.addedByName,
        summaryRow?.addedByUserId || messages[0]?.addedByUserId || t("app.projects.detail.unknownMember"),
      );
      const overview =
        summaryRow?.batchOverview?.trim() ||
        messages
          .map((message) => message.summary?.trim())
          .filter((value): value is string => Boolean(value))
          .join(" ") ||
        t("app.projects.detail.noDetailedOverviewAvailable");

      return {
        badgeDate: summaryRow?.addedAt ?? group.badgeDate,
        batchId: group.batchId,
        hasNachtrag: Boolean(summaryRow?.hasNachtrag),
        memberLabel,
        messages,
        nachtragDetails: summaryRow?.nachtragDetails?.trim(),
        nachtragItems:
          summaryRow?.nachtragItems
            ?.map((item) => item.trim())
            .filter((item) => item.length > 0) ?? [],
        nachtragNeedsClarification: Boolean(summaryRow?.nachtragNeedsClarification),
        oneSentenceSummary,
        overview,
        overviewMedia: collectOverviewMedia(messages),
        title: summaryRow?.batchTitle?.trim() || t("app.projects.detail.defaultBatchTitle"),
        allMedia: collectBatchMedia(messages),
      } satisfies BatchViewModel;
    })
    .sort((left, right) => right.badgeDate - left.badgeDate);
}

function buildDefaultEmailSubject(projectLocation: string, batchTitle: string) {
  return `${projectLocation}: ${batchTitle}`;
}

function formatMediaDuration(durationInSeconds: number | undefined) {
  if (
    durationInSeconds === undefined ||
    !Number.isFinite(durationInSeconds) ||
    durationInSeconds <= 0
  ) {
    return "--:--";
  }

  const totalSeconds = Math.round(durationInSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function OverviewMediaCard(props: {
  media: TimelineMediaItem;
  onOpenImage: (media: TimelineMediaItem) => void;
}) {
  const { t } = useI18n();
  const { media, onOpenImage } = props;

  if (!media.url) {
    return (
      <div className="rounded-lg border p-3 text-sm text-muted-foreground">
        {t("app.projects.detail.mediaPreviewUnavailable")}
      </div>
    );
  }

  if (media.kind === "image") {
    return (
      <button
        type="button"
        className="group w-full overflow-hidden rounded-lg border text-left"
        onClick={() => onOpenImage(media)}
      >
        <img
          src={media.url}
          alt={media.summary || t("app.projects.detail.projectImageAlt")}
          className="h-48 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
        {media.summary ? (
          <p className="p-2 text-xs text-muted-foreground">{media.summary}</p>
        ) : null}
      </button>
    );
  }

  if (media.kind === "video") {
    return (
      <div className="w-full overflow-hidden rounded-lg border">
        <video
          src={media.url}
          controls
          preload="metadata"
          className="h-48 w-full object-cover"
        >
          <track
            default
            kind="captions"
            label="Placeholder captions"
            src={EMPTY_CAPTION_TRACK}
            srcLang="en"
          />
        </video>
        {media.summary ? (
          <p className="p-2 text-xs text-muted-foreground">{media.summary}</p>
        ) : null}
      </div>
    );
  }

  return null;
}

function MessageMediaBubble(props: {
  memberName: string;
  media: TimelineMediaItem;
  timestampLabel: string;
  focalTranscript?: string;
  originalTranscript?: string;
  onOpenImage: (media: TimelineMediaItem) => void;
  onOpenMediaContent: (media: TimelineMediaItem) => void;
}) {
  const { t } = useI18n();
  const {
    focalTranscript,
    media,
    memberName,
    onOpenImage,
    onOpenMediaContent,
    originalTranscript,
    timestampLabel,
  } = props;
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState<number | undefined>(undefined);
  const translatedTranscript = media.transcript?.trim() || focalTranscript?.trim() || "";
  const originalTranscriptValue = originalTranscript?.trim() || "";
  const hasDifferentTranscript = Boolean(
    translatedTranscript &&
      originalTranscriptValue &&
      translatedTranscript !== originalTranscriptValue,
  );
  const transcriptToRender = translatedTranscript || originalTranscriptValue;
  const bubbleClassName =
    "ml-auto w-full max-w-md origin-right rotate-[0.3deg] rounded-2xl rounded-br-sm bg-muted/60 p-3";
  const mediaBubbleClassName =
    "ml-auto w-fit max-w-full origin-right rotate-[0.3deg] rounded-2xl rounded-br-sm bg-muted/60 p-3";

  useEffect(() => {
    if (!(media.url && (media.kind === "audio" || media.kind === "video"))) {
      setMediaDurationSeconds(undefined);
      return;
    }

    let disposed = false;
    const mediaElement = document.createElement(media.kind === "audio" ? "audio" : "video");

    const handleLoadedMetadata = () => {
      if (disposed) {
        return;
      }

      const duration = mediaElement.duration;
      setMediaDurationSeconds(
        Number.isFinite(duration) && duration > 0 ? duration : undefined,
      );
    };
    const handleError = () => {
      if (!disposed) {
        setMediaDurationSeconds(undefined);
      }
    };

    mediaElement.preload = "metadata";
    mediaElement.src = media.url;
    mediaElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    mediaElement.addEventListener("error", handleError);

    return () => {
      disposed = true;
      mediaElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      mediaElement.removeEventListener("error", handleError);
      mediaElement.src = "";
    };
  }, [media.kind, media.url]);

  if (!media.url) {
    return (
      <div className={bubbleClassName}>
        <p className="text-sm font-medium">{memberName}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("app.projects.detail.storedMediaUnavailable")}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{timestampLabel}</span>
        </div>
      </div>
    );
  }

  if (media.kind === "image") {
    return (
      <div className={mediaBubbleClassName}>
        <p className="text-sm font-medium">{memberName}</p>
        <button
          type="button"
          className="mt-2 inline-block max-w-full overflow-hidden rounded-xl text-left align-top"
          onClick={() => onOpenImage(media)}
        >
          <img
            src={media.url}
            alt={media.summary || t("app.projects.detail.projectImageAlt")}
            className="block h-auto max-h-80 w-auto max-w-full rounded-xl bg-muted/40 object-contain"
            loading="lazy"
          />
        </button>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{timestampLabel}</span>
        </div>
      </div>
    );
  }

  if (media.kind === "audio") {
    return (
      <div className={bubbleClassName}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{memberName}</p>
        </div>
        <button
          type="button"
          className="mt-2 w-full rounded-xl border bg-background/70 px-3 py-2 text-left text-sm font-medium hover:bg-background"
          onClick={() => onOpenMediaContent(media)}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <RiVolumeUpLine className="size-4 text-muted-foreground" />
              {t("app.projects.detail.hearVoiceMessage")}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatMediaDuration(mediaDurationSeconds)}
            </span>
          </span>
        </button>
        {transcriptToRender ? (
          <div className="mt-2 space-y-2">
            {translatedTranscript ? (
              <div className="space-y-1">
                {hasDifferentTranscript ? (
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {t("app.projects.detail.usersLanguage")}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {translatedTranscript}
                </p>
              </div>
            ) : null}
            {hasDifferentTranscript ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("app.projects.detail.originalLanguage")}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {originalTranscriptValue}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{timestampLabel}</span>
        </div>
      </div>
    );
  }

  if (media.kind === "video") {
    return (
      <div className={bubbleClassName}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{memberName}</p>
        </div>
        <button
          type="button"
          className="mt-2 w-full rounded-xl border bg-background/70 px-3 py-2 text-left text-sm font-medium hover:bg-background"
          onClick={() => onOpenMediaContent(media)}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <RiVideoLine className="size-4 text-muted-foreground" />
              {t("app.projects.detail.showVideo")}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatMediaDuration(mediaDurationSeconds)}
            </span>
          </span>
        </button>
        {transcriptToRender ? (
          <div className="mt-2 space-y-2">
            {translatedTranscript ? (
              <div className="space-y-1">
                {hasDifferentTranscript ? (
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {t("app.projects.detail.usersLanguage")}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {translatedTranscript}
                </p>
              </div>
            ) : null}
            {hasDifferentTranscript ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("app.projects.detail.originalLanguage")}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {originalTranscriptValue}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{timestampLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={bubbleClassName}>
      <p className="text-sm font-medium">{memberName}</p>
      <div className="mt-2 space-y-2">
        <p className="text-sm">{t("app.projects.detail.fileAttachment")}</p>
        {media.url ? (
          <a
            href={media.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            {t("app.projects.detail.openAttachment")}
          </a>
        ) : null}
        {media.summary ? (
          <p className="text-sm text-muted-foreground">{media.summary}</p>
        ) : null}
        {media.transcript ? (
          <p className="text-sm text-muted-foreground">{media.transcript}</p>
        ) : null}
        {media.extractedText ? (
          <p className="text-sm text-muted-foreground">{media.extractedText}</p>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{timestampLabel}</span>
      </div>
    </div>
  );
}

function ProjectDetailRoute() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/app/projects/$projectId" });
  const params = Route.useParams();
  const projectId = params.projectId as Id<"projects">;
  const { activeOrganization } = useCurrentOrganizationState();
  const project = useQuery(api.projects.getById, { projectId }) as ProjectRecord | null | undefined;
  const originalTimelineRows = useQuery(api.projects.timeline, { projectId, limit: 500 });
  const projects = useQuery(
    api.projects.list,
    activeOrganization?.id ? { statuses: ["active"] } : "skip",
  );
  const customersQuery = useQuery(api.customers.list, activeOrganization?.id ? {} : "skip");
  const timelineLocalized = useAction(api.projectTranslations.timelineLocalized);
  const sendTimelineBatchEmail = useAction(api.projectEmails.sendTimelineBatchEmail);
  const prepareZipManifest = useAction(api.exports.prepareZipManifest);
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const markReviewed = useMutation(api.projects.markReviewed);
  const reassignBatchProject = useMutation(api.projects.reassignBatchProject);
  const [localizedRows, setLocalizedRows] = useState<TimelineItem[] | null>(null);
  const [isLoadingLocalizedRows, setIsLoadingLocalizedRows] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editProjectLocation, setEditProjectLocation] = useState("");
  const [projectCustomerId, setProjectCustomerId] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
  const [isArchivingProject, setIsArchivingProject] = useState(false);
  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [movingBatch, setMovingBatch] = useState<BatchViewModel | null>(null);
  const [targetProjectId, setTargetProjectId] = useState("");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [isReassigning, setIsReassigning] = useState(false);
  const [composingBatchId, setComposingBatchId] = useState<Id<"whatsappSendBatches"> | null>(null);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [selectedImageIds, setSelectedImageIds] = useState<Array<Id<"whatsappMediaAssets">>>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Array<Id<"whatsappMediaAssets">>>([]);
  const [isSendingBatchEmail, setIsSendingBatchEmail] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [headerRoot, setHeaderRoot] = useState<HTMLElement | null>(null);
  const [messageLanguageById, setMessageLanguageById] = useState<
    Record<string, LanguageView>
  >({});
  const [imageDialogMedia, setImageDialogMedia] = useState<TimelineMediaItem | null>(null);
  const [mediaDialogMedia, setMediaDialogMedia] = useState<TimelineMediaItem | null>(null);
  const [imageZoom, setImageZoom] = useState(IMAGE_ZOOM_MIN);
  const [imageTransformOrigin, setImageTransformOrigin] = useState("50% 50%");

  const timelineRows = localizedRows ?? originalTimelineRows ?? [];
  const timelineBatches = useMemo(
    () => buildTimelineBatches(timelineRows as TimelineItem[], t),
    [t, timelineRows],
  );
  const localizedBatches = useMemo(
    () => (localizedRows ? buildTimelineBatches(localizedRows as TimelineItem[], t) : []),
    [localizedRows, t],
  );
  const localizedBatchMap = useMemo(
    () => new Map(localizedBatches.map((batch) => [String(batch.batchId), batch])),
    [localizedBatches],
  );
  const composingBatch = useMemo(
    () => (composingBatchId ? localizedBatchMap.get(String(composingBatchId)) ?? null : null),
    [composingBatchId, localizedBatchMap],
  );
  const customers = useMemo(() => (customersQuery ?? []) as CustomerSummary[], [customersQuery]);
  const activeProjectOptions = useMemo(
    () =>
      ((projects ?? []) as ProjectRecord[]).filter(
        (candidate) => candidate._id !== projectId && candidate.status === "active",
      ),
    [projectId, projects],
  );
  const filteredProjectOptions = useMemo(() => {
    const normalizedQuery = projectSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return activeProjectOptions;
    }

    return activeProjectOptions.filter((candidate) =>
      candidate.location.toLowerCase().includes(normalizedQuery),
    );
  }, [activeProjectOptions, projectSearchQuery]);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const selectedImageIdSet = useMemo(
    () => new Set(selectedImageIds.map((mediaAssetId) => String(mediaAssetId))),
    [selectedImageIds],
  );
  const selectedVideoIdSet = useMemo(
    () => new Set(selectedVideoIds.map((mediaAssetId) => String(mediaAssetId))),
    [selectedVideoIds],
  );
  const selectedImages = useMemo(
    () =>
      composingBatch
        ? composingBatch.allMedia.filter(
            (media) => media.kind === "image" && selectedImageIdSet.has(String(media.mediaAssetId)),
          )
        : [],
    [composingBatch, selectedImageIdSet],
  );
  const selectedVideos = useMemo(
    () =>
      composingBatch
        ? composingBatch.allMedia.filter(
            (media) => media.kind === "video" && selectedVideoIdSet.has(String(media.mediaAssetId)),
          )
        : [],
    [composingBatch, selectedVideoIdSet],
  );
  const originalTranscriptByMediaAssetId = useMemo(() => {
    const rows = originalTimelineRows ?? [];
    const byMediaAssetId = new Map<string, string>();

    for (const row of rows as TimelineItem[]) {
      for (const media of row.media) {
        const transcript = media.transcript?.trim() || row.transcript?.trim() || "";
        if (transcript.length === 0) {
          continue;
        }

        const key = String(media.mediaAssetId);
        if (!byMediaAssetId.has(key)) {
          byMediaAssetId.set(key, transcript);
        }
      }
    }

    return byMediaAssetId;
  }, [originalTimelineRows]);
  const originalMessageByTimelineItemId = useMemo(() => {
    const rows = originalTimelineRows ?? [];
    const byTimelineItemId = new Map<string, TimelineItem>();

    for (const row of rows as TimelineItem[]) {
      if (row.sourceType !== "whatsapp_message") {
        continue;
      }

      byTimelineItemId.set(String(row._id), row);
    }

    return byTimelineItemId;
  }, [originalTimelineRows]);
  const previewImages = useMemo(() => {
    const items: TimelineMediaItem[] = [];
    const seen = new Set<string>();

    for (const batch of timelineBatches) {
      for (const media of batch.overviewMedia) {
        if (!(media.kind === "image" && media.url)) {
          continue;
        }

        const key = mediaKey(media);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        items.push(media);
      }

      for (const message of batch.messages) {
        for (const media of message.media) {
          if (!(media.kind === "image" && media.url)) {
            continue;
          }

          const key = mediaKey(media);
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          items.push(media);
        }
      }
    }

    return items;
  }, [timelineBatches]);
  const currentPreviewImageIndex = useMemo(() => {
    if (!imageDialogMedia) {
      return -1;
    }

    const selectedKey = mediaKey(imageDialogMedia);
    return previewImages.findIndex((media) => mediaKey(media) === selectedKey);
  }, [imageDialogMedia, previewImages]);

  useEffect(() => {
    setHeaderRoot(document.getElementById("app-layout-header-actions") as HTMLElement | null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingLocalizedRows(true);

    void timelineLocalized({ projectId, limit: 500, viewerLocale: locale })
      .then((result) => {
        if (!cancelled) {
          setLocalizedRows(result.rows as TimelineItem[]);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : t("app.projects.toasts.timelineLoadFailed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingLocalizedRows(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locale, projectId, t, timelineLocalized]);

  useEffect(() => {
    if (!project) {
      return;
    }

    setEditProjectLocation(project.location);
    setProjectCustomerId(project.customerId ? String(project.customerId) : "");
    void markReviewed({ projectId: project._id });
  }, [markReviewed, project]);

  const resetImageViewer = () => {
    setImageZoom(IMAGE_ZOOM_MIN);
    setImageTransformOrigin("50% 50%");
  };

  const openImageDialog = (media: TimelineMediaItem) => {
    setImageDialogMedia(media);
    resetImageViewer();
  };

  const handleImageClick = (event: MouseEvent<HTMLImageElement>) => {
    const imageBounds = event.currentTarget.getBoundingClientRect();
    const originX = clamp(
      ((event.clientX - imageBounds.left) / imageBounds.width) * 100,
      0,
      100,
    );
    const originY = clamp(
      ((event.clientY - imageBounds.top) / imageBounds.height) * 100,
      0,
      100,
    );
    const isAtClickZoom = Math.abs(imageZoom - IMAGE_CLICK_ZOOM) < 0.01;

    setImageTransformOrigin(`${originX}% ${originY}%`);
    setImageZoom(isAtClickZoom ? IMAGE_ZOOM_MIN : IMAGE_CLICK_ZOOM);
  };

  const showPreviewImageAtIndex = (index: number) => {
    if (previewImages.length === 0) {
      return;
    }

    const normalizedIndex = (index + previewImages.length) % previewImages.length;
    setImageDialogMedia(previewImages[normalizedIndex] ?? null);
    resetImageViewer();
  };

  const handlePreviousPreviewImage = () => {
    if (currentPreviewImageIndex >= 0) {
      showPreviewImageAtIndex(currentPreviewImageIndex - 1);
    }
  };

  const handleNextPreviewImage = () => {
    if (currentPreviewImageIndex >= 0) {
      showPreviewImageAtIndex(currentPreviewImageIndex + 1);
    }
  };

  const handleSaveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project) {
      return;
    }

    const normalizedProjectLocation = editProjectLocation.trim();
    if (!normalizedProjectLocation) {
      toast.error(t("app.projects.toasts.locationRequired"));
      return;
    }

    setIsSavingProject(true);
    try {
      await updateProject({
        projectId: project._id,
        location: normalizedProjectLocation,
        customerId: projectCustomerId ? (projectCustomerId as Id<"customers">) : null,
      });
      setIsEditDialogOpen(false);
      toast.success(t("app.projects.toasts.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.updateFailed"));
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleStatusToggle = async () => {
    if (!project) {
      return;
    }

    const nextStatus: ProjectStatus = project.status === "active" ? "done" : "active";
    try {
      await updateProject({ projectId: project._id, status: nextStatus });
      toast.success(
        nextStatus === "done"
          ? t("app.projects.toasts.markedDone")
          : t("app.projects.toasts.reopened"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.updateFailed"));
    }
  };

  const handleExportProject = async () => {
    if (!project) {
      return;
    }

    setIsExporting(true);
    try {
      const manifest = await prepareZipManifest({
        mode: "projects",
        projectIds: [project._id],
      });

      if (manifest.roots.length === 0) {
        toast.error(t("app.projects.toasts.exportEmpty"));
        return;
      }

      await downloadExportZip(manifest, "projects", t);
      toast.success(t("app.projects.toasts.exportDownloaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleArchiveProject = async () => {
    if (!project) {
      return;
    }

    setIsArchivingProject(true);
    try {
      await archiveProject({ projectId: project._id });
      toast.success(t("app.projects.toasts.archived"));
      void navigate({ to: "/app/projects" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.archiveFailed"));
    } finally {
      setIsArchivingProject(false);
    }
  };

  const handleReassignBatch = async () => {
    if (!movingBatch || !targetProjectId) {
      return;
    }

    setIsReassigning(true);
    try {
      await reassignBatchProject({
        batchId: movingBatch.batchId,
        targetProjectId: targetProjectId as Id<"projects">,
      });
      setMovingBatch(null);
      setTargetProjectId("");
      setProjectSearchQuery("");
      toast.success(t("app.projects.toasts.batchReassigned"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("app.projects.toasts.batchReassignFailed"),
      );
    } finally {
      setIsReassigning(false);
    }
  };

  const resetEmailComposer = () => {
    setComposingBatchId(null);
    setEmailRecipient("");
    setEmailSubject("");
    setEmailBody("");
    setSelectedImageIds([]);
    setSelectedVideoIds([]);
  };

  const openEmailComposer = (
    batchId: Id<"whatsappSendBatches">,
    recipientEmail: string,
  ) => {
    if (!project) {
      return;
    }

    const localizedBatch = localizedBatchMap.get(String(batchId));
    if (!localizedBatch) {
      toast.error(t("app.projects.toasts.localizedUnavailable"));
      return;
    }

    setComposingBatchId(batchId);
    setEmailRecipient(recipientEmail.trim());
    setEmailSubject(buildDefaultEmailSubject(project.location, localizedBatch.title));
    setEmailBody(localizedBatch.overview);
    setSelectedImageIds(
      localizedBatch.allMedia
        .filter((media) => media.kind === "image")
        .map((media) => media.mediaAssetId),
    );
    setSelectedVideoIds(
      localizedBatch.allMedia
        .filter((media) => media.kind === "video")
        .map((media) => media.mediaAssetId),
    );
  };

  const handleStartBatchEmail = (batchId: Id<"whatsappSendBatches">) => {
    if (isLoadingLocalizedRows || !localizedRows) {
      toast.error(t("app.projects.toasts.localizedLoading"));
      return;
    }

    openEmailComposer(batchId, project?.customer?.email?.trim() ?? "");
  };

  const handleSendBatchEmail = async () => {
    if (!project || !composingBatchId || !composingBatch) {
      return;
    }

    const normalizedRecipientEmail = emailRecipient.trim();
    if (!normalizedRecipientEmail) {
      toast.error(t("app.projects.toasts.customerEmailRequired"));
      return;
    }

    setIsSendingBatchEmail(true);
    try {
      await sendTimelineBatchEmail({
        projectId: project._id,
        batchId: composingBatchId,
        recipientEmail: normalizedRecipientEmail,
        subject: emailSubject,
        body: emailBody,
        imageMediaAssetIds: selectedImageIds,
        videoMediaAssetIds: selectedVideoIds,
      });
      toast.success(t("app.projects.toasts.emailSent"));
      resetEmailComposer();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("app.projects.toasts.emailSendFailed"));
    } finally {
      setIsSendingBatchEmail(false);
    }
  };

  if (project === undefined || originalTimelineRows === undefined) {
    return (
      <>
        {headerRoot ? createPortal(<DetailHeaderActionsSkeleton />, headerRoot) : null}
        <ProjectDetailSkeleton />
      </>
    );
  }

  if (!project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("app.projects.detail.notFoundTitle")}</CardTitle>
          <CardDescription>{t("app.projects.detail.notFoundDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {headerRoot
        ? createPortal(
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditDialogOpen(true)}>
                <RiEditLine className="size-4" />
                {t("common.actions.edit")}
              </Button>
              <Button size="sm" onClick={() => void handleExportProject()} disabled={isExporting}>
                {isExporting ? <Spinner className="size-4" /> : <RiDownloadLine className="size-4" />}
                {t("common.actions.export")}
              </Button>
            </>,
            headerRoot,
          )
        : null}

      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("app.projects.detail.locationLabel")}
                </p>
                <p className="text-base font-medium leading-snug">
                  {project.location || t("app.projects.detail.noLocation")}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsEditDialogOpen(true)}>
                {t("common.actions.edit")}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-card px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("app.projects.detail.customerTitle")}
                </p>
                {project.customer ? (
                  <div className="space-y-1">
                    <p className="text-base font-medium leading-snug">{project.customer.name}</p>
                    {project.customer.contactName ? (
                      <p className="text-sm text-muted-foreground">{project.customer.contactName}</p>
                    ) : null}
                    {project.customer.email ? (
                      <p className="text-sm text-muted-foreground">{project.customer.email}</p>
                    ) : null}
                    {project.customer.phone ? (
                      <p className="text-sm text-muted-foreground">{project.customer.phone}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-base font-medium leading-snug text-muted-foreground">
                    {t("app.projects.detail.noCustomer")}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsCustomerDialogOpen(true)}>
                {project.customer
                  ? t("app.projects.detail.editCustomer")
                  : t("app.projects.detail.addCustomer")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleStatusToggle}>
            {project.status === "active"
              ? t("app.projects.card.markDone")
              : t("app.projects.card.reopen")}
          </Button>
        </div>
      </section>

      {isLoadingLocalizedRows && localizedRows === null && originalTimelineRows === undefined ? (
        <ProjectTimelineLoadingSkeleton />
      ) : timelineBatches.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("app.projects.detail.noTimelineTitle")}</p>
          <p className="mt-1">{t("app.projects.detail.noTimelineDescription")}</p>
        </div>
      ) : (
        <div className="space-y-7">
          {timelineBatches.map((batch) => (
            <section key={batch.batchId} className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {dateFormatter.format(batch.badgeDate)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <p className="text-lg font-semibold leading-tight sm:text-xl">{batch.title}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{batch.memberLabel}</span>
                  {" - "}
                  {batch.oneSentenceSummary}
                </p>
              </div>

              <Card>
                <CardContent className="space-y-4 pt-1">
                  <Tabs defaultValue="overview">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <TabsList>
                        <TabsTrigger value="overview">{t("app.projects.detail.overview")}</TabsTrigger>
                        <TabsTrigger value="messages">{t("app.projects.detail.messages")}</TabsTrigger>
                      </TabsList>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartBatchEmail(batch.batchId)}
                        >
                          <RiMailSendLine className="size-4" />
                          {t("app.projects.detail.sendEmail")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setMovingBatch(batch);
                            setTargetProjectId(String(activeProjectOptions[0]?._id ?? ""));
                            setProjectSearchQuery("");
                          }}
                        >
                          <RiFolderTransferLine className="size-4" />
                          {t("app.projects.detail.moveBatch")}
                        </Button>
                      </div>
                    </div>

                    <TabsContent value="overview" className="space-y-4 pt-4">
                      <OverviewMarkdown
                        content={batch.overview}
                        fallbackText={t("app.projects.detail.noDetailedOverviewAvailable")}
                      />

                      {batch.hasNachtrag ? (
                        <section className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
                          <p className="text-sm font-semibold text-red-800">
                            {t("common.misc.nachtrag")}
                          </p>
                          {batch.nachtragItems.length > 0 ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-red-900">
                              {batch.nachtragItems.map((item, index) => (
                                <li key={`${batch.batchId}:nachtrag:${index}`}>{item}</li>
                              ))}
                            </ul>
                          ) : null}
                          {batch.nachtragDetails ? (
                            <p className="text-sm leading-relaxed text-red-900">
                              {batch.nachtragDetails}
                            </p>
                          ) : null}
                          {batch.nachtragNeedsClarification ? (
                            <p className="text-sm font-medium text-red-700">
                              {t("app.projects.detail.nachtragNeedsClarification")}
                            </p>
                          ) : null}
                        </section>
                      ) : null}

                      {batch.overviewMedia.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {batch.overviewMedia.map((media) => (
                            <OverviewMediaCard
                              key={mediaKey(media)}
                              media={media}
                              onOpenImage={openImageDialog}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t("app.projects.detail.noImagesOrVideos")}
                        </p>
                      )}
                    </TabsContent>

                    <TabsContent value="messages" className="space-y-4 pt-4">
                      {batch.messages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {t("app.projects.detail.noOriginalMessages")}
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {batch.messages.map((message) => {
                            const memberName = toDisplayName(message.addedByName, batch.memberLabel);
                            const messageKey = String(message._id);
                            const originalMessage = originalMessageByTimelineItemId.get(messageKey);
                            const translatedMessageText =
                              message.text?.trim() || message.sourceText?.trim() || undefined;
                            const originalMessageText =
                              originalMessage?.sourceText?.trim() ||
                              originalMessage?.text?.trim() ||
                              message.sourceText?.trim() ||
                              message.text?.trim();
                            const hasTranslatedVariant = Boolean(
                              translatedMessageText &&
                                originalMessageText &&
                                translatedMessageText !== originalMessageText,
                            );
                            const selectedLanguageView =
                              messageLanguageById[messageKey] ?? "translation";
                            const messageTextToRender =
                              hasTranslatedVariant && selectedLanguageView === "original"
                                ? originalMessageText
                                : translatedMessageText || originalMessageText;
                            const timestampLabel = dateFormatter.format(message.addedAt);

                            return (
                              <div key={message._id} className="flex justify-end">
                                <div className="flex w-full max-w-2xl items-end justify-end gap-2">
                                  <div className="w-full max-w-xl space-y-2">
                                    {messageTextToRender ? (
                                      <div className="ml-auto max-w-xl origin-right rotate-[0.3deg] rounded-2xl rounded-br-sm bg-muted/60 px-3 py-2">
                                        <div className="flex items-start justify-between gap-2">
                                          <p className="text-sm font-medium">{memberName}</p>
                                          {hasTranslatedVariant ? (
                                            <NativeSelect
                                              size="sm"
                                              value={selectedLanguageView}
                                              onChange={(event) => {
                                                const value = event.currentTarget.value;
                                                if (!(value === "translation" || value === "original")) {
                                                  return;
                                                }

                                                setMessageLanguageById((current) => ({
                                                  ...current,
                                                  [messageKey]: value,
                                                }));
                                              }}
                                              className="w-32 shrink-0 [&_[data-slot=native-select]]:h-6 [&_[data-slot=native-select]]:pr-7 [&_[data-slot=native-select]]:text-xs [&_[data-slot=native-select]]:text-muted-foreground [&_[data-slot=native-select-icon]]:size-3.5 [&_[data-slot=native-select-icon]]:text-muted-foreground"
                                            >
                                              <NativeSelectOption value="translation">
                                                {t("app.projects.detail.usersLanguage")}
                                              </NativeSelectOption>
                                              <NativeSelectOption value="original">
                                                {t("app.projects.detail.originalLanguage")}
                                              </NativeSelectOption>
                                            </NativeSelect>
                                          ) : null}
                                        </div>
                                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                                          {messageTextToRender}
                                        </p>
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                          <span className="text-xs text-muted-foreground">
                                            {timestampLabel}
                                          </span>
                                        </div>
                                      </div>
                                    ) : null}

                                    {message.media.length > 0 ? (
                                      <div className="ml-auto flex max-w-xl flex-col gap-2">
                                        {message.media.map((media) => (
                                          <MessageMediaBubble
                                            key={mediaKey(media)}
                                            media={media}
                                            memberName={memberName}
                                            timestampLabel={timestampLabel}
                                            focalTranscript={message.transcript}
                                            originalTranscript={originalTranscriptByMediaAssetId.get(
                                              String(media.mediaAssetId),
                                            )}
                                            onOpenImage={openImageDialog}
                                            onOpenMediaContent={setMediaDialogMedia}
                                          />
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>

                                  <Avatar size="lg">
                                    <AvatarFallback>{initialsFromName(memberName)}</AvatarFallback>
                                  </Avatar>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.detailEditTitle")}</DialogTitle>
            <DialogDescription>{t("app.projects.dialogs.detailEditDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveProject} className="space-y-4">
            <ProjectFormFields
              idPrefix="project-detail"
              location={editProjectLocation}
              customerId={projectCustomerId}
              customers={customers}
              onLocationChange={setEditProjectLocation}
              onCustomerIdChange={setProjectCustomerId}
              disabled={isSavingProject}
            />
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false);
                  setIsArchiveDialogOpen(true);
                }}
                disabled={isSavingProject}
              >
                {t("common.actions.archive")}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditDialogOpen(false)}
                  disabled={isSavingProject}
                >
                  {t("common.actions.cancel")}
                </Button>
                <Button type="submit" disabled={isSavingProject}>
                  {t("common.actions.save")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isArchiveDialogOpen} onOpenChange={setIsArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("app.projects.dialogs.archiveDescriptionNamed", {
                location: project.location,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsArchiveDialogOpen(false)}
              disabled={isArchivingProject}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleArchiveProject}
              disabled={isArchivingProject}
            >
              {t("common.actions.archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={movingBatch !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMovingBatch(null);
            setTargetProjectId("");
            setProjectSearchQuery("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.moveBatchTitle")}</DialogTitle>
            <DialogDescription>{t("app.projects.dialogs.moveBatchDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={projectSearchQuery}
                onChange={(event) => setProjectSearchQuery(event.target.value)}
                placeholder={t("app.projects.detail.searchTargetProjectPlaceholder")}
                className="pl-9"
              />
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2">
              {activeProjectOptions.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {t("app.projects.detail.noOtherProjects")}
                </p>
              ) : filteredProjectOptions.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {t("app.projects.detail.noSearchMatches")}
                </p>
              ) : null}

              {filteredProjectOptions.map((candidate) => {
                const isSelected = targetProjectId === String(candidate._id);

                return (
                  <button
                    key={candidate._id}
                    type="button"
                    onClick={() => setTargetProjectId(String(candidate._id))}
                    className={[
                      "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:bg-muted/30",
                    ].join(" ")}
                  >
                    <span>{candidate.location}</span>
                    {isSelected ? <RiArrowRightSLine className="size-4" /> : null}
                  </button>
                );
              })}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMovingBatch(null);
                  setTargetProjectId("");
                  setProjectSearchQuery("");
                }}
                disabled={isReassigning}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="button" onClick={handleReassignBatch} disabled={!targetProjectId || isReassigning}>
                {isReassigning ? <Spinner className="size-4" /> : null}
                {t("app.projects.detail.moveBatch")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(imageDialogMedia)}
        onOpenChange={(open) => {
          if (!open) {
            setImageDialogMedia(null);
            resetImageViewer();
          }
        }}
      >
        <DialogContent className="h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none gap-3 overflow-hidden p-4 sm:max-w-none">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <DialogHeader className="shrink-0 pr-10">
              <DialogTitle>{t("app.projects.dialogs.imagePreviewTitle")}</DialogTitle>
              <DialogDescription>
                {t("app.projects.detail.imagePreviewDescription")}
              </DialogDescription>
            </DialogHeader>

            {imageDialogMedia?.url ? (
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {previewImages.length > 1 ? (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute left-2 top-1/2 z-10 -translate-y-1/2"
                      onClick={handlePreviousPreviewImage}
                    >
                      <RiArrowLeftSLine className="size-5" />
                      <span className="sr-only">{t("common.actions.previous")}</span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
                      onClick={handleNextPreviewImage}
                    >
                      <RiArrowRightSLine className="size-5" />
                      <span className="sr-only">{t("common.actions.next")}</span>
                    </Button>
                  </>
                ) : null}

                <img
                  src={imageDialogMedia.url}
                  alt={imageDialogMedia.summary || t("app.projects.detail.projectImageAlt")}
                  loading="lazy"
                  onClick={handleImageClick}
                  className={`absolute inset-0 h-full w-full object-contain transition-transform duration-150 ease-out ${
                    Math.abs(imageZoom - IMAGE_CLICK_ZOOM) < 0.01
                      ? "cursor-zoom-out"
                      : "cursor-zoom-in"
                  }`}
                  style={{
                    transform: `scale(${imageZoom})`,
                    transformOrigin: imageTransformOrigin,
                  }}
                />
              </div>
            ) : null}

            <DialogFooter className="shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setImageDialogMedia(null);
                  resetImageViewer();
                }}
              >
                {t("common.actions.close")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(mediaDialogMedia)}
        onOpenChange={(open) => {
          if (!open) {
            setMediaDialogMedia(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {mediaDialogMedia?.kind === "audio"
                ? t("app.projects.detail.hearVoiceMessage")
                : t("app.projects.detail.showVideo")}
            </DialogTitle>
          </DialogHeader>
          {mediaDialogMedia?.kind === "audio" && mediaDialogMedia.url ? (
            <audio controls preload="metadata" className="w-full" src={mediaDialogMedia.url} />
          ) : null}
          {mediaDialogMedia?.kind === "video" && mediaDialogMedia.url ? (
            <video controls preload="metadata" className="w-full rounded-lg border" src={mediaDialogMedia.url}>
              <track
                default
                kind="captions"
                label="Placeholder captions"
                src={EMPTY_CAPTION_TRACK}
                srcLang="en"
              />
            </video>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={composingBatch !== null}
        onOpenChange={(open) => {
          if (!open) {
            resetEmailComposer();
          }
        }}
      >
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1400px] sm:max-w-[1400px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("app.projects.dialogs.emailPreviewTitle")}</DialogTitle>
            <DialogDescription>{t("app.projects.dialogs.emailPreviewDescription")}</DialogDescription>
          </DialogHeader>
          {composingBatch ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="timeline-email-recipient">{t("app.projects.detail.toLabel")}</Label>
                  <Input
                    id="timeline-email-recipient"
                    type="email"
                    value={emailRecipient}
                    onChange={(event) => setEmailRecipient(event.target.value)}
                    disabled={isSendingBatchEmail}
                    placeholder={t("app.projects.detail.customerEmailPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timeline-email-subject">{t("app.projects.detail.subjectLabel")}</Label>
                  <Input
                    id="timeline-email-subject"
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                    disabled={isSendingBatchEmail}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeline-email-body">{t("app.projects.detail.emailTextLabel")}</Label>
                <Textarea
                  id="timeline-email-body"
                  value={emailBody}
                  onChange={(event) => setEmailBody(event.target.value)}
                  disabled={isSendingBatchEmail}
                  className="min-h-48"
                />
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t("app.projects.detail.imageAttachmentsTitle")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("app.projects.detail.imageAttachmentsDescription")}
                    </p>
                  </div>
                  {selectedImages.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                      {selectedImages.map((media) => (
                        <div
                          key={mediaKey(media)}
                          className="overflow-hidden rounded-lg border bg-muted/20"
                        >
                          <div className="relative">
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="absolute right-1.5 top-1.5 z-10 size-7 rounded-full shadow-sm"
                              onClick={() =>
                                setSelectedImageIds((current) =>
                                  current.filter((mediaAssetId) => mediaAssetId !== media.mediaAssetId),
                                )
                              }
                              disabled={isSendingBatchEmail}
                            >
                              <RiCloseLine className="size-4" />
                              <span className="sr-only">{t("common.actions.remove")}</span>
                            </Button>
                            {media.url ? (
                              <button
                                type="button"
                                className="block aspect-[4/3] w-full overflow-hidden bg-muted"
                                onClick={() => openImageDialog(media)}
                              >
                                <img
                                  src={media.url}
                                  alt={media.summary || t("app.projects.detail.projectImageAlt")}
                                  className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
                                />
                              </button>
                            ) : (
                              <div className="flex aspect-[4/3] items-center justify-center px-3 text-center text-xs text-muted-foreground">
                                {t("app.projects.detail.mediaPreviewUnavailable")}
                              </div>
                            )}
                          </div>
                          {media.summary ? (
                            <p className="line-clamp-2 px-2 py-1.5 text-[11px] text-muted-foreground">
                              {media.summary}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      {t("app.projects.detail.noImageAttachments")}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t("app.projects.detail.videoLinksTitle")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("app.projects.detail.videoLinksDescription")}
                    </p>
                  </div>
                  {selectedVideos.length > 0 ? (
                    <div className="space-y-2">
                      {selectedVideos.map((media, index) => (
                        <div
                          key={mediaKey(media)}
                          className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium">
                              {t("app.projects.detail.videoLabel", { index: index + 1 })}
                            </p>
                            {media.summary ? (
                              <p className="line-clamp-2 text-sm text-muted-foreground">
                                {media.summary}
                              </p>
                            ) : null}
                            {media.url ? (
                              <a
                                href={media.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm underline"
                              >
                                {t("app.projects.detail.openCurrentVideoLink")}
                              </a>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedVideoIds((current) =>
                                current.filter((mediaAssetId) => mediaAssetId !== media.mediaAssetId),
                              )
                            }
                            disabled={isSendingBatchEmail}
                          >
                            {t("common.actions.remove")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      {t("app.projects.detail.noVideoLinks")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => resetEmailComposer()}
              disabled={isSendingBatchEmail}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSendBatchEmail()}
              disabled={
                isSendingBatchEmail ||
                emailRecipient.trim().length === 0 ||
                emailSubject.trim().length === 0 ||
                emailBody.trim().length === 0
              }
            >
              {isSendingBatchEmail ? (
                <Spinner className="size-4" />
              ) : (
                <RiMailSendLine className="size-4" />
              )}
              {t("app.projects.detail.sendEmail")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProjectCustomerDialog
        open={isCustomerDialogOpen}
        project={project}
        onOpenChange={setIsCustomerDialogOpen}
      />

    </div>
  );
}
