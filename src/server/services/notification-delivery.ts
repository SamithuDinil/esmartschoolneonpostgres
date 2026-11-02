import "server-only";

export type DeliveryOutcome = {
  channel: "email" | "sms";
  status: "sent" | "skipped" | "failed";
  detail: string;
};

const safeMessage = (value: string) => value.slice(0, 1500);

export async function deliverConfiguredNotification(input: {
  channels: {
    emailEnabled?: boolean;
    emailProvider?: string;
    emailFrom?: string;
    smsEnabled?: boolean;
    smsProvider?: string;
    smsFrom?: string;
  };
  emailTo?: string;
  smsTo?: string;
  subject: string;
  message: string;
}): Promise<DeliveryOutcome[]> {
  const out: DeliveryOutcome[] = [];
  if (input.channels.emailEnabled) {
    if (
      input.channels.emailProvider !== "resend" ||
      !process.env.EMAIL_PROVIDER_API_KEY ||
      !input.channels.emailFrom ||
      !input.emailTo
    ) {
      out.push({
        channel: "email",
        status: "skipped",
        detail: "provider_or_recipient_not_configured",
      });
    } else {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: input.channels.emailFrom,
            to: [input.emailTo],
            subject: input.subject,
            text: safeMessage(input.message),
          }),
        });
        out.push({
          channel: "email",
          status: response.ok ? "sent" : "failed",
          detail: response.ok ? "accepted" : `provider_http_${response.status}`,
        });
      } catch {
        out.push({ channel: "email", status: "failed", detail: "provider_unreachable" });
      }
    }
  }
  if (input.channels.smsEnabled) {
    const sid = process.env.SMS_TWILIO_ACCOUNT_SID;
    if (
      input.channels.smsProvider !== "twilio" ||
      !sid ||
      !process.env.SMS_PROVIDER_API_KEY ||
      !input.channels.smsFrom ||
      !input.smsTo
    ) {
      out.push({
        channel: "sms",
        status: "skipped",
        detail: "provider_or_recipient_not_configured",
      });
    } else {
      try {
        const body = new URLSearchParams({
          From: input.channels.smsFrom,
          To: input.smsTo,
          Body: safeMessage(`${input.subject}: ${input.message}`),
        });
        const authorization = Buffer.from(`${sid}:${process.env.SMS_PROVIDER_API_KEY}`).toString(
          "base64",
        );
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
          {
            method: "POST",
            signal: AbortSignal.timeout(8000),
            headers: {
              Authorization: `Basic ${authorization}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          },
        );
        out.push({
          channel: "sms",
          status: response.ok ? "sent" : "failed",
          detail: response.ok ? "accepted" : `provider_http_${response.status}`,
        });
      } catch {
        out.push({ channel: "sms", status: "failed", detail: "provider_unreachable" });
      }
    }
  }
  return out;
}
