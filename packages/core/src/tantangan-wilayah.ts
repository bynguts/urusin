import { EGRESS_PIHAK_KETIGA_WILAYAH, PORTAL_WILAYAH, type ProteksiPortal } from './registry-wilayah.js';

/**
 * Host pihak ketiga tantangan per jenis proteksi portal (warga sendiri yang menyelesaikannya). Ditulis tangan
 * di atas registry wilayah hasil generator; setiap host wajib terdaftar di `EGRESS_PIHAK_KETIGA`.
 */
/**
 * Host Turnstile/tantangan Cloudflare yang selalu ikut sesi wilayah: interstitial bisa muncul hanya dari jaringan
 * tertentu (probe: SG ya, ID tidak) walau registry proteksi kosong. `brunhild.` = endpoint flow Turnstile.
 */
export const HOST_TANTANGAN_CLOUDFLARE: readonly string[] = [
  'challenges.cloudflare.com',
  'brunhild.challenges.cloudflare.com',
];

export const HOST_TANTANGAN_PROTEKSI: Readonly<Partial<Record<ProteksiPortal, readonly string[]>>> = {
  cloudflare: HOST_TANTANGAN_CLOUDFLARE,
  turnstile: HOST_TANTANGAN_CLOUDFLARE,
  recaptcha: ['www.google.com', 'www.gstatic.com', 'www.recaptcha.net'],
  hcaptcha: ['js.hcaptcha.com', 'api.hcaptcha.com', 'newassets.hcaptcha.com'],
};

/**
 * Host tantangan pihak ketiga yang relevan untuk sesi wilayah `kode`: `EGRESS_PIHAK_KETIGA_WILAYAH` ditambah
 * host sesuai `proteksi` portal. Kosong bila wilayah tidak punya portal terdaftar. Satu sumber untuk web
 * (`params.hosts`) dan worker (validasi host sesi).
 */
export function hostsTantanganWilayah(kode: string): string[] {
  const p = Object.hasOwn(PORTAL_WILAYAH, kode) ? PORTAL_WILAYAH[kode] : undefined;
  if (!p) return [];
  return [
    ...new Set([
      ...EGRESS_PIHAK_KETIGA_WILAYAH,
      ...HOST_TANTANGAN_CLOUDFLARE,
      ...p.proteksi.flatMap((x) => HOST_TANTANGAN_PROTEKSI[x] ?? []),
    ]),
  ];
}
