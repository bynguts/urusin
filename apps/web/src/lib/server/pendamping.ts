import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  AntreanPendampingResponseSchema,
  PendampingGalatSchema,
  SesiPendampingSchema,
  TiketPendampingResponseSchema,
  type AntreanPendampingResponse,
  type MulaiSesiInternal,
  type PemilikSesiInternal,
  type SesiPendamping,
} from '@urusin/contracts';
import { getOfficialDomain } from '@urusin/core';
import { egressFetch, type EgressFetch } from '@urusin/egress';
import { redactForStorage } from '@urusin/harness';
import { z, type ZodType } from 'zod';
import { apiError, apiJson } from '#lib/server/http.js';
import { SID_COOKIE } from '#lib/server/sesi.js';

/**
 * Broker web -> layanan Browser Pendamping. Warga hanya berbicara dengan web app (cookie `urusin_sid` +
 * Origin persis lewat hooks); web memanggil API internal pendamping dengan tanda tangan HMAC. Pendamping
 * tidak pernah melihat cookie mentah, hanya sha256-nya, dan sesi terikat ke urusan + hash itu.
 *
 * MULTI-WORKER: `PENDAMPING_WORKERS` = JSON `[{id, url, region, maxSessions, wsUrl, token?}]` (container identik di tiap
 * host; mis. VPS + laptop anggota lewat Tailscale). Situs registry `aksesWilayah: 'id-only'` hanya dirutekan
 * ke worker `region: 'id'` (IP Indonesia); bila tak ada yang sehat, urusan beralih ke mode dipandu dengan
 * pesan jujur. Situs lain memakai worker non-`id` lebih dulu (laptop dihemat), lalu beban terendah.
 * Tanpa `PENDAMPING_WORKERS`: satu worker dari `PENDAMPING_INTERNAL_URL` (region
 * `PENDAMPING_INTERNAL_REGION`, bawaan `umum`; URL WS `PENDAMPING_PUBLIC_WS_URL` bila diisi).
 *
 * Rahasia per worker (`token`): wajib untuk worker selain 127.0.0.1 (laptop lewat Tailscale), supaya satu
 * worker yang bocor tidak bisa memalsukan panggilan ke worker lain. URL WebSocket yang diberikan ke warga
 * DIPATOK ke `wsUrl` worker yang dikonfigurasi: jawaban tiket worker hanya menyumbang id sesi.
 *
 * Semua panggilan lewat `@urusin/egress`: origin worker hanya terjangkau bila `http://IP:port` dengan IP
 * 127.0.0.1 atau Tailscale 100.64.0.0/10 (pengecualian persis di kebijakan egress), bukan nama DNS.
 */

const WorkerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    /** Origin internal worker TANPA jalur (yang ditandatangani adalah jalur /internal/* apa adanya). */
    url: z.url().refine((u) => new URL(u).pathname === '/' && !new URL(u).search, 'url tanpa jalur'),
    region: z.string().regex(/^[a-z]{2,16}$/),
    maxSessions: z.number().int().positive().max(64),
    /** Basis URL WS publik worker ini (mis. wss://domain/pendamping/w/<id>/ws), tanpa garis miring akhir. */
    wsUrl: z.url({ protocol: /^wss?$/ }).refine((u) => !new URL(u).search && !new URL(u).hash, 'wsUrl polos'),
    /** Rahasia HMAC khusus worker ini (>= 32 karakter); wajib bila url bukan 127.0.0.1. */
    token: z.string().min(32).optional(),
  })
  .refine((w) => w.token !== undefined || new URL(w.url).hostname === '127.0.0.1', {
    message: 'worker di luar 127.0.0.1 wajib punya token sendiri',
  });
export type PendampingWorker = Omit<z.infer<typeof WorkerSchema>, 'wsUrl'> & { wsUrl?: string | undefined };
export type PendampingConfig = { token: string; workers: PendampingWorker[] };
/** Satu worker yang dipanggil (`panggil`). */
export type PendampingTarget = { url: string; token: string };

export const REGION_ID = 'id';

export function pendampingConfig(
  env: Record<string, string | undefined> = process.env,
): PendampingConfig | null {
  const token = env.PENDAMPING_INTERNAL_TOKEN?.trim();
  if (!token) return null;
  const daftar = env.PENDAMPING_WORKERS?.trim();
  if (daftar) {
    let raw: unknown;
    try {
      raw = JSON.parse(daftar);
    } catch {
      return null;
    }
    const w = z.array(WorkerSchema).min(1).max(16).safeParse(raw);
    if (!w.success || new Set(w.data.map((x) => x.id)).size !== w.data.length) return null;
    return {
      token,
      workers: w.data.map((x) => ({
        ...x,
        url: x.url.replace(/\/$/, ''),
        wsUrl: x.wsUrl.replace(/\/$/, ''),
      })),
    };
  }
  const url = env.PENDAMPING_INTERNAL_URL?.trim();
  if (!url) return null;
  return {
    token,
    workers: [
      {
        id: 'utama',
        url: url.replace(/\/$/, ''),
        region: env.PENDAMPING_INTERNAL_REGION?.trim() || 'umum',
        maxSessions: 64,
        ...(env.PENDAMPING_PUBLIC_WS_URL?.trim()
          ? { wsUrl: env.PENDAMPING_PUBLIC_WS_URL.trim().replace(/\/$/, '') }
          : {}),
      },
    ],
  };
}

