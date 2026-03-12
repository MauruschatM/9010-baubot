import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

export const PENDING_ACTION_TYPES = [
  "archive-customer",
  "archive-project",
  "cancel-invitation",
  "delete-organization",
  "leave-organization",
  "remove-member",
  "remove-member-whatsapp-connection",
  "send-member-whatsapp-guide-email",
  "send-project-batch-email",
  "send-proactive-whatsapp-message",
] as const;

export type PendingActionType = (typeof PENDING_ACTION_TYPES)[number];

export const vPendingActionType = v.union(
  v.literal("archive-customer"),
  v.literal("archive-project"),
  v.literal("cancel-invitation"),
  v.literal("delete-organization"),
  v.literal("leave-organization"),
  v.literal("remove-member"),
  v.literal("remove-member-whatsapp-connection"),
  v.literal("send-member-whatsapp-guide-email"),
  v.literal("send-project-batch-email"),
  v.literal("send-proactive-whatsapp-message"),
);

export const vPendingActionStatus = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("canceled"),
  v.literal("expired"),
);

export const vPendingActionPayload = v.object({
  title: v.string(),
  description: v.string(),
  confirmLabel: v.string(),
  cancelLabel: v.string(),
  confirmedMessage: v.string(),
  canceledMessage: v.string(),
  expiredMessage: v.string(),
  missingMessage: v.string(),
  organizationId: v.optional(v.string()),
  organizationName: v.optional(v.string()),
  customerId: v.optional(v.id("customers")),
  customerName: v.optional(v.string()),
  projectId: v.optional(v.id("projects")),
  projectLabel: v.optional(v.string()),
  batchId: v.optional(v.id("whatsappSendBatches")),
  memberId: v.optional(v.string()),
  memberName: v.optional(v.string()),
  memberIdOrEmail: v.optional(v.string()),
  memberType: v.optional(v.union(v.literal("standard"), v.literal("phone_only"))),
  invitationId: v.optional(v.string()),
  recipientEmail: v.optional(v.string()),
  recipientMemberIds: v.optional(v.array(v.string())),
  message: v.optional(v.string()),
  subject: v.optional(v.string()),
  body: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  imageMediaAssetIds: v.optional(v.array(v.id("whatsappMediaAssets"))),
  videoMediaAssetIds: v.optional(v.array(v.id("whatsappMediaAssets"))),
});

export type PendingActionPayload = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmedMessage: string;
  canceledMessage: string;
  expiredMessage: string;
  missingMessage: string;
  organizationId?: string;
  organizationName?: string;
  customerId?: Id<"customers">;
  customerName?: string;
  projectId?: Id<"projects">;
  projectLabel?: string;
  batchId?: Id<"whatsappSendBatches">;
  memberId?: string;
  memberName?: string;
  memberIdOrEmail?: string;
  memberType?: "standard" | "phone_only";
  invitationId?: string;
  recipientEmail?: string;
  recipientMemberIds?: string[];
  message?: string;
  subject?: string;
  body?: string;
  phoneNumber?: string;
  imageMediaAssetIds?: Id<"whatsappMediaAssets">[];
  videoMediaAssetIds?: Id<"whatsappMediaAssets">[];
};

export function createPendingActionToolResult(options: {
  actionType: PendingActionType;
  pendingActionId: string;
  expiresAt: number;
}) {
  return {
    status: "requires_confirmation" as const,
    actionType: options.actionType,
    pendingActionId: options.pendingActionId,
    expiresAt: options.expiresAt,
  };
}
