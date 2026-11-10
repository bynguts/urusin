import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  AntreanPendampingResponseSchema,
  ButuhSesiInternalSchema,
  PendampingGalatSchema,
  SesiPendampingSchema,
  TiketPendampingResponseSchema,
  type AksiSesiInternal,
  type AmatiSesiInternal,
  type AntreanPendampingResponse,
  type BerkasSesiInternal,
  type IsiSesiInternal,
  type MulaiSesiInternal,
  type PemilikSesiInternal,
  type SelesaiSesiInternal,
  type SesiPendamping,
  type TungguSesiInternal,
} from '@urusin/contracts';
import { getOfficialDomain } from '@urusin/core';
import { egressFetch, type EgressFetch } from '@urusin/egress';
import { redactForStorage, type UrusanRow } from '@urusin/harness';
import { z, type ZodType } from 'zod';
import { apiError, apiJson } from '#lib/server/http.js';
import { SID_COOKIE } from '#lib/server/sesi.js';

/**
 * Broker web -> layanan Browser Pendamping. Warga hanya berbicara dengan web app (cookie `urusin_sid` +
 * Origin persis lewat hooks); web memanggil API internal pendamping dengan tanda tangan HMAC. Pendamping
 * tidak pernah melihat cookie mentah, hanya sha256-nya, dan sesi terikat ke urusan + hash itu.
 *
 * MULTI-WORKER: `PENDAMPING_WORKERS` = JSON `[{id, url, region, maxSessions, wsUrl, token?}]` (container identik di tiap
 * host; mis. VPS + laptop anggota lewat Tailscale). Rute per `aksesWilayah` registry (sesi akun warga di
 * portal asli; Mode Uji selalu tanpa syarat wilayah):
 * - `id-only` (blokir keras IP luar negeri): HANYA worker `region: 'id'`; tak ada yang sehat -> mode dipandu
 *   dengan pesan jujur;
 * - `id-utama` (dari server muncul kotak centang yang diselesaikan warga): worker `id` yang sehat dan masih punya
 *   slot didahulukan, selain itu beban terendah; start yang gagal di worker (jaringan, 401/403, 5xx) dicoba di
 *   kandidat berikutnya (server tetap melayani; laptop hanya bonus);
 * - lainnya: worker non-`id` lebih dulu (laptop dihemat), lalu beban terendah.
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

/**
 * `new URL()` yang tidak melempar: refine zod 4 tetap dijalankan walau format `z.url()` sudah gagal, jadi URL
 * rusak di env tidak boleh membuat pendampingConfig() (dan hooks CSP) melempar.
 */
const urlAman = (u: string): URL | null => (URL.canParse(u) ? new URL(u) : null);

/** URL WS publik worker: ws(s) polos tanpa query/hash (juga untuk PENDAMPING_PUBLIC_WS_URL). */
const WsUrlSchema = z.url({ protocol: /^wss?$/ }).refine((u) => {
  const x = urlAman(u);
  return x !== null && !x.search && !x.hash;
}, 'wsUrl polos');

const WorkerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
    /** Origin internal worker TANPA jalur (yang ditandatangani adalah jalur /internal/* apa adanya). */
    url: z.url().refine((u) => urlAman(u)?.pathname === '/' && !urlAman(u)?.search, 'url tanpa jalur'),
    region: z.string().regex(/^[a-z]{2,16}$/),
    maxSessions: z.number().int().positive().max(64),
    /** Basis URL WS publik worker ini (mis. wss://domain/pendamping/w/<id>/ws), tanpa garis miring akhir. */
    wsUrl: WsUrlSchema,
    /** Rahasia HMAC khusus worker ini (>= 32 karakter); wajib bila url bukan 127.0.0.1. */
    token: z.string().min(32).optional(),
  })
  .refine((w) => w.token !== undefined || urlAman(w.url)?.hostname === '127.0.0.1', {
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
  // URL WS cadangan divalidasi sama seperti `wsUrl` PENDAMPING_WORKERS: nilai rusak = Pendamping mati (null),
  // bukan URL yang membuat hooks (CSP) atau tiket melempar galat di setiap permintaan.
  const wsUrl = env.PENDAMPING_PUBLIC_WS_URL?.trim();
  if (wsUrl && !WsUrlSchema.safeParse(wsUrl).success) return null;
  return {
    token,
    workers: [
      {
        id: 'utama',
        url: url.replace(/\/$/, ''),
        region: env.PENDAMPING_INTERNAL_REGION?.trim() || 'umum',
        maxSessions: 64,
        ...(wsUrl ? { wsUrl: wsUrl.replace(/\/$/, '') } : {}),
      },
    ],
  };
}

/**
 * Origin WS worker yang TIDAK tercakup `connect-src 'self'` (host:port beda dari origin web), mis.
 * `ws://localhost:4330` saat demo final lokal (web http://localhost:3000). Di produksi semua `wsUrl` lewat domain
 * web sendiri (`wss://<domain>/pendamping/...`), jadi daftar ini kosong dan CSP tidak berubah.
 */
export function asalWsLain(cfg: PendampingConfig | null, originWeb: string): string[] {
  const host = new URL(originWeb).host;
  const out = new Set<string>();
  for (const w of cfg?.workers ?? []) {
    if (!w.wsUrl) continue;
    const u = new URL(w.wsUrl);
    if (u.host !== host) out.add(`${u.protocol}//${u.host}`);
  }
  return [...out];
}

let asalWsMemo: readonly string[] | undefined;

/**
 * `asalWsLain` untuk hooks (CSP), dihitung SEKALI per proses (env tidak berubah selama proses hidup). Galat apa
 * pun (origin web/URL rusak) = daftar kosong: CSP aplikasi dikirim apa adanya (fail-open ke CSP lama), tidak
 * pernah 500 di setiap halaman.
 */
export function asalWsUntukCsp(
  originWeb: () => string,
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  if (asalWsMemo) return asalWsMemo;
  try {
    asalWsMemo = asalWsLain(pendampingConfig(env), originWeb());
  } catch {
    asalWsMemo = [];
  }
  return asalWsMemo;
}

/** Tambahkan origin ke direktif `connect-src` header CSP (direktif lain tidak disentuh). */
export function tambahConnectSrc(csp: string, asal: readonly string[]): string {
  if (asal.length === 0) return csp;
  return csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (/^connect-src(\s|$)/.test(d) ? `${d} ${asal.join(' ')}` : d))
    .join('; ');
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
  /**
   * `dipandu`: pesan jujur untuk warga bila urusan harus beralih ke panduan langkah (tak ada worker wilayah).
   * `galatWorker`: kegagalan di sisi worker/kanal (jaringan, timeout, 401/403 kanal internal, 5xx), bukan
   * jawaban galat sah untuk warga; worker lain boleh dicoba (`mulaiSesi`). `putus`: tanpa jawaban sama sekali
   * (jaringan/timeout), jadi worker itu BISA saja sudah membuat sesinya.
   */
  | { ok: false; response: Response; dipandu?: string; galatWorker?: true; putus?: true };

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
 * di kedua sisi menjaga keduanya cocok. Rahasia = token worker (atau PENDAMPING_INTERNAL_TOKEN). Yang
 * ditandatangani: waktu, nonce, metode, jalur, panjang isi (Content-Length) dan sha256 isi yang juga dikirim di
 * header `x-urusin-isi-sha256`, sehingga worker memeriksa tanda tangan SEBELUM membaca isi. Nonce acak per
 * permintaan; worker menolak nonce yang sudah terlihat dalam jendela 60 detik (anti putar ulang).
 */
export const HEADER_WAKTU = 'x-urusin-waktu';
export const HEADER_NONCE = 'x-urusin-nonce';
export const HEADER_TANDA = 'x-urusin-tanda';
export const HEADER_ISI = 'x-urusin-isi-sha256';
const sha256Hex = (isi: string) => createHash('sha256').update(isi).digest('hex');
export function tandaInternal(
  rahasia: string,
  waktu: string,
  nonce: string,
  metode: string,
  jalur: string,
  isi: string,
): string {
  const panjang = Buffer.byteLength(isi);
  return createHmac('sha256', rahasia)
    .update(`${waktu}\n${nonce}\n${metode.toUpperCase()}\n${jalur}\n${panjang}\n${sha256Hex(isi)}`)
    .digest('hex');
}

/** Body permintaan internal yang ditandatangani (selain mulai sesi, selalu memuat pemilik). */
export type BodyPemilik =
  | PemilikSesiInternal
  | IsiSesiInternal
  | BerkasSesiInternal
  | AksiSesiInternal
  | AmatiSesiInternal
  | TungguSesiInternal
  | SelesaiSesiInternal;

/** Batas waktu bawaan satu panggilan internal; long-poll `/internal/sesi/tunggu` memberi batasnya sendiri. */
const BATAS_PANGGIL_MS = 15_000;

/** Panggil API internal satu worker; galat diteruskan sebagai `{kode, pesanWarga}` tanpa detail internal. */
export async function panggil<T>(
  cfg: PendampingTarget | null,
  path: string,
  schema: ZodType<T>,
  body?: MulaiSesiInternal | BodyPemilik,
  fetcher: EgressFetch = egressFetch,
  batasMs: number = BATAS_PANGGIL_MS,
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
        [HEADER_ISI]: sha256Hex(isi),
        [HEADER_TANDA]: tandaInternal(cfg.token, waktu, nonce, metode, path, isi),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: isi }),
      signal: AbortSignal.timeout(batasMs),
    });
  } catch {
    return { ok: false, response: TIDAK_TERSEDIA(), galatWorker: true, putus: true };
  }
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const g = PendampingGalatSchema.safeParse(raw);
    // 401/403 = kanal internal ditolak (token worker salah/dirotasi, proxy di depan worker): urusan operator,
    // bukan warga. Satu-satunya 403 untuk warga adalah SESI_BUKAN_MILIK (sesi urusan ini milik perangkat lain).
    const kanalDitolak =
      res.status === 401 || (res.status === 403 && !(g.success && g.data.kode === 'SESI_BUKAN_MILIK'));
    if (kanalDitolak || res.status >= 500)
      return { ok: false, response: TIDAK_TERSEDIA(), galatWorker: true };
    if (!g.success) return { ok: false, response: TIDAK_TERSEDIA() };
    return { ok: false, response: apiError(res.status, g.data.kode, g.data.pesanWarga) };
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
  asalWsMemo = undefined;
  jaringanId = undefined;
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

