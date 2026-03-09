import type { Id } from "../_generated/dataModel";

export type TwilioInboundMedia = {
  mediaUrl: string;
  contentType: string;
  fileName?: string;
};

export type TwilioInboundPayload = {
  from: string;
  to: string;
  body: string;
  messageSid: string;
  profileName?: string;
  media: TwilioInboundMedia[];
};

export type StoredWhatsAppMedia = {
  storageId: Id<"_storage">;
  contentType: string;
  fileName?: string;
  mediaUrl?: string;
  transcription?: string;
  transcriptionModel?: string;
};

export type TurnDetectionDecision = {
  shouldSendNow: boolean;
  reason: string;
  shouldAskReadyConfirmation: boolean;
};