const SID_RE = /^[0-9a-f]{32}$/;

/**
 * Cookie sesi yang SUDAH ada di request (bukan yang baru dibuat hooks pada request ini): sesi pendamping
 * hanya untuk perangkat yang sudah memegang cookie, sehingga tiket tidak bisa diminta oleh peramban lain.
 */
export function sidDariRequest(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SID_COOKIE) {
      const val = v.join('=');
      return SID_RE.test(val) ? val : null;
    }
  }
  return null;
}

export const hashSid = (sid: string) => createHash('sha256').update(sid).digest('hex');

export type Hasil<T> =
  | { ok: true; data: T; status: number }
  /** `dipandu`: pesan jujur untuk warga bila urusan harus beralih ke panduan langkah (tak ada worker wilayah). */
  | { ok: false; response: Response; dipandu?: string };

const TIDAK_TERSEDIA = () =>
  apiError(
    503,
    'LAYANAN_TIDAK_TERSEDIA',
    'Browser Pendamping sedang tidak tersedia. Coba lagi sebentar lagi.',
  );

export const PESAN_WILAYAH =
  'Situs ini hanya bisa dibuka dari jaringan Indonesia, dan Browser Pendamping berjaringan Indonesia ' +
  'sedang tidak aktif. Kami beralih ke panduan langkah: Anda membuka situsnya sendiri, kami pandu.';

/**
 * Tanda tangan HMAC kanal web -> worker. Salinan identik apps/pendamping/src/tanda.ts; vektor uji yang sama
 * di kedua sisi menjaga keduanya cocok. Rahasia = token worker (atau PENDAMPING_INTERNAL_TOKEN). Nonce acak
 * per permintaan; worker menolak nonce yang sudah terlihat dalam jendela 60 detik (anti putar ulang).
 */
export const HEADER_WAKTU = 'x-urusin-waktu';
export const HEADER_NONCE = 'x-urusin-nonce';
export const HEADER_TANDA = 'x-urusin-tanda';
export function tandaInternal(
  rahasia: string,
  waktu: string,
  nonce: string,
  metode: string,
  jalur: string,
  isi: string,
): string {
  const hashIsi = createHash('sha256').update(isi).digest('hex');
  return createHmac('sha256', rahasia)
    .update(`${waktu}\n${nonce}\n${metode.toUpperCase()}\n${jalur}\n${hashIsi}`)
    .digest('hex');
}

/** Panggil API internal satu worker; galat diteruskan sebagai `{kode, pesanWarga}` tanpa detail internal. */
export async function panggil<T>(
  cfg: PendampingTarget | null,
  path: string,
  schema: ZodType<T>,
  body?: MulaiSesiInternal | PemilikSesiInternal,
  fetcher: EgressFetch = egressFetch,
): Promise<Hasil<T>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  const metode = body === undefined ? 'GET' : 'POST';
  const isi = body === undefined ? '' : JSON.stringify(body);
  const waktu = String(Date.now());
  const nonce = randomBytes(16).toString('hex');
  let res: Response;
  try {
    res = await fetcher(`${cfg.url}${path}`, {
      method: metode,
      headers: {
        [HEADER_WAKTU]: waktu,
        [HEADER_NONCE]: nonce,
        [HEADER_TANDA]: tandaInternal(cfg.token, waktu, nonce, metode, path, isi),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: isi }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, response: TIDAK_TERSEDIA() };
  }
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const g = PendampingGalatSchema.safeParse(raw);
    return {
      ok: false,
      response:
        g.success && res.status < 500
          ? apiError(res.status, g.data.kode, g.data.pesanWarga)
          : TIDAK_TERSEDIA(),
    };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data, status: res.status }
    : { ok: false, response: TIDAK_TERSEDIA() };
}

// --- Kesehatan worker (GET /health publik: {ok, aktif, maks, menunggu}) ---

const HealthSchema = z.object({
  ok: z.literal(true),
  aktif: z.number().int().nonnegative(),
  maks: z.number().int().positive(),
  menunggu: z.number().int().nonnegative(),
});
type Sehat = z.infer<typeof HealthSchema>;

