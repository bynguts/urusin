/** Skrip widget Cloudflare Turnstile (host diizinkan di CSP `script-src`/`frame-src`, vite.config.ts). */
export const SKRIP_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type ApiTurnstile = {
  render(el: HTMLElement, opsi: { sitekey: string; language?: string }): string | undefined;
  remove(id: string): void;
  reset(id: string): void;
};

let muat: Promise<ApiTurnstile> | undefined;
let apiAktif: ApiTurnstile | undefined;
const widget = new Set<string>();

/** Token Turnstile sekali pakai: setelah form terkirim tanpa pindah halaman, minta token baru. */
export function ulangTurnstile(): void {
  for (const id of widget) apiAktif?.reset(id);
}

function muatSkrip(): Promise<ApiTurnstile> {
  muat ??= new Promise<ApiTurnstile>((ok, gagal) => {
    const s = document.createElement('script');
    s.src = SKRIP_TURNSTILE;
    s.async = true;
    s.onload = () => {
      const api = (window as unknown as { turnstile?: ApiTurnstile }).turnstile;
      if (api) ok(api);
      else gagal(new Error('turnstile tidak termuat'));
    };
    s.onerror = () => gagal(new Error('turnstile tidak termuat'));
    document.head.append(s);
  }).catch((e: unknown) => {
    muat = undefined; // boleh dicoba lagi saat halaman dibuka ulang
    throw e;
  });
  return muat;
}

/**
 * Action Svelte: render widget Turnstile di dalam `<form>` (hanya bila server memberi site key, yaitu
 * TURNSTILE_SECRET_KEY dikonfigurasi). Widget menambahkan input `cf-turnstile-response` ke form, yang dibaca
 * server ("Masuk sebagai juri", masuk setelah 3 kegagalan). Gagal memuat = tanpa token; server menjawab jujur.
 */
export function turnstile(el: HTMLElement, siteKey: string) {
  let id: string | undefined;
  let api: ApiTurnstile | undefined;
  let lepas = false;
  muatSkrip()
    .then((a) => {
      if (lepas) return;
      api = apiAktif = a;
      id = a.render(el, { sitekey: siteKey, language: 'id' });
      if (id) widget.add(id);
    })
    .catch(() => {});
  return {
    destroy() {
      lepas = true;
      if (api && id) {
        widget.delete(id);
        api.remove(id);
      }
    },
  };
}
