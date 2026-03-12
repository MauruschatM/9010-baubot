import type { Translator } from "@mvp-template/i18n";

export type ExportManifest = {
  generatedAt: number;
  roots: ExportRoot[];
};

type ExportRoot = {
  kind: "customer" | "project";
  name: string;
  projects: ExportProject[];
};

type ExportProject = {
  location: string;
  customerName?: string;
  status: "active" | "done";
  batches: ExportBatch[];
};

type ExportBatch = {
  batchId: string;
  timestamp: number;
  title: string;
  overview?: string;
  summary?: string;
  hasNachtrag: boolean;
  nachtragDetails?: string;
  nachtragItems: string[];
  messages: ExportMessage[];
  media: ExportMedia[];
};

type ExportMessage = {
  addedAt: number;
  addedByName?: string;
  sourceText?: string;
  transcript?: string;
  extractedText?: string;
  summary?: string;
};

type ExportMedia = {
  addedAt: number;
  sourceIndex: number;
  mimeType: string;
  kind: "image" | "audio" | "video" | "file";
  downloadUrl?: string;
  originalFileName?: string;
  summary?: string;
  transcript?: string;
  extractedText?: string;
};

const INVALID_PATH_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatFileDate(value: number) {
  const date = new Date(value);

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-");
}

function formatBatchTimestamp(value: number) {
  const date = new Date(value);

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-") + `_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}Z`;
}

function sanitizePathSegment(value: string | undefined, fallback: string) {
  const candidate = (value ?? "")
    .replace(INVALID_PATH_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const normalized = candidate.length > 0 ? candidate : fallback;

  if (normalized === "." || normalized === "..") {
    return fallback;
  }

  if (WINDOWS_RESERVED_NAMES.has(normalized.toUpperCase())) {
    return `${normalized}-item`;
  }

  return normalized;
}

function splitFileName(value: string) {
  const lastDot = value.lastIndexOf(".");

  if (lastDot <= 0 || lastDot === value.length - 1) {
    return {
      name: value,
      extension: "",
    };
  }

  return {
    name: value.slice(0, lastDot),
    extension: value.slice(lastDot),
  };
}

function ensureUniqueName(value: string, usedNames: Map<string, number>) {
  const { name, extension } = splitFileName(value);
  const normalizedKey = value.toLocaleLowerCase();
  const existingCount = usedNames.get(normalizedKey) ?? 0;

  if (existingCount === 0) {
    usedNames.set(normalizedKey, 1);
    return value;
  }

  let nextCount = existingCount + 1;
  let nextValue = `${name} (${nextCount})${extension}`;

  while (usedNames.has(nextValue.toLocaleLowerCase())) {
    nextCount += 1;
    nextValue = `${name} (${nextCount})${extension}`;
  }

  usedNames.set(normalizedKey, nextCount);
  usedNames.set(nextValue.toLocaleLowerCase(), 1);
  return nextValue;
}

function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();

  if (normalized === "image/jpeg") {
    return ".jpg";
  }

  if (normalized === "image/png") {
    return ".png";
  }

  if (normalized === "image/webp") {
    return ".webp";
  }

  if (normalized === "image/gif") {
    return ".gif";
  }

  if (normalized === "video/mp4") {
    return ".mp4";
  }

  if (normalized === "video/quicktime") {
    return ".mov";
  }

  if (normalized === "audio/mpeg") {
    return ".mp3";
  }

  if (normalized === "audio/ogg") {
    return ".ogg";
  }

  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return ".wav";
  }

  if (normalized === "audio/mp4") {
    return ".m4a";
  }

  if (normalized === "application/pdf") {
    return ".pdf";
  }

  if (normalized === "text/plain") {
    return ".txt";
  }

  if (!normalized.includes("/")) {
    return "";
  }

  const subtype = normalized.split("/")[1]?.split(";")[0]?.trim();
  return subtype ? `.${subtype.replace(/[^a-z0-9]+/gi, "")}` : "";
}

function buildRootFolderName(root: ExportRoot) {
  return sanitizePathSegment(root.name, root.kind === "customer" ? "customer" : "project");
}

function buildProjectFolderName(project: ExportProject) {
  return sanitizePathSegment(project.location, "project");
}

function buildBatchFolderName(batch: ExportBatch) {
  const title = sanitizePathSegment(batch.title, "project-update").toLowerCase().replace(/\s+/g, "-");
  const shortBatchId = batch.batchId.slice(-6);

  return `${formatBatchTimestamp(batch.timestamp)}_${title}_${shortBatchId}`;
}

function buildMediaFileName(media: ExportMedia, mediaIndex: number) {
  const preferredName = sanitizePathSegment(media.originalFileName, "");
  if (preferredName) {
    return preferredName;
  }

  const extension = extensionFromMimeType(media.mimeType);
  return `${String(mediaIndex + 1).padStart(2, "0")}-${media.kind}${extension}`;
}