const SEHAT_TTL_MS = 5_000;
const kesehatan = new Map<string, { waktu: number; data: Sehat | null }>();
/** urusanId -> id worker yang memegang sesinya (sesi siaga dipakai ulang di worker yang sama). */
const lokasi = new Map<string, string>();
const LOKASI_MAKS = 5_000;

/** Untuk uji: kosongkan cache kesehatan dan peta lokasi sesi. */
export function resetBrokerPendamping(): void {
  kesehatan.clear();
  lokasi.clear();
}

function ingatLokasi(urusanId: string, workerId: string): void {
  lokasi.delete(urusanId);
  lokasi.set(urusanId, workerId);
  if (lokasi.size > LOKASI_MAKS) lokasi.delete(lokasi.keys().next().value as string);
}

async function sehat(w: PendampingWorker, fetcher: EgressFetch, now = Date.now()): Promise<Sehat | null> {
  const key = `${w.id}|${w.url}`;
  const c = kesehatan.get(key);
  if (c && now - c.waktu < SEHAT_TTL_MS) return c.data;
  let data: Sehat | null;
  try {
    const res = await fetcher(`${w.url}/health`, { signal: AbortSignal.timeout(2_500) });
    const h = HealthSchema.safeParse(await res.json());
    data = res.ok && h.success ? h.data : null;
  } catch {
    data = null;
  }
  kesehatan.set(key, { waktu: now, data });
  return data;
}

const beban = (w: PendampingWorker, s: Sehat) => (s.aktif + s.menunggu) / Math.min(w.maxSessions, s.maks);

/** Situs yang hanya menerima IP Indonesia (registry `aksesWilayah: 'id-only'`). */
export function butuhWilayahId(origin: string): boolean {
  try {
    return getOfficialDomain(new URL(origin).hostname)?.aksesWilayah === 'id-only';
  } catch {
    return false;
  }
}

/**
 * Pilih worker untuk sesi baru: worker yang sudah memegang urusan ini bila sehat (sesi siaga), lalu beban
 * terendah. `null` = tak ada worker sehat yang memenuhi syarat wilayah.
 */
export async function pilihWorker(
  cfg: PendampingConfig,
  origin: string,
  urusanId: string,
  fetcher: EgressFetch = egressFetch,
): Promise<PendampingWorker | null> {
  const idSaja = butuhWilayahId(origin);
  const kandidat = cfg.workers.filter((w) => !idSaja || w.region === REGION_ID);
  const hidup = (await Promise.all(kandidat.map(async (w) => ({ w, s: await sehat(w, fetcher) })))).filter(
    (x): x is { w: PendampingWorker; s: Sehat } => x.s !== null,
  );
  const lekat = hidup.find((x) => x.w.id === lokasi.get(urusanId));
  if (lekat) return lekat.w;
  hidup.sort(
    (a, b) =>
      Number(a.w.region === REGION_ID) - Number(b.w.region === REGION_ID) ||
      beban(a.w, a.s) - beban(b.w, b.s),
  );
  return hidup[0]?.w ?? null;
}

/** POST /internal/sesi ke worker yang tepat; tanpa worker wilayah Indonesia -> `dipandu`. */
export async function mulaiSesi(
  cfg: PendampingConfig | null,
  body: MulaiSesiInternal,
  fetcher: EgressFetch = egressFetch,
): Promise<Hasil<SesiPendamping>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  const w = await pilihWorker(cfg, body.origin, body.urusanId, fetcher);
  if (!w)
    return butuhWilayahId(body.origin)
      ? {
          ok: false,
          response: apiError(503, 'PENDAMPING_WILAYAH_TIDAK_TERSEDIA', PESAN_WILAYAH),
          dipandu: PESAN_WILAYAH,
        }
      : { ok: false, response: TIDAK_TERSEDIA() };
  const r = await panggil(
    { url: w.url, token: w.token ?? cfg.token },
    '/internal/sesi',
    skema.sesi,
    body,
    fetcher,
  );
  if (r.ok) ingatLokasi(body.urusanId, w.id);
  return r;
}

/**
 * Panggil endpoint sesi milik (urusan, sid) di worker yang memegangnya: dari peta lokasi, atau (setelah web
 * restart) dengan menanyakan status ke worker sehat lain. 404 dari semua worker diteruskan apa adanya.
 */
