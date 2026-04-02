"use node";

import { createHash } from "node:crypto";
import { ConvexError, v } from "convex/values";

import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { requireActiveOrganization, requireAuthUserId } from "./authhelpers";
import { isPhoneOnlyMemberEmail } from "./memberProfiles";
import {
  type ResendEmailAttachment,
  sendProjectTimelineUpdateEmail,
} from "./lib/resend";

const MAX_TIMELINE_ITEMS = 500;
const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

type AuthUserDoc = {
  _id: string;
  name?: string | null;
  email?: string | null;
};

type ProjectEmailTimelineRow = {
  batchId: Id<"whatsappSendBatches">;
  sourceType: "whatsapp_message" | "whatsapp_batch_summary";
  batchTitle?: string;
  media: Array<{
    mediaAssetId: Id<"whatsappMediaAssets">;
    kind: "image" | "audio" | "video" | "file";
    url?: string;
    summary?: string;
  }>;
};

function normalizeSubject(value: string) {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new ConvexError("Email subject is required");
  }

  return normalized;
}

function normalizeBody(value: string) {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new ConvexError("Email text is required");
  }

  return normalized;
}

function dedupeIds<T extends string>(ids: T[]) {
  return Array.from(new Set(ids));
}

function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();

  if (normalized.includes("jpeg")) {
    return "jpg";
  }

  if (normalized.includes("png")) {
    return "png";
  }

  if (normalized.includes("gif")) {
    return "gif";
  }

  if (normalized.includes("webp")) {
    return "webp";
  }

  const segments = normalized.split("/");
  return segments[1]?.split(";")[0]?.trim() || "bin";
}

function sanitizeFilenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project-update";
}

function buildAttachmentFilename(options: {
  batchTitle: string;
  index: number;
  mimeType: string;
}) {
  const extension = extensionFromMimeType(options.mimeType);
  const base = sanitizeFilenamePart(options.batchTitle);
  return `${base}-image-${options.index + 1}.${extension}`;
}

function buildVideoLabel(options: {
  batchTitle: string;
  mediaSummary?: string;
  index: number;
}) {
  const summary = options.mediaSummary?.trim();

  if (!summary) {
    return `${options.batchTitle} video ${options.index + 1}`;
  }

  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
}

function ensureBatchRowsExist<T extends {
  batchId: Id<"whatsappSendBatches">;
}>(
  rows: T[],
  batchId: Id<"whatsappSendBatches">,
) {
  const batchRows = rows.filter((row): row is T => row.batchId === batchId);

  if (batchRows.length === 0) {
    throw new ConvexError("Timeline batch not found");
  }

  return batchRows;
}

export const sendTimelineBatchEmail = action({
  args: {
    projectId: v.id("projects"),
    batchId: v.id("whatsappSendBatches"),
    recipientEmail: v.string(),
    subject: v.string(),
    body: v.string(),
    imageMediaAssetIds: v.array(v.id("whatsappMediaAssets")),
    videoMediaAssetIds: v.array(v.id("whatsappMediaAssets")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [organization, authUserId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);

    const subject = normalizeSubject(args.subject);
    const body = normalizeBody(args.body);
    const uniqueImageIds = dedupeIds(args.imageMediaAssetIds.map((mediaAssetId) => String(mediaAssetId)));
    const uniqueVideoIds = dedupeIds(args.videoMediaAssetIds.map((mediaAssetId) => String(mediaAssetId)));
    const [project, timelineRows, currentUser] = await Promise.all([
      ctx.runQuery(api.projects.getById, { projectId: args.projectId }),
      ctx.runQuery(api.projects.timeline, {
        projectId: args.projectId,
        limit: MAX_TIMELINE_ITEMS,
      }) as Promise<ProjectEmailTimelineRow[]>,
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [
          {
            field: "_id",
            operator: "eq",
            value: authUserId,
          },
        ],
      }),
    ]);

    if (!project) {
      throw new ConvexError("Project not found");
    }

    const recipientEmail = args.recipientEmail.trim();
    if (!recipientEmail) {
      throw new ConvexError("A recipient email address is required");
    }

    const sender = currentUser as AuthUserDoc | null;
    const senderEmail = sender?.email?.trim();

    if (!senderEmail || isPhoneOnlyMemberEmail(senderEmail)) {
      throw new ConvexError("Your account needs a real email address before sending customer emails");
    }

    const senderName = sender?.name?.trim() || senderEmail;
    const batchRows = ensureBatchRowsExist(timelineRows, args.batchId);
    const batchTitle =
      batchRows
        .find((row) => row.sourceType === "whatsapp_batch_summary")
        ?.batchTitle?.trim() || "Project update";
    const mediaById = new Map<string, (typeof batchRows)[number]["media"][number]>();

    for (const row of batchRows) {
      for (const media of row.media) {
        mediaById.set(String(media.mediaAssetId), media);
      }
    }

    const selectedVideoLinks = uniqueVideoIds.map((mediaAssetId, index) => {
      const media = mediaById.get(mediaAssetId);

      if (!media || media.kind !== "video") {
        throw new ConvexError("One of the selected videos is no longer available");
      }

      if (!media.url) {
        throw new ConvexError("A selected video link is unavailable");
      }

      return {
        label: buildVideoLabel({
          batchTitle,
          mediaSummary: media.summary,
          index,
        }),
        url: media.url,
      };
    });

    const selectedImages = uniqueImageIds.length
      ? await ctx.runQuery(internal.projectEmailsData.getBatchImageAttachments, {
          organizationId: organization.id,
          projectId: args.projectId,
          batchId: args.batchId,
          mediaAssetIds: uniqueImageIds as Id<"whatsappMediaAssets">[],
        })
      : [];

    let totalAttachmentBytes = 0;
    const attachments: ResendEmailAttachment[] = [];

    for (const [index, image] of selectedImages.entries()) {
      const blob = await ctx.storage.get(image.storageId);

      if (!blob) {
        throw new ConvexError("A selected image is no longer available");
      }

      const base64Content = Buffer.from(await blob.arrayBuffer()).toString("base64");
      totalAttachmentBytes += Buffer.byteLength(base64Content, "utf8");

      if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) {
        throw new ConvexError(
          "Selected images are too large to send by email. Remove some images and try again.",
        );
      }

      attachments.push({
        content: base64Content,
        filename: buildAttachmentFilename({
          batchTitle,
          index,
          mimeType: image.mimeType,
        }),
        contentType: image.mimeType,
      });
    }

    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          projectId: args.projectId,
          batchId: args.batchId,
          senderUserId: authUserId,
          senderEmail,
          recipientEmail,
          subject,
          body,
          imageIds: uniqueImageIds,
          videoIds: uniqueVideoIds,
        }),
      )
      .digest("hex")
      .slice(0, 24);

    await sendProjectTimelineUpdateEmail({
      email: recipientEmail,
      subject,
      bodyText: body,
      videoLinks: selectedVideoLinks,
      attachments,
      idempotencyKey: `project-timeline-email/${String(args.projectId)}/${String(args.batchId)}/${payloadHash}`,
      throwOnMissingConfig: true,
      replyToEmail: senderEmail,
      senderName,
    });

    return null;
  },
});