/** Syarat jaringan situs dari registry (`aksesWilayah`); undefined = worker mana pun. */
export function aksesWilayah(origin: string): 'id-only' | 'id-utama' | undefined {
  try {
    return getOfficialDomain(new URL(origin).hostname)?.aksesWilayah;
  } catch {
    return undefined;
  }
}

/** Situs yang hanya menerima IP Indonesia (registry `aksesWilayah: 'id-only'`). */
export function butuhWilayahId(origin: string): boolean {
  return aksesWilayah(origin) === 'id-only';
}

/**
 * Syarat jaringan Indonesia dinilai pada origin EFEKTIF sesi. Mode Uji selalu dibuka di replika fixtures milik
 * kita (worker memetakan origin resmi ke replika, atau menolak bila replikanya tidak ada), jadi tak butuh IP
 * Indonesia; sesi akun warga di portal asli tetap butuh. Syaratnya HANYA dari catatan registry yang terukur
 * (probe nyata): `id-utama` = worker berjaringan Indonesia diutamakan (mis. interstitial Turnstile dari IP pusat
 * data), `id-only` = wajib. Portal tanpa catatan tidak diutamakan ke worker laptop tim (ADR 0030): nilai Data
 * Diri warga tidak ikut ke memori perangkat itu tanpa alasan terukur.
 */
const aksesSesi = (origin: string, modeUji: boolean | undefined) =>
  modeUji === true ? undefined : aksesWilayah(origin);
const butuhWilayahSesi = (origin: string, modeUji: boolean | undefined) =>
  aksesSesi(origin, modeUji) === 'id-only';

/**
 * Kandidat worker sehat untuk sesi baru, urut prioritas: worker yang sudah memegang urusan ini (sesi siaga /
 * lekat), lalu
 * - `id-utama`: worker `id` yang MASIH punya slot (beban < 1) lebih dulu; selain itu beban terendah (laptop
 *   penuh tidak membuat warga mengantre bila server lowong);
 * - lainnya: worker non-`id` lebih dulu (laptop dihemat), lalu beban terendah.
 * `id-only` hanya worker `id`. Kosong = tak ada worker sehat yang memenuhi syarat wilayah.
 */