function buildSummaryText(
  root: ExportRoot,
  project: ExportProject,
  batch: ExportBatch,
  t: Translator,
) {
  const lines: string[] = [
    t("app.export.labels.exported", { date: new Date().toISOString() }),
    t("app.export.labels.rootType", { kind: root.kind }),
    t("app.export.labels.location", { location: project.location }),
    t("app.export.labels.status", {
      status: project.status === "active" ? t("common.misc.active") : t("common.misc.done"),
    }),
    t("app.export.labels.batchTimestamp", { date: new Date(batch.timestamp).toISOString() }),
    t("app.export.labels.batchTitle", { title: batch.title }),
  ];

  if (root.kind === "customer") {
    lines.push(t("app.export.labels.customer", { name: root.name }));
  } else if (project.customerName) {
    lines.push(t("app.export.labels.customer", { name: project.customerName }));
  }

  lines.push("");

  if (batch.overview) {
    lines.push(t("app.export.labels.overview"));
    lines.push(batch.overview);
    lines.push("");
  }

  if (batch.summary) {
    lines.push(t("app.export.labels.summary"));
    lines.push(batch.summary);
    lines.push("");
  }

  if (batch.hasNachtrag || batch.nachtragDetails || batch.nachtragItems.length > 0) {
    lines.push(t("app.export.labels.nachtrag"));

    if (batch.nachtragDetails) {
      lines.push(batch.nachtragDetails);
    }

    for (const item of batch.nachtragItems) {
      lines.push(`- ${item}`);
    }

    lines.push("");
  }

  lines.push(t("app.export.labels.messages"));

  if (batch.messages.length === 0) {
    lines.push(t("app.export.empty.noMessages"));
  } else {
    batch.messages.forEach((message, index) => {
      lines.push(
        `${index + 1}. [${new Date(message.addedAt).toISOString()}] ${
          message.addedByName ?? t("app.export.labels.unknownMember")
        }`,
      );

      if (message.sourceText) {
        lines.push(t("app.export.labels.text", { text: message.sourceText }));
      }

      if (message.summary) {
        lines.push(`${t("app.export.labels.summary")} ${message.summary}`);
      }

      if (message.transcript) {
        lines.push(t("app.export.labels.transcript", { text: message.transcript }));
      }

      if (message.extractedText) {
        lines.push(
          t("app.export.labels.extractedText", { text: message.extractedText }),
        );
      }

      lines.push("");
    });
  }

  lines.push(t("app.export.labels.media"));

  if (batch.media.length === 0) {
    lines.push(t("app.export.empty.noMedia"));
  } else {
    batch.media.forEach((media, index) => {
      const fileName = buildMediaFileName(media, index);
      lines.push(
        `${index + 1}. ${fileName} (${media.kind}, ${media.mimeType})${
          media.downloadUrl ? "" : ` ${t("app.export.mediaUnavailable")}`
        }`,
      );

      if (media.summary) {
        lines.push(`${t("app.export.labels.summary")} ${media.summary}`);
      }

      if (media.transcript) {
        lines.push(t("app.export.labels.transcript", { text: media.transcript }));
      }

      if (media.extractedText) {
        lines.push(
          t("app.export.labels.extractedText", { text: media.extractedText }),
        );
      }

      lines.push("");
    });
  }

  return `${lines.join("\n").trim()}\n`;
}

async function fetchMediaBlob(downloadUrl: string, t: Translator) {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(t("app.export.errors.downloadFailed", { status: response.status }));
  }

  return await response.blob();
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

async function appendProjectToZip(
  folder: {
    folder: (name: string) => { folder: (name: string) => any; file: (name: string, data: Blob | string) => any } | null;
    file: (name: string, data: Blob | string) => any;
  },
  root: ExportRoot,
  project: ExportProject,
  usedProjectNames: Map<string, number>,
  t: Translator,
) {
  const projectFolder = folder.folder(
    ensureUniqueName(buildProjectFolderName(project), usedProjectNames),
  );
  if (!projectFolder) {
    return;
  }

  const usedBatchNames = new Map<string, number>();

  for (const batch of project.batches) {
    const batchFolder = projectFolder.folder(
      ensureUniqueName(buildBatchFolderName(batch), usedBatchNames),
    );

    if (!batchFolder) {
      continue;
    }

    batchFolder.file(t("app.export.summaryFileName"), buildSummaryText(root, project, batch, t));

    const usedMediaNames = new Map<string, number>();
    const sortedMedia = [...batch.media].sort((left, right) => {
      if (left.addedAt !== right.addedAt) {
        return left.addedAt - right.addedAt;
      }

      return left.sourceIndex - right.sourceIndex;
    });

    for (const [index, media] of sortedMedia.entries()) {
      if (!media.downloadUrl) {
        continue;
      }

      const fileName = ensureUniqueName(buildMediaFileName(media, index), usedMediaNames);
      const blob = await fetchMediaBlob(media.downloadUrl, t);
      batchFolder.file(fileName, blob);
    }
  }
}

export async function downloadExportZip(
  manifest: ExportManifest,
  mode: "customers" | "projects",
  t: Translator,
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const usedRootNames = new Map<string, number>();
  const usedTopLevelProjectNames = new Map<string, number>();

  for (const root of manifest.roots) {
    if (root.kind === "project") {
      for (const project of root.projects) {
        await appendProjectToZip(zip, root, project, usedTopLevelProjectNames, t);
      }
      continue;
    }

    const rootFolder = zip.folder(ensureUniqueName(buildRootFolderName(root), usedRootNames));
    if (!rootFolder) {
      continue;
    }

    const usedProjectNames = new Map<string, number>();

    for (const project of root.projects) {
      await appendProjectToZip(rootFolder, root, project, usedProjectNames, t);
    }
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: {
      level: 6,
    },
  });

  triggerBlobDownload(blob, `${mode}-export-${formatFileDate(manifest.generatedAt)}.zip`);
}
