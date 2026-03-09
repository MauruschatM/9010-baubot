import { httpRouter } from "convex/server";

import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/webhooks/whatsapp/twilio",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const formData = await request.formData();
    const signature = request.headers.get("x-twilio-signature");
    const requestUrl = process.env.TWILIO_WEBHOOK_URL?.trim() || request.url;

    const params: Array<{ key: string; value: string }> = [];
    formData.forEach((value, key) => {
      params.push({
        key,
        value: typeof value === "string" ? value : value.name,
      });
    });

    try {
      await ctx.runAction(api.whatsapp.handleTwilioWebhook, {
        requestUrl,
        signature,
        params,
      });

      return new Response("<Response></Response>", {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error";
      const status = message.includes("Invalid Twilio signature") ? 401 : 500;

      console.error("WhatsApp webhook error:", message);
      return new Response(message, { status });
    }
  }),
});

export default http;
