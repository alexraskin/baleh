import type { AccountEmailJob } from "./email.ts";

/*
 * Account email templates. One responsive layout, Baleh's tokens inlined because
 * email clients ignore stylesheets: warm background, white card, green button.
 */
// ponytail: English only. Add a Persian copy keyed by the user's preferredLanguage when needed.

const colors = {
  bg: "#F7F6F2",
  surface: "#FFFFFF",
  text: "#252620",
  muted: "#85857D",
  border: "#E8E6DF",
  accent: "#477B65",
};

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Content {
  subject: string;
  heading: string;
  paragraphs: string[];
  button: string;
  /** Small print under the button, e.g. expiry. */
  note: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function content({ kind, name }: AccountEmailJob): Content {
  const hi = `Hi ${name},`;
  switch (kind) {
    case "verify-email":
      return {
        subject: "Verify your Baleh email address",
        heading: "Verify your email address",
        paragraphs: [hi, "Confirm this is your email address to use it with your Baleh account."],
        button: "Verify email address",
        note: "This link expires in 24 hours and works once. If you didn't ask for this, you can ignore this email.",
      };
    case "reset-password":
      return {
        subject: "Reset your Baleh password",
        heading: "Reset your password",
        paragraphs: [hi, "Someone asked to reset the password for your Baleh account."],
        button: "Choose a new password",
        note: "This link expires in 1 hour and works once. If you didn't ask for this, you can ignore this email; your password won't change.",
      };
    case "welcome":
      return {
        subject: "Welcome to Baleh",
        heading: "Welcome to Baleh",
        paragraphs: [
          hi,
          "Baleh lets people who speak different languages talk naturally. Write in your own language, and everyone in the room reads your messages in theirs.",
          "Create a room, invite the people you talk to, and start a conversation.",
        ],
        button: "Open Baleh",
        note: "You're receiving this because you just verified your email address.",
      };
    case "password-changed":
      return {
        subject: "Security notification from Baleh",
        heading: "Your password was changed",
        paragraphs: [
          hi,
          "The password for your Baleh account was just changed, and you were signed out everywhere else.",
          "If this was you, there's nothing else to do. If it wasn't, reset your password now.",
        ],
        button: "Reset password",
        note: "We send this email for important changes to your account's security.",
      };
    case "two-factor-enabled":
      return {
        subject: "Security notification from Baleh",
        heading: "Two-step verification was turned on",
        paragraphs: [
          hi,
          "Two-step verification was just turned on for your Baleh account. Signing in now needs a code from an authenticator app.",
          "If this was you, there's nothing else to do. If it wasn't, someone has your password: reset it now.",
        ],
        button: "Reset password",
        note: "We send this email for important changes to your account's security.",
      };
    case "two-factor-disabled":
      return {
        subject: "Security notification from Baleh",
        heading: "Two-step verification was turned off",
        paragraphs: [
          hi,
          "Two-step verification was just turned off for your Baleh account. Signing in now needs only your password.",
          "If this was you, there's nothing else to do. If it wasn't, someone has your password: reset it now.",
        ],
        button: "Reset password",
        note: "We send this email for important changes to your account's security.",
      };
    case "change-email":
      return {
        subject: "Approve your new Baleh email address",
        heading: "Change your email address",
        paragraphs: [
          hi,
          "Someone asked to change the email address for your Baleh account.",
          "If this was you, approve the change and we'll send a verification link to the new address. Your email won't change until that link is opened too.",
        ],
        button: "Approve change",
        note: "This link expires in 24 hours. If you didn't ask for this, ignore this email and change your password.",
      };
  }
}

function layout(c: Content, url: string): string {
  const href = escapeHtml(url);
  const paragraphs = c.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${colors.text};">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${colors.bg};font-family:${font};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${colors.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${colors.accent};">Baleh</td></tr>
<tr><td style="background:${colors.surface};border:1px solid ${colors.border};border-radius:16px;padding:32px 28px;">
<h1 style="margin:0 0 20px;font-size:20px;line-height:28px;font-weight:600;color:${colors.text};">${escapeHtml(c.heading)}</h1>
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr><td style="border-radius:12px;background:${colors.accent};">
<a href="${href}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">${escapeHtml(c.button)}</a>
</td></tr>
</table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${colors.muted};">${escapeHtml(c.note)}</p>
<p style="margin:0;font-size:13px;line-height:20px;color:${colors.muted};">If the button doesn't work, copy this link into your browser:<br><a href="${href}" style="color:${colors.accent};word-break:break-all;">${href}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:18px;color:${colors.muted};">Baleh · Conversations across languages</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function plainText(c: Content, url: string): string {
  return [c.heading, "", ...c.paragraphs.flatMap((p) => [p, ""]), `${c.button}: ${url}`, "", c.note]
    .join("\n")
    .trim();
}

export function renderAccountEmail(job: AccountEmailJob): RenderedEmail {
  const c = content(job);
  return { subject: c.subject, html: layout(c, job.url), text: plainText(c, job.url) };
}
