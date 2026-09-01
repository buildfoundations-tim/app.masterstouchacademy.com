import 'server-only';

/**
 * Transactional email.
 *
 * Three transports, chosen by MAIL_TRANSPORT:
 *
 *   console  (default) — writes the message to the server log, including the
 *                        full link. Nothing is sent. This is what makes the
 *                        whole signup and reset flow testable before anyone
 *                        signs up for an email provider.
 *   resend             — Resend's HTTP API. No dependency; it is one fetch.
 *   smtp               — any SMTP server via nodemailer, including the shared
 *                        host the marketing site already uses.
 *
 * Nothing here throws on a delivery failure. A signup must not fail because a
 * welcome email bounced — the caller logs it and carries on.
 */

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional and derived if absent. */
  text: string;
  html?: string;
};

export type MailResult = { ok: boolean; transport: string; error?: string };

function fromAddress(): string {
  return process.env.MAIL_FROM || 'Masters Touch Academy <no-reply@masterstouchacademy.com>';
}

function transportName(): string {
  const t = (process.env.MAIL_TRANSPORT || '').toLowerCase();
  return t === 'resend' || t === 'smtp' ? t : 'console';
}

/** Minimal text→HTML so a transport always has something to send. */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const body = escaped
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return (
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;color:#1c1a16;` +
    `max-width:560px;margin:0 auto;padding:24px">${body}` +
    `<hr style="border:0;border-top:1px solid #e8e2d5;margin:28px 0">` +
    `<p style="font-size:12px;color:#7a7263;margin:0">Masters Touch Academy · Cleveland, Ohio</p></div>`
  );
}

async function sendViaResend(msg: MailMessage): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, transport: 'resend', error: 'RESEND_API_KEY is not set' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(),
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? toHtml(msg.text),
      }),
    });
    if (!res.ok) {
      return { ok: false, transport: 'resend', error: `${res.status}: ${await res.text()}` };
    }
    return { ok: true, transport: 'resend' };
  } catch (e) {
    return { ok: false, transport: 'resend', error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendViaSmtp(msg: MailMessage): Promise<MailResult> {
  const host = process.env.SMTP_HOST;
  if (!host) return { ok: false, transport: 'smtp', error: 'SMTP_HOST is not set' };

  try {
    // Imported lazily so the dependency is only loaded when SMTP is chosen.
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    await transporter.sendMail({
      from: fromAddress(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? toHtml(msg.text),
    });
    return { ok: true, transport: 'smtp' };
  } catch (e) {
    return { ok: false, transport: 'smtp', error: e instanceof Error ? e.message : String(e) };
  }
}

function sendViaConsole(msg: MailMessage): MailResult {
  // Deliberately loud and complete: in development this IS the inbox, and the
  // verification and reset links have to be clickable from the terminal.
  console.log(
    [
      '',
      '┌─ EMAIL (console transport — nothing was actually sent) ─────────',
      `│ To:      ${msg.to}`,
      `│ Subject: ${msg.subject}`,
      '├─────────────────────────────────────────────────────────────────',
      ...msg.text.split('\n').map((l) => `│ ${l}`),
      '└─────────────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  );
  return { ok: true, transport: 'console' };
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  switch (transportName()) {
    case 'resend':
      return sendViaResend(msg);
    case 'smtp':
      return sendViaSmtp(msg);
    default:
      return sendViaConsole(msg);
  }
}

/** True when real delivery is configured — used to warn in the UI. */
export function mailConfigured(): boolean {
  const t = transportName();
  if (t === 'resend') return Boolean(process.env.RESEND_API_KEY);
  if (t === 'smtp') return Boolean(process.env.SMTP_HOST);
  return false;
}

export function mailTransport(): string {
  return transportName();
}