export async function panggilPemilik<T>(
  cfg: PendampingConfig | null,
  path: string,
  schema: ZodType<T>,
  owner: PemilikSesiInternal,
  fetcher: EgressFetch = egressFetch,
): Promise<Hasil<T>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  const target = (w: PendampingWorker) => ({ url: w.url, token: w.token ?? cfg.token });
  const tercatat = cfg.workers.find((w) => w.id === lokasi.get(owner.urusanId));
  let tidakAda: Hasil<T> | null = null;
  if (tercatat) {
    const r = await panggil(target(tercatat), path, schema, owner, fetcher);
    if (r.ok || r.response.status !== 404) return r;
    tidakAda = r;
    lokasi.delete(owner.urusanId);
  }
  const lain = cfg.workers.filter((w) => w !== tercatat);
  const hidup = (await Promise.all(lain.map(async (w) => ((await sehat(w, fetcher)) ? w : null)))).filter(
    (w): w is PendampingWorker => w !== null,
  );
  const temu = await Promise.all(
    hidup.map(async (w) => ({
      w,
      r: await panggil(target(w), '/internal/sesi/status', skema.sesi, owner, fetcher),
    })),
  );
  const pemegang = temu.find((x) => x.r.ok);
  if (pemegang) {
    ingatLokasi(owner.urusanId, pemegang.w.id);
    if (path === '/internal/sesi/status') return pemegang.r as Hasil<T>;
    return panggil(target(pemegang.w), path, schema, owner, fetcher);
  }
  const g = temu.find((x) => !x.r.ok && x.r.response.status === 404);
  return g ? (g.r as Hasil<T>) : (tidakAda ?? { ok: false, response: TIDAK_TERSEDIA() });
}

/** Ringkasan antrean gabungan semua worker sehat (tanpa data warga). */
export async function antreanGabungan(
  cfg: PendampingConfig | null,
  fetcher: EgressFetch = egressFetch,
): Promise<Hasil<AntreanPendampingResponse>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  const semua = await Promise.all(cfg.workers.map(async (w) => ({ w, s: await sehat(w, fetcher) })));
  const hidup = semua.filter((x): x is { w: PendampingWorker; s: Sehat } => x.s !== null);
  if (hidup.length === 0) return { ok: false, response: TIDAK_TERSEDIA() };
  return {
    ok: true,
    status: 200,
    data: hidup.reduce(
      (a, { w, s }) => ({
        aktif: a.aktif + s.aktif,
        maks: a.maks + Math.min(w.maxSessions, s.maks),
        menunggu: a.menunggu + s.menunggu,
      }),
      { aktif: 0, maks: 0, menunggu: 0 },
    ),
  };
}

export const skema = {
  sesi: SesiPendampingSchema,
  tiket: TiketPendampingResponseSchema,
  antrean: AntreanPendampingResponseSchema,
};

export const teruskan = <T>(h: Hasil<T>): Response => (h.ok ? apiJson(h.data, h.status) : h.response);

/**
 * Status akhir pendamping -> hasil eksekusi urusan (null = belum berakhir). Sesi `siaga` (execution selesai,
 * peramban tetap hidup untuk langkah berikutnya urusan yang sama) juga sudah punya hasil.
 */
export function hasilAkhir(s: SesiPendamping): 'berhasil' | 'gagal' | 'dibatalkan' | 'drift' | null {
  return (s.mode === 'done' || s.status === 'siaga') && s.hasil ? s.hasil : null;
}

/** Label progres bukti dari halaman konfirmasi (nomor registrasi/status), diredaksi sebelum disimpan. */
export function labelBukti(s: SesiPendamping): string | null {
  const b = s.bukti;
  if (!b || (!b.nomor && !b.status)) return null;
  const bagian = [b.nomor ? `nomor ${b.nomor}` : null, b.status ? `status "${b.status}"` : null].filter(
    Boolean,
  );
  return redactForStorage(`Bukti dari situs resmi: ${bagian.join(', ')}.`);
}

const SESI_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Tiket WebSocket dari worker pemegang sesi, dengan `wsUrl` DIPATOK ke `wsUrl` worker yang dikonfigurasi
 * (bukan URL yang dikirim worker): worker hanya menyumbang id sesi, divalidasi sebagai UUID. Worker tanpa
 * `wsUrl` (mode satu worker tanpa PENDAMPING_PUBLIC_WS_URL) memakai jawaban worker apa adanya.
 */
export async function tiketSesi(
  cfg: PendampingConfig | null,
  owner: PemilikSesiInternal,
  fetcher: EgressFetch = egressFetch,
): Promise<Hasil<z.infer<typeof TiketPendampingResponseSchema>>> {
  const r = await panggilPemilik(cfg, '/internal/sesi/tiket', skema.tiket, owner, fetcher);
  if (!r.ok || !cfg) return r;
  const w = cfg.workers.find((x) => x.id === lokasi.get(owner.urusanId));
  if (!w?.wsUrl) return r;
  const sesiId = decodeURIComponent(new URL(r.data.wsUrl, 'ws://x').pathname.split('/').pop() ?? '');
  if (!SESI_ID_RE.test(sesiId)) return { ok: false, response: TIDAK_TERSEDIA() };
  return { ...r, data: { ...r.data, wsUrl: `${w.wsUrl}/${sesiId}` } };
}