async function kandidatWorker(
  cfg: PendampingConfig,
  akses: ReturnType<typeof aksesSesi>,
  urusanId: string,
  fetcher: EgressFetch,
): Promise<PendampingWorker[]> {
  const kandidat = cfg.workers.filter((w) => akses !== 'id-only' || w.region === REGION_ID);
  const hidup = (await Promise.all(kandidat.map(async (w) => ({ w, s: await sehat(w, fetcher) })))).filter(
    (x): x is { w: PendampingWorker; s: Sehat } => x.s !== null,
  );
  const lekat = (w: PendampingWorker) => Number(w.id !== lokasi.get(urusanId));
  const urutan = (w: PendampingWorker, s: Sehat) =>
    akses === 'id-utama'
      ? Number(!(w.region === REGION_ID && beban(w, s) < 1))
      : Number(w.region === REGION_ID);
  hidup.sort(
    (a, b) =>
      lekat(a.w) - lekat(b.w) || urutan(a.w, a.s) - urutan(b.w, b.s) || beban(a.w, a.s) - beban(b.w, b.s),
  );
  return hidup.map((x) => x.w);
}

// --- Ketersediaan jaringan Indonesia untuk rute rencana (host `id-only`, harness `aturJaringanId`) ---

const JARINGAN_ID_TTL_MS = 10_000;
/** Lebih tua dari ini = dingin (proses tanpa pemanas latar): ditunggu, bukan dipakai apa adanya. */
const JARINGAN_ID_DINGIN_MS = 60_000;
let jaringanId: { waktu: number; siap: boolean } | undefined;
let jaringanIdJalan: Promise<boolean> | undefined;

/**
 * Ada worker `id` sehat untuk host `id-only`? Pool dan pemeriksaan SAMA dengan `pilihWorker` (`kandidatWorker`
 * dengan akses `id-only`, cache kesehatan per worker), hasilnya di-cache JARINGAN_ID_TTL_MS. Tanpa konfigurasi
 * pendamping = false. Ditunggu sebelum keputusan rute (persetujuan rencana, wilayah, turn agen).
 */
export async function segarkanJaringanId(
  cfg: PendampingConfig | null = pendampingConfig(),
  fetcher: EgressFetch = egressFetch,
): Promise<boolean> {
  const umur = jaringanId ? Date.now() - jaringanId.waktu : Infinity;
  if (jaringanId && umur < JARINGAN_ID_TTL_MS) return jaringanId.siap;
  const jalan = (jaringanIdJalan ??= (async () => {
    const siap = cfg ? (await kandidatWorker(cfg, 'id-only', '', fetcher)).length > 0 : false;
    jaringanId = { waktu: Date.now(), siap };
    return siap;
  })().finally(() => (jaringanIdJalan = undefined)));
  // Basi tetapi belum dingin: nilai terakhir dipakai, penyegaran berjalan di latar (tanpa latensi per turn
  // saat worker ID mati). Sesi id-only tetap diperiksa ulang saat dimulai (mulaiSesi), jadi tetap jujur.
  if (jaringanId && umur < JARINGAN_ID_DINGIN_MS) {
    jalan.catch(() => {});
    return jaringanId.siap;
  }
  return jalan;
}

let pemanasJaringanId: ReturnType<typeof setInterval> | undefined;
/**
 * Panaskan cache jaringan Indonesia saat start lalu segarkan berkala di latar (`unref`, tidak menahan proses):
 * keputusan rute membaca nilai sinkron yang segar, termasuk turn pertama urusan baru.
 */
export function panaskanJaringanId(): void {
  if (pemanasJaringanId) return;
  void segarkanJaringanId().catch(() => {});
  pemanasJaringanId = setInterval(() => void segarkanJaringanId().catch(() => {}), JARINGAN_ID_TTL_MS);
  pemanasJaringanId.unref?.();
}

