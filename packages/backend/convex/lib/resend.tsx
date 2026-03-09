import { render } from "@react-email/render";
import { createTranslator, type AppLocale } from "@mvp-template/i18n";
import * as React from "react";
import { Resend } from "resend";

import { OrganizationInvitationEmail } from "../emails/organizationInvitationEmail";
import { OtpEmail } from "../emails/otpEmail";

type OtpType = "sign-in" | "email-verification" | "forget-password";

const resendApiKey = process.env.RESEND_API_KEY;
const resendFromEmail = process.env.RESEND_FROM_EMAIL;
const resendReplyTo = process.env.RESEND_REPLY_TO;

let resendClient: Resend | null = null;

function getResendClient() {
  if (!resendApiKey || !resendFromEmail) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(resendApiKey);
  }

  return resendClient;
}

async function sendEmail({
  to,
  subject,
  react,
  idempotencyKey,
}: {
  to: string;
  subject: string;
  react: React.ReactElement;
  idempotencyKey: string;
}) {
  const html = await render(react);
  await sendHtmlEmail({
    to,
    subject,
    html,
    idempotencyKey,
  });
}

async function sendHtmlEmail({
  to,
  subject,
  html,
  idempotencyKey,
}: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}) {
  const client = getResendClient();

  if (!client) {
    console.warn(
      "Skipping email send because RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
    );
    return;
  }

  const { error } = await client.emails.send(
    {
      from: resendFromEmail!,
      to: [to],
      subject,
      html,
      ...(resendReplyTo ? { replyTo: [resendReplyTo] } : {}),
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

export async function sendOtpEmail({
  email,
  otp,
  type,
  appName,
  locale,
}: {
  email: string;
  otp: string;
  type: OtpType;
  appName: string;
  locale: AppLocale;
}) {
  const t = createTranslator(locale);
  const titleByType: Record<OtpType, string> = {
    "sign-in": t("emails.otp.titleSignIn"),
    "email-verification": t("emails.otp.titleEmailVerification"),
    "forget-password": t("emails.otp.titleForgetPassword"),
  };
  const title = titleByType[type];
  const preview = t("emails.otp.preview", { title, appName });

  await sendEmail({
    to: email,
    subject: t("emails.otp.subject", { appName }),
    // Resend requires identical request bodies when reusing idempotency keys.
    // OTP content changes on each send, so include the OTP in the key.
    idempotencyKey: `otp/${type}/${email.toLowerCase()}/${otp}`,
    react: (
      <OtpEmail
        otp={otp}
        preview={preview}
        title={title}
        useCodeToContinue={t("emails.otp.useCodeToContinue")}
        expiresInFiveMinutes={t("emails.otp.expiresInFiveMinutes")}
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
  const isGerman = locale === "de";
  const preview = isGerman
    ? `WhatsApp Anleitung für ${organizationName}`
    : `WhatsApp setup guide for ${organizationName}`;
  const subject = isGerman
    ? `${organizationName}: WhatsApp verbinden`
    : `${organizationName}: Connect WhatsApp`;
  const heading = isGerman ? "WhatsApp aktivieren" : "Activate WhatsApp";
  const intro = isGerman
    ? `${memberName}, verbinde dein WhatsApp mit ${agentName}, um Onboarding und Chat zu starten.`
    : `${memberName}, connect your WhatsApp with ${agentName} to start onboarding and chat.`;
  const numberLabel = isGerman ? "Agent-Nummer" : "Agent number";
  const messageLabel = isGerman ? "Initiale Nachricht" : "Initial message";
  const stepTitle = isGerman ? "Kurzablauf" : "Quick steps";
  const stepOne = isGerman
    ? "1. Öffne WhatsApp und starte einen Chat mit der Agent-Nummer."
    : "1. Open WhatsApp and start a chat with the agent number.";
  const stepTwo = isGerman
    ? "2. Sende die initiale Nachricht und folge der Verifizierung."
    : "2. Send the initial message and follow verification.";
  const stepThree = isGerman
    ? "3. Danach kannst du direkt mit dem Agenten schreiben."
    : "3. After that you can chat with the agent directly.";
  const openButtonLabel = isGerman ? "WhatsApp jetzt öffnen" : "Open WhatsApp now";
  const fallbackHint = isGerman
    ? "Falls der Button nicht funktioniert, nutze diesen Link:"
    : "If the button does not work, use this link:";
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
