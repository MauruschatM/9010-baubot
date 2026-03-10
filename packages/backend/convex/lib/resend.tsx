import { render } from "@react-email/render";
import { createTranslator, type AppLocale } from "@mvp-template/i18n";
import * as React from "react";
import { Resend } from "resend";

import { OrganizationInvitationEmail } from "../emails/organizationInvitationEmail";
import { PasswordResetEmail } from "../emails/passwordResetEmail";

const resendApiKey = process.env.RESEND_API_KEY;
const resendFromEmail = process.env.RESEND_FROM_EMAIL;
const resendReplyTo = process.env.RESEND_REPLY_TO;

let resendClient: Resend | null = null;

export type ResendEmailAttachment = {
  content: string;
  filename: string;
  contentType?: string;
};

function getResendClient() {
  if (!resendApiKey || !resendFromEmail) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(resendApiKey);
  }

  return resendClient;
}

function sanitizeDisplayName(value: string | null | undefined) {
  const normalized = value?.replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function extractAddress(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const bracketMatch = trimmed.match(/<([^>]+)>/);
  return (bracketMatch?.[1] ?? trimmed).trim() || null;
}

function buildFromAddress(displayName?: string) {
  if (!resendFromEmail) {
    return null;
  }

  const address = extractAddress(resendFromEmail);
  if (!address) {
    return resendFromEmail;
  }

  const senderName = sanitizeDisplayName(displayName);
  return senderName ? `${senderName} <${address}>` : resendFromEmail;
}

function resolveReplyTo(replyTo?: string[]) {
  if (replyTo && replyTo.length > 0) {
    return replyTo;
  }

  return resendReplyTo ? [resendReplyTo] : undefined;
}

async function sendEmail({
  to,
  subject,
  react,
  idempotencyKey,
  attachments,
  throwOnMissingConfig,
  fromDisplayName,
  replyTo,
}: {
  to: string;
  subject: string;
  react: React.ReactElement;
  idempotencyKey: string;
  attachments?: ResendEmailAttachment[];
  throwOnMissingConfig?: boolean;
  fromDisplayName?: string;
  replyTo?: string[];
}) {
  const html = await render(react);
  await sendHtmlEmail({
    to,
    subject,
    html,
    idempotencyKey,
    attachments,
    throwOnMissingConfig,
    fromDisplayName,
    replyTo,
  });
}

async function sendHtmlEmail({
  to,
  subject,
  html,
  idempotencyKey,
  attachments,
  throwOnMissingConfig,
  fromDisplayName,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  attachments?: ResendEmailAttachment[];
  throwOnMissingConfig?: boolean;
  fromDisplayName?: string;
  replyTo?: string[];
}) {
  const client = getResendClient();

  if (!client) {
    if (throwOnMissingConfig) {
      throw new Error(
        "Email sending is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
      );
    }

    console.warn(
      "Skipping email send because RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
    );
    return;
  }

  const from = buildFromAddress(fromDisplayName);
  if (!from) {
    throw new Error("Email sending is not configured. Set RESEND_FROM_EMAIL.");
  }

  const { error } = await client.emails.send(
    {
      from,
      to: [to],
      subject,
      html,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(resolveReplyTo(replyTo) ? { replyTo: resolveReplyTo(replyTo) } : {}),
    },
    {
      idempotencyKey,
    },
  );

  if (error) {
    throw new Error(`Resend failed: ${error.message}`);
  }
}

async function sendTextEmail({
  to,
  subject,
  text,
  idempotencyKey,
  attachments,
  throwOnMissingConfig,
  fromDisplayName,
  replyTo,
}: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  attachments?: ResendEmailAttachment[];
  throwOnMissingConfig?: boolean;
  fromDisplayName?: string;
  replyTo?: string[];
}) {
  const client = getResendClient();

  if (!client) {
    if (throwOnMissingConfig) {
      throw new Error(
        "Email sending is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
      );
    }

    console.warn(
      "Skipping email send because RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
    );
    return;
  }

  const from = buildFromAddress(fromDisplayName);
  if (!from) {
    throw new Error("Email sending is not configured. Set RESEND_FROM_EMAIL.");
  }

  const resolvedReplyTo = resolveReplyTo(replyTo);
  const { error } = await client.emails.send(
    {
      from,
      to: [to],
      subject,
      text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {}),
    },
    {
      idempotencyKey,
    },
  );

  if (error) {
    throw new Error(`Resend failed: ${error.message}`);
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendPasswordResetEmail({
  email,
  resetUrl,
  appName,
  locale,
}: {
  email: string;
  resetUrl: string;
  appName: string;
  locale: AppLocale;
}) {
  const t = createTranslator(locale);

  await sendEmail({
    to: email,
    subject: t("emails.passwordReset.subject", { appName }),
    idempotencyKey: `password-reset/${email.toLowerCase()}/${resetUrl}`,
    react: (
      <PasswordResetEmail
        resetUrl={resetUrl}
        preview={t("emails.passwordReset.preview", { appName })}
        headingText={t("emails.passwordReset.heading")}
        bodyText={t("emails.passwordReset.body", { appName })}
        resetCta={t("emails.passwordReset.resetCta")}
        fallbackHint={t("emails.passwordReset.fallbackHint")}
      />
    ),
  });
}

export async function sendOrganizationInvitationEmail({
  email,
  inviterName,
  organizationName,
  role,
  inviteUrl,
  invitationId,
  locale,
}: {
  email: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
  invitationId: string;
  locale: AppLocale;
}) {
  const t = createTranslator(locale);
  const normalizedRole = role.trim().toLowerCase();
  const localizedRole =
    normalizedRole === "owner" ||
    normalizedRole === "admin" ||
    normalizedRole === "member"
      ? t(`common.roles.${normalizedRole}`)
      : role;

  await sendEmail({
    to: email,
    subject: t("emails.invitation.subject", { organizationName }),
    idempotencyKey: `organization-invite/${invitationId}`,
    react: (
      <OrganizationInvitationEmail
        inviteUrl={inviteUrl}
        preview={t("emails.invitation.preview", { organizationName })}
        headingText={t("emails.invitation.heading")}
        bodyText={t("emails.invitation.body", {
          inviterName,
          organizationName,
          role: localizedRole,
        })}
        acceptCta={t("emails.invitation.acceptCta")}
        fallbackHint={t("emails.invitation.fallbackHint")}
      />
    ),
  });
}

export async function sendProjectTimelineUpdateEmail({
  email,
  subject,
  bodyText,
  videoLinks,
  attachments,
  idempotencyKey,
  throwOnMissingConfig,
  replyToEmail,
  senderName,
}: {
  email: string;
  subject: string;
  bodyText: string;
  videoLinks: Array<{
    label: string;
    url: string;
  }>;
  attachments?: ResendEmailAttachment[];
  idempotencyKey: string;
  throwOnMissingConfig?: boolean;
  replyToEmail: string;
  senderName?: string;
}) {
  const textSections = [bodyText.trim()];

  if (videoLinks.length > 0) {
    textSections.push(
      [
        "Video links:",
        ...videoLinks.map((videoLink) => `- ${videoLink.label}: ${videoLink.url}`),
      ].join("\n"),
    );
  }

  await sendTextEmail({
    to: email,
    subject,
    text: textSections.join("\n\n"),
    idempotencyKey,
    attachments,
    throwOnMissingConfig,
    fromDisplayName: senderName,
    replyTo: [replyToEmail],
  });
}

export async function sendWhatsappActivationGuideEmail({
  email,
  locale,
  organizationName,
  memberName,
  agentName,
  agentNumber,
  initialMessage,
  waLink,
  organizationId,
  memberId,
}: {
  email: string;
  locale: AppLocale;
  organizationName: string;
  memberName: string;
  agentName: string;
  agentNumber: string | null;
  initialMessage: string;
  waLink: string | null;
  organizationId: string;
  memberId: string;
}) {
  const t = createTranslator(locale);
  const preview = t("emails.whatsappGuide.preview", { organizationName });
  const subject = t("emails.whatsappGuide.subject", { organizationName });
  const heading = t("emails.whatsappGuide.heading");
  const intro = t("emails.whatsappGuide.intro", { memberName, agentName });
  const numberLabel = t("emails.whatsappGuide.numberLabel");
  const messageLabel = t("emails.whatsappGuide.messageLabel");
  const stepTitle = t("emails.whatsappGuide.stepTitle");
  const stepOne = t("emails.whatsappGuide.stepOne");
  const stepTwo = t("emails.whatsappGuide.stepTwo");
  const stepThree = t("emails.whatsappGuide.stepThree");
  const openButtonLabel = t("emails.whatsappGuide.openButtonLabel");
  const fallbackHint = t("emails.whatsappGuide.fallbackHint");
  const previewSafe = escapeHtml(preview);
  const headingSafe = escapeHtml(heading);
  const introSafe = escapeHtml(intro);
  const numberLabelSafe = escapeHtml(numberLabel);
  const messageLabelSafe = escapeHtml(messageLabel);
  const stepTitleSafe = escapeHtml(stepTitle);
  const stepOneSafe = escapeHtml(stepOne);
  const stepTwoSafe = escapeHtml(stepTwo);
  const stepThreeSafe = escapeHtml(stepThree);
  const agentNumberSafe = escapeHtml(agentNumber ?? "-");
  const initialMessageSafe = escapeHtml(initialMessage);
  const openButtonLabelSafe = escapeHtml(openButtonLabel);
  const fallbackHintSafe = escapeHtml(fallbackHint);
  const waLinkSafe = waLink ? escapeHtml(waLink) : null;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${headingSafe}</title>
  </head>
  <body style="background-color:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px;">
    <span style="display:none;overflow:hidden;">${previewSafe}</span>
    <div style="background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin:0 auto;max-width:520px;padding:24px;">
      <h1 style="color:#0f172a;font-size:20px;margin:0 0 12px;">${headingSafe}</h1>
      <p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 16px;">${introSafe}</p>
      <p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 6px;"><strong>${numberLabelSafe}:</strong> ${agentNumberSafe}</p>
      <p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 16px;"><strong>${messageLabelSafe}:</strong> ${initialMessageSafe}</p>
      <p style="color:#0f172a;font-size:14px;font-weight:600;margin:0 0 6px;">${stepTitleSafe}</p>
      <p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 4px;">${stepOneSafe}</p>
      <p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 4px;">${stepTwoSafe}</p>
      <p style="color:#334155;font-size:14px;line-height:1.5;margin:0 0 16px;">${stepThreeSafe}</p>
      ${
        waLinkSafe
          ? `<a href="${waLinkSafe}" style="background-color:#0f172a;border-radius:8px;color:#ffffff;display:inline-block;font-size:14px;padding:10px 16px;text-decoration:none;">${openButtonLabelSafe}</a>
      <p style="color:#64748b;font-size:12px;margin:16px 0 6px;">${fallbackHintSafe}</p>
      <p style="color:#0f172a;font-size:12px;margin:0;word-break:break-all;">${waLinkSafe}</p>`
          : ""
      }
    </div>
  </body>
</html>`;

  await sendHtmlEmail({
    to: email,
    subject,
    html,
    idempotencyKey: `whatsapp-guide/${organizationId}/${memberId}/${Date.now()}`,
  });
}
