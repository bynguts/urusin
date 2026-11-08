import { appendFileSync } from 'node:fs';
import { nilaiEnv } from './env.js';
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
  readonly kind: 'resend' | 'log' | 'memory';
  /**
   * true = email TIDAK sampai ke penerima (mode log di produksi, Resend belum dikonfigurasi). Layanan akun
   * selalu melaporkan `tertunda` sehingga warga mendapat pesan jujur; verifikasi tidak memblokir.
   */
  readonly ditahan?: boolean;
  send(msg: EmailMessage): Promise<void>;
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Galat kirim email. Tidak memuat isi respons penyedia (bisa berisi alamat penerima). */
export class MailerError extends Error {
  constructor(readonly status: number) {
    super(
      status === 429
        ? 'pengiriman email gagal: kuota penyedia habis (HTTP 429)'
        : `pengiriman email gagal (HTTP ${status})`,
    );
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
 * Mailer mode log: tidak mengirim apa pun.
 * - Dev/CI: mencatat tautan ke log (penerima disamarkan); `outbox` (opsional, URUSIN_EMAIL_OUTBOX) menambah
 *   satu baris JSON per email untuk e2e.
 * - `ditahan` (produksi tanpa Resend): hanya mencatat bahwa email ditahan, TANPA tautan (tautan atur ulang di
 *   log = siapa pun yang membaca log bisa mengambil alih akun) dan tanpa outbox.
 */
export class DevMailer implements Mailer {
  readonly kind = 'log' as const;
  constructor(
    private readonly log: (line: string) => void,
    private readonly outbox?: string,
    readonly ditahan = false,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    if (this.ditahan) {
      this.log(`[email-ditahan] ${msg.jenis} ke ${maskEmail(msg.to)}: Resend belum dikonfigurasi`);
      return;
    }
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
  /** true = setiap kirim gagal seperti kuota penyedia habis (HTTP 429). */
  gagal = false;
  async send(msg: EmailMessage): Promise<void> {
    if (this.gagal) throw new MailerError(429);
    this.sent.push(msg);
  }
  /** Pesan terakhir untuk penerima (opsional jenis tertentu). */
  last(to: string, jenis?: JenisEmail): EmailMessage | undefined {
    return this.sent.filter((m) => m.to === to && (!jenis || m.jenis === jenis)).at(-1);
  }
}

export type ModeEmail = 'resend' | 'log';

/** Pengirim default (domain Urusin; SPF/DKIM Resend dipasang pemilik domain). */
export const EMAIL_FROM_DEFAULT = 'Urusin <no-reply@urusinai.web.id>';

/**
 * Pilih mailer dari env. `URUSIN_EMAIL_MODE` kosong = `resend` bila `RESEND_API_KEY` terisi, selain itu `log`.
 * - `resend`: `RESEND_API_KEY` wajib (eksplisit tanpa kunci = server menolak boot), pengirim
 *   `URUSIN_EMAIL_FROM`.
 * - `log`: tidak mengirim apa pun. Di dev/CI tautan dicatat ke log (+ `URUSIN_EMAIL_OUTBOX` opsional). Di
 *   produksi (tanpa `CI=true`) email DITAHAN: tanpa tautan di log, semua respons `tertunda`, verifikasi tidak
 *   memblokir (akun dipakai seperti tamu di perangkat itu). App tetap boot tanpa kredensial Resend.
 */
export function mailerFromEnv(
  env: Record<string, string | undefined>,
  fetch: HttpFetch,
  log: (line: string) => void,
): Mailer {
  const produksi = env.NODE_ENV === 'production';
  const apiKey = nilaiEnv(env.RESEND_API_KEY);
  const mode = env.URUSIN_EMAIL_MODE?.trim() || (apiKey ? 'resend' : 'log');
  if (mode === 'resend') {
    if (!apiKey) throw new Error('URUSIN_EMAIL_MODE=resend butuh RESEND_API_KEY');
    return new ResendMailer({ apiKey, from: env.URUSIN_EMAIL_FROM?.trim() || EMAIL_FROM_DEFAULT, fetch });
  }
  if (mode === 'log') {
    const ditahan = produksi && env.CI !== 'true';
    return new DevMailer(log, ditahan ? undefined : env.URUSIN_EMAIL_OUTBOX?.trim() || undefined, ditahan);
  }
  throw new Error(`URUSIN_EMAIL_MODE tidak dikenal: ${mode} (resend atau log)`);
}
