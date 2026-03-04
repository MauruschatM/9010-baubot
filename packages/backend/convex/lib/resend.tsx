import { render } from "@react-email/render";
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
}: {
  email: string;
  otp: string;
  type: OtpType;
  appName: string;
}) {
  await sendEmail({
    to: email,
    subject: `${appName} verification code`,
    // Resend requires identical request bodies when reusing idempotency keys.
    // OTP content changes on each send, so include the OTP in the key.
    idempotencyKey: `otp/${type}/${email.toLowerCase()}/${otp}`,
    react: <OtpEmail otp={otp} type={type} appName={appName} />,
  });
}

export async function sendOrganizationInvitationEmail({
  email,
  inviterName,
  organizationName,
  role,
  inviteUrl,
  invitationId,
}: {
  email: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
  invitationId: string;
}) {
  await sendEmail({
    to: email,
    subject: `Invitation to join ${organizationName}`,
    idempotencyKey: `organization-invite/${invitationId}`,
    react: (
      <OrganizationInvitationEmail
        inviteUrl={inviteUrl}
        inviterName={inviterName}
        organizationName={organizationName}
        role={role}
      />
    ),
  });
}