/** Nilai terakhir, sinkron (untuk `aturJaringanId`); basi atau belum ada = disegarkan di latar. */
export function jaringanIdSiap(): boolean {
  if (!jaringanId || Date.now() - jaringanId.waktu >= JARINGAN_ID_TTL_MS)
    void segarkanJaringanId().catch(() => {});
  return jaringanId?.siap ?? false;
}

/** Worker pertama untuk sesi baru (lihat `kandidatWorker`); `null` = tak ada yang sehat dan memenuhi syarat. */
export async function pilihWorker(
  cfg: PendampingConfig,
  origin: string,
  urusanId: string,
  fetcher: EgressFetch = egressFetch,
  modeUji?: boolean,
): Promise<PendampingWorker | null> {
  return (await kandidatWorker(cfg, aksesSesi(origin, modeUji), urusanId, fetcher))[0] ?? null;
}

/**
 * POST /internal/sesi ke worker yang tepat. `dipandu` HANYA untuk situs `id-only` tanpa worker `id` yang sehat;
 * situs lain (termasuk `id-utama`) hanya gagal bila tidak ada worker sehat sama sekali. Bila start gagal di sisi
 * worker (jaringan/timeout, 401/403 kanal internal, 5xx) kandidat sehat berikutnya dicoba, KECUALI situs
 * `id-only` (tidak pernah jatuh ke worker lain; galat dari worker `id` diteruskan apa adanya).
 */
export async function mulaiSesi(
  cfg: PendampingConfig | null,
  body: MulaiSesiInternal,
  fetcher: EgressFetch = egressFetch,
): Promise<Hasil<SesiPendamping>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  const akses = aksesSesi(body.origin, body.modeUji);
  const daftar = await kandidatWorker(cfg, akses, body.urusanId, fetcher);
  if (daftar.length === 0)
    return butuhWilayahSesi(body.origin, body.modeUji)
      ? {
          ok: false,
          response: apiError(503, 'PENDAMPING_WILAYAH_TIDAK_TERSEDIA', PESAN_WILAYAH),
          dipandu: PESAN_WILAYAH,
        }
      : { ok: false, response: TIDAK_TERSEDIA() };
  let r: Hasil<SesiPendamping> = { ok: false, response: TIDAK_TERSEDIA() };
  // Worker yang tidak menjawab (jaringan/timeout) bisa saja sudah membuat sesinya: setelah kandidat lain dicoba,
  // sesi itu ditutup best-effort agar tidak menjadi sesi yatim yang memakan slot sampai TTL.
  const yatim: PendampingWorker[] = [];
  const pemilik: PemilikSesiInternal = { urusanId: body.urusanId, sidHash: body.sidHash };
  try {
    for (const w of akses === 'id-only' ? daftar.slice(0, 1) : daftar) {
      r = await panggil(
        { url: w.url, token: w.token ?? cfg.token },
        '/internal/sesi',
        skema.sesi,
        body,
        fetcher,
      );
      if (r.ok) {
        ingatLokasi(body.urusanId, w.id);
        return r;
      }
      if (r.putus) yatim.push(w);
      if (!r.galatWorker) return r;
    }
    return r;
  } finally {
    for (const w of yatim) void akhiriYatim(cfg, w, pemilik, fetcher);
  }
}

const AKHIRI_YATIM_MS = 3_000;
const STATUS_AKHIR: ReadonlySet<SesiPendamping['status']> = new Set([
  'selesai',
  'gagal',
  'dipandu',
  'kedaluwarsa',
  'dibatalkan',
]);

/**
 * Tutup best-effort sesi (urusan, sid) di worker yang tidak dipakai lagi (fire-and-forget, timeout pendek). Galat
 * ditelan; log satu baris tanpa PII (id worker + status saja). 404 = memang tidak ada sesi di sana.
 */
export async function akhiriYatim(
  cfg: PendampingConfig,
  w: PendampingWorker,
  pemilik: PemilikSesiInternal,
  fetcher: EgressFetch = egressFetch,
): Promise<void> {
  try {
    const r = await panggil(
      { url: w.url, token: w.token ?? cfg.token },
      '/internal/sesi/akhiri',
      skema.sesi,
      { urusanId: pemilik.urusanId, sidHash: pemilik.sidHash },
      fetcher,
      AKHIRI_YATIM_MS,
    );
    if (!r.ok && r.response.status !== 404)
      console.log(`pendamping: penutupan sesi yatim gagal worker=${w.id} status=${r.response.status}`);
  } catch {
    console.log(`pendamping: penutupan sesi yatim gagal worker=${w.id}`);
  }
}

