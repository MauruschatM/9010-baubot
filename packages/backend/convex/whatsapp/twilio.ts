import { normalizeIncomingText } from "./normalize";
import type { TwilioInboundPayload } from "./types";

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function signTwilioPayload(options: {
  authToken: string;
  url: string;
  params: Array<[string, string]>;
}) {
  const sortedParams = options.params.slice().sort((entryA, entryB) => {
    if (entryA[0] === entryB[0]) {
      return entryA[1].localeCompare(entryB[1]);
    }

    return entryA[0].localeCompare(entryB[0]);
  });

  const signatureBase = `${options.url}${sortedParams
    .map(([key, value]) => `${key}${value}`)
    .join("")}`;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(options.authToken),
    {
      name: "HMAC",
      hash: "SHA-1",
    },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(signatureBase),
  );

  return toBase64(new Uint8Array(signatureBuffer));
}

export async function validateTwilioSignature(options: {
  requestUrl: string;
  authToken: string;
  signature: string | null;
  params: Array<[string, string]>;
}) {
  if (!options.signature || !options.authToken) {
    return false;
  }

  const expected = await signTwilioPayload({
    authToken: options.authToken,
    url: options.requestUrl,
    params: options.params,
  });

  return expected === options.signature;
}

export function parseTwilioInboundPayload(formData: FormData) {
  const numMediaRaw = getFormValue(formData, "NumMedia");
  const mediaCount = Number.isFinite(Number(numMediaRaw)) ? Number(numMediaRaw) : 0;

  const media = Array.from({ length: Math.max(0, mediaCount) })
    .map((_, index) => {
      const mediaUrl = getFormValue(formData, `MediaUrl${index}`);
      const contentType = getFormValue(formData, `MediaContentType${index}`);

      if (!mediaUrl || !contentType) {
        return null;
      }

      const urlPath = new URL(mediaUrl).pathname;
      const fileName = urlPath.split("/").pop()?.trim() || undefined;

      return {
        mediaUrl,
        contentType,
        fileName,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  const payload: TwilioInboundPayload = {
    from: getFormValue(formData, "From"),
    to: getFormValue(formData, "To"),
    body: normalizeIncomingText(getFormValue(formData, "Body")),
    messageSid: getFormValue(formData, "MessageSid"),
    profileName: getFormValue(formData, "ProfileName") || undefined,
    media,
  };

  return payload;
}

export async function sendTwilioWhatsAppMessage(options: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  body: string;
}) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`;

  const payload = new URLSearchParams({
    From: options.fromNumber.startsWith("whatsapp:")
      ? options.fromNumber
      : `whatsapp:${options.fromNumber}`,
    To: options.toNumber.startsWith("whatsapp:")
      ? options.toNumber
      : `whatsapp:${options.toNumber}`,
    Body: options.body,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${options.accountSid}:${options.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Twilio message send failed: ${response.status} ${responseText}`);
  }

  const responsePayload = (await response.json()) as Record<string, unknown>;
  return {
    sid: typeof responsePayload.sid === "string" ? responsePayload.sid : undefined,
  };
}

export async function sendTwilioWhatsAppTypingIndicator(options: {
  accountSid: string;
  authToken: string;
  messageId: string;
}) {
  const endpoint = "https://messaging.twilio.com/v2/Indicators/Typing.json";

  const payload = new URLSearchParams({
    messageId: options.messageId,
    channel: "whatsapp",
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${options.accountSid}:${options.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Twilio typing indicator failed: ${response.status} ${responseText}`,
    );
  }

  return await response.json();
}
