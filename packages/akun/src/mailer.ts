import { appendFileSync } from 'node:fs';
import { maskEmail } from './email.js';

/**
 * fetch yang disuntikkan untuk SEMUA HTTP keluar paket ini (Resend, Google). Bentuknya sama dengan
 * `EgressFetch` di @urusin/egress, sehingga peralihan ke egress cukup satu baris di tempat perakitan.
 */
export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type JenisEmail = 'verifikasi' | 'atur-ulang' | 'sudah-terdaftar';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  jenis: JenisEmail;
  /** Tautan utama di email (untuk mailer dev/uji; tidak dikirim terpisah). */
  link: string;
};

export interface Mailer {
  readonly kind: 'resend' | 'dev' | 'memory';
  send(msg: EmailMessage): Promise<void>;
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Galat kirim email. Tidak memuat isi respons penyedia (bisa berisi alamat penerima). */
export class MailerError extends Error {
  constructor(readonly status: number) {
    super(`pengiriman email gagal (HTTP ${status})`);
    this.name = 'MailerError';
  }
}

/** Resend lewat HTTPS API (tanpa SDK: SDK memakai fetch global, padahal HTTP keluar wajib lewat egress). */
export class ResendMailer implements Mailer {
  readonly kind = 'resend' as const;
  constructor(private readonly opts: { apiKey: string; from: string; fetch: HttpFetch; endpoint?: string }) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await this.opts.fetch(this.opts.endpoint ?? RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.opts.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        tags: [{ name: 'jenis', value: msg.jenis.replace(/[^a-z_-]/g, '') }],
      }),
    });
    await res.body?.cancel();
    if (!res.ok) throw new MailerError(res.status);
  }
}

/**
 * Mailer pengembangan: tidak mengirim apa pun, hanya mencatat tautan ke log (penerima disamarkan).
 * `outbox` (opsional, AUTH_EMAIL_OUTBOX) menambahkan satu baris JSON per email: dipakai e2e lokal.
 */
export class DevMailer implements Mailer {
  readonly kind = 'dev' as const;
  constructor(
    private readonly log: (line: string) => void,
    private readonly outbox?: string,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    this.log(`[email-dev] ${msg.jenis} ke ${maskEmail(msg.to)}: ${msg.link}`);
    if (this.outbox) {
      appendFileSync(
        this.outbox,
        `${JSON.stringify({ to: msg.to, jenis: msg.jenis, link: msg.link, subject: msg.subject })}\n`,
      );
    }
  }
}

/** Mailer untuk tes: menyimpan pesan di memori. */
export class MemoryMailer implements Mailer {
  readonly kind = 'memory' as const;
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg);
  }
  /** Pesan terakhir untuk penerima (opsional jenis tertentu). */
  last(to: string, jenis?: JenisEmail): EmailMessage | undefined {
    return this.sent.filter((m) => m.to === to && (!jenis || m.jenis === jenis)).at(-1);
  }
}

/**
 * Pilih mailer dari env. AUTH_EMAIL_DEV=1 memaksa mailer dev. Tanpa itu: RESEND_API_KEY + EMAIL_FROM →
 * Resend; di produksi (NODE_ENV=production) tanpa konfigurasi Resend → melempar (server menolak boot).
 */
export function mailerFromEnv(
  env: Record<string, string | undefined>,
  fetch: HttpFetch,
  log: (line: string) => void,
): Mailer {
  const dev = env.AUTH_EMAIL_DEV?.trim() === '1';
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!dev && apiKey && from) return new ResendMailer({ apiKey, from, fetch });
  if (dev || env.NODE_ENV !== 'production')
    return new DevMailer(log, env.AUTH_EMAIL_OUTBOX?.trim() || undefined);
  throw new Error(
    'RESEND_API_KEY dan EMAIL_FROM wajib di produksi (atau AUTH_EMAIL_DEV=1 untuk demo tanpa email sungguhan)',
  );
}
