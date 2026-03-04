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
  const client = getResendClient();

  if (!client) {
    console.warn(
      "Skipping email send because RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
    );
    return;
  }

  const html = await render(react);

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