/** Sesi hidup lebih dulu, lalu yang paling baru dibuat. */
const lebihUtama = (a: SesiPendamping, b: SesiPendamping) =>
  Number(STATUS_AKHIR.has(a.status)) - Number(STATUS_AKHIR.has(b.status)) ||
  Date.parse(b.dibuatPada) - Date.parse(a.dibuatPada);

/**
 * Panggil endpoint sesi milik (urusan, sid) di worker yang memegangnya: dari peta lokasi, atau (setelah web
 * restart) dengan menanyakan status ke worker sehat lain; bila beberapa worker memegang sesi urusan ini, yang
 * hidup dan paling baru dipakai dan sisanya ditutup. 404 dari semua worker diteruskan apa adanya.
 */
export async function panggilPemilik<T>(
  cfg: PendampingConfig | null,
  path: string,
  schema: ZodType<T>,
  /** Body permintaan; selain pemilik boleh membawa isi (jalur isi) yang HANYA dikirim ke worker pemegang sesi. */
  owner: BodyPemilik,
  fetcher: EgressFetch = egressFetch,
  batasMs: number = BATAS_PANGGIL_MS,
): Promise<Hasil<T>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  const pemilik: PemilikSesiInternal = { urusanId: owner.urusanId, sidHash: owner.sidHash };
  const target = (w: PendampingWorker) => ({ url: w.url, token: w.token ?? cfg.token });
  const tercatat = cfg.workers.find((w) => w.id === lokasi.get(owner.urusanId));
  let tidakAda: Hasil<T> | null = null;
  if (tercatat) {
    const r = await panggil(target(tercatat), path, schema, owner, fetcher, batasMs);
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
      r: await panggil(target(w), '/internal/sesi/status', skema.sesi, pemilik, fetcher),
    })),
  );
  // Lebih dari satu worker bisa memegang sesi urusan ini (mis. start yang putus lalu dialihkan): pakai yang hidup
  // dan paling baru, tutup sesi hidup lainnya (best-effort) supaya status/tiket tidak berganti-ganti worker.
  const ada = temu.flatMap((x) => (x.r.ok ? [{ w: x.w, r: x.r, s: x.r.data }] : []));
  ada.sort((a, b) => lebihUtama(a.s, b.s));
  const pemegang = ada[0];
  for (const x of ada.slice(1))
    if (!STATUS_AKHIR.has(x.s.status)) void akhiriYatim(cfg, x.w, pemilik, fetcher);
  if (pemegang) {
    ingatLokasi(owner.urusanId, pemegang.w.id);
    if (path === '/internal/sesi/status') return pemegang.r as Hasil<T>;
    return panggil(target(pemegang.w), path, schema, owner, fetcher, batasMs);
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
  butuh: ButuhSesiInternalSchema,
  kurang: z.object({ placeholder: z.array(z.string()), berkas: z.array(z.string()) }),
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

/**
 * Pemeriksa bahwa urusan milik akun yang sedang masuk, dipasang modul akun lewat
 * `pasangPemeriksaPemilikAkun` dan dipanggil di setiap endpoint pendamping (`akses`). Selama belum dipasang,
 * semua urusan lolos pemeriksaan ini; sesi peramban tetap terikat ke hash cookie `urusin_sid` di worker.
 * Galat di pemeriksa dianggap "bukan milik" (gagal tertutup).
 */
export type PemeriksaPemilikAkun = (request: Request, urusan: UrusanRow) => boolean | Promise<boolean>;
const izinkanSemua: PemeriksaPemilikAkun = () => true;
let pemeriksaPemilikAkun = izinkanSemua;

export function pasangPemeriksaPemilikAkun(f: PemeriksaPemilikAkun | undefined): void {
  pemeriksaPemilikAkun = f ?? izinkanSemua;
}

export async function milikAkun(request: Request, urusan: UrusanRow): Promise<boolean> {
  try {
    return (await pemeriksaPemilikAkun(request, urusan)) === true;
  } catch {
    return false;
  }
}
