import {
  byName,
  byRole,
  click,
  countIncreased,
  css,
  elementExists,
  fill,
  filePlaceholder,
  gate,
  matchOfficialOrigin,
  nav,
  placeholder,
  upload,
  urlIncludes,
  validateSteps,
  waitFor,
  type Check,
  type Step,
  type Target,
} from '@urusin/core';

/**
 * Program adapter bawaan (kode, bukan tulisan LLM): `execution_request {adapterId, flowId, params}` dari
 * harness diterjemahkan menjadi langkah DSL di sini. Nilai pribadi selalu placeholder; eksekutor
 * me-resolve-nya tepat sebelum op dijalankan di halaman.
 *
 * Selain langkah, adapter mendeklarasikan:
 * - `masuk`: probe status masuk akun. Dijalankan saat mulai dan setiap navigasi; bila warga keluar atau
 *   terlempar ke halaman login (bukan karena langkah alur sendiri), sesi beralih ke takeover `masuk_akun`.
 * - `bukti`: elemen halaman akhir yang memuat nomor pendaftaran/status. Dibaca best-effort SETELAH alur
 *   selesai, divalidasi skema ketat; gagal dibaca tidak menggagalkan alur.
 * - `bacaSaja`: alur cek status/informasi; selesai = hasil tampil di layar warga.
 * - `kamera`: alur yang butuh kamera (swafoto/verifikasi wajah). Peramban server tidak punya kamera:
 *   prasyarat dikerjakan warga di perangkatnya sendiri, jadi buildProgram menolak dan urusan dipandu.
 */

export type Params = Record<string, string | number | boolean>;
/** Probe masuk akun: `sudah` benar bila warga sedang masuk; `halaman` = jalur halaman login situs. */
export type ProbeMasuk = { sudah: Check; halaman: string };
export type BuktiSelektor = { nomor?: Target; status?: Target };
export type Program = {
  origin: string;
  steps: Step[];
  masuk?: ProbeMasuk | undefined;
  bukti?: BuktiSelektor | undefined;
  bacaSaja?: boolean | undefined;
};
export type BuildResult = { ok: true; program: Program } | { ok: false; code: string; message: string };

type FlowDef = {
  langkah: (params: Params) => Step[] | string;
  bukti?: BuktiSelektor;
  bacaSaja?: boolean;
  kamera?: boolean;
};
export type Adapter = { origin: string; masuk?: ProbeMasuk; flows: Record<string, FlowDef> };

/** Telunjuk Sakti Wonogiri (struktur dari recon read-only; direplikasi di apps/fixtures). */
const TS_BASE = '/telunjuksakti/index.php';
const TS_BARIS_TERBARU = '#tblPermohonan tbody tr:last-child';

/** Nama berkas placeholder dari param `berkas` ("ktp,kk"); default satu berkas `berkas1`. */
function berkasDari(params: Params): string[] | string {
  const raw = params.berkas === undefined ? 'berkas1' : String(params.berkas);
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0 || names.length > 10) return 'param berkas harus 1-10 nama';
  if (!names.every((n) => /^[A-Za-z][A-Za-z0-9_]*$/.test(n))) return 'nama berkas tidak valid';
  return names;
}

const telunjukSakti: Adapter = {
  origin: 'https://telunjuksakti.wonogirikab.go.id',
  masuk: { sudah: elementExists(css('a[href$="/users/logout"]')), halaman: `${TS_BASE}/users/login` },
  flows: {
    /** Login (warga: sandi + CAPTCHA), unggah berkas satu per satu (AI), Selesai (warga). */
    ajukan: {
      langkah(params) {
        const id = Number(params.layanan_id);
        if (!Number.isInteger(id) || id <= 0) return 'layanan_id harus bilangan bulat positif';
        const berkas = berkasDari(params);
        if (typeof berkas === 'string') return berkas;
        return [
          nav(`${TS_BASE}/users/login`),
          fill([css('#hp'), byName('hp')], placeholder('PEMOHON', 'HP')),
          gate.human('Giliran Anda: ketik kata sandi dan kode CAPTCHA, lalu tekan Masuk.', {
            until: urlIncludes(`${TS_BASE}/welcome`),
            highlight: [css('#loginSubmit'), byRole('button', 'Masuk')],
          }),
          nav(`${TS_BASE}/pendaftaran/uploadberkas/${id}`),
          ...berkas.flatMap((nama) => [
            upload([css('#uploadImage'), byName('uploadImage')], filePlaceholder(nama)),
            click([css('#btnSubmit'), byRole('button', 'Upload')], {
              effect: 'write',
              verify: countIncreased(css('.uploaded-item')),
              expectReload: true,
            }),
          ]),
          gate.human('Semua berkas terunggah. Periksa, lalu tekan Selesai sendiri untuk mengirim.', {
            until: urlIncludes(`${TS_BASE}/welcome/permohonan`),
            highlight: [css('#btnSelesai'), byRole('link', 'Selesai')],
          }),
        ];
      },
      bukti: {
        nomor: [css(`${TS_BARIS_TERBARU} td.no-registrasi`)],
        status: [css(`${TS_BARIS_TERBARU} td.status`)],
      },
    },
    /** Daftar permohonan milik warga (butuh login: probe masuk_akun bila belum/sudah keluar). */
    cek_status: {
      langkah: () => [nav(`${TS_BASE}/welcome/permohonan`), waitFor(elementExists(css('#tblPermohonan')))],
      bukti: {
        nomor: [css(`${TS_BARIS_TERBARU} td.no-registrasi`)],
        status: [css(`${TS_BARIS_TERBARU} td.status`)],
      },
      bacaSaja: true,
    },
  },
};

/**
 * Samsat DKI: info PKB per nomor polisi (recon rea-samsat-oss: form `FINPPKB`, `nb` 4 digit, `nc` huruf
 * akhiran, Turnstile tertanam). Turnstile = takeover verifikasi_situs (warga), AI menahan semua langkah
 * sampai token ada. Struktur halaman hasil belum teramati: hasil dibaca warga di layar.
 */
const samsatDki: Adapter = {
  origin: 'https://samsat-pkb2.jakarta.go.id',
  flows: {
    cek_pkb: {
      langkah: () => [
        nav('/'),
        fill([byName('nb'), css('#validationTooltipNopol')], placeholder('KENDARAAN', 'NOPOL_ANGKA')),
        fill([byName('nc')], placeholder('KENDARAAN', 'NOPOL_HURUF')),
        waitFor(elementExists([css('input[name="cf-turnstile-response"]'), css('.cf-turnstile')])),
        click([css('#submit'), byName('BTNSUB')], { effect: 'read', expectReload: true }),
      ],
      bacaSaja: true,
    },
  },
};

/** OSS: widget publik "Pencarian NIB" di oss.go.id/id (Turnstile saat mencari; hasil dibaca warga). */
const oss: Adapter = {
  origin: 'https://oss.go.id',
  flows: {
    cari_nib: {
      langkah: () => [
        nav('/id'),
        fill([css('input[placeholder="Masukkan NIB"]')], placeholder('USAHA', 'NIB')),
        click([byRole('button', 'Cari NIB'), css('button[aria-label="Cari NIB"]')], { effect: 'read' }),
      ],
      bacaSaja: true,
    },
  },
};

/**
 * Klampid Surabaya: pelacakan publik kitir (captcha matematika dijawab warga). DOM halaman asli belum
 * teramati (SPA); selektor mengikuti replika apps/fixtures dengan alternatif semantik.
 */
const klampidSurabaya: Adapter = {
  origin: 'https://wargaklampid-dispendukcapil.surabaya.go.id',
  flows: {
    cek_status: {
      langkah: () => [
        nav('/tracking'),
        fill([css('#kitir'), byName('kitir')], placeholder('URUSAN', 'KITIR')),
        gate.human('Jawab pertanyaan keamanan, lalu tekan Cari.', {
          until: elementExists([css('#tracking-result'), css('#tracking-empty'), css('#tracking-error')]),
          highlight: [css('#btnCari'), byRole('button', 'Cari')],
        }),
      ],
      bukti: {
        nomor: [css('#submission-number')],
        status: [css('#tblHistory tbody tr:last-child td:first-child')],
      },
      bacaSaja: true,
    },
  },
};

/** Si D'nOK Semarang: cek status 16 karakter + captcha matematika (warga); hasil di #container-status. */
const sidnokSemarang: Adapter = {
  origin: 'https://sidnok.semarangkota.go.id',
  flows: {
    cek_status: {
      langkah: () => [
        nav('/cek-status'),
        fill([css('#kode_layanan'), byName('kode_layanan')], placeholder('URUSAN', 'KODE_PELAYANAN')),
        gate.human('Jawab pertanyaan keamanan, lalu tekan Cek Status.', {
          until: elementExists([css('#container-status .box'), css('.swal2-popup')]),
          highlight: [byRole('button', 'Cek Status'), css('#cek-form button')],
        }),
      ],
      bukti: { status: [css('#container-status .box .font-medium')] },
      bacaSaja: true,
    },
  },
};

export const ADAPTERS: Readonly<Record<string, Adapter>> = Object.freeze({
  'telunjuk-sakti-wonogiri': telunjukSakti,
  'samsat-dki': samsatDki,
  'oss-nib': oss,
  'klampid-surabaya': klampidSurabaya,
  'sidnok-semarang': sidnokSemarang,
});

/** Bangun program tervalidasi (origin resmi + aturan DSL: final hanya lewat gate.human). */
export function buildProgram(
  adapterId: string,
  flowId: string,
  params: Params,
  adapters: Readonly<Record<string, Adapter>> = ADAPTERS,
): BuildResult {
  const adapter = Object.hasOwn(adapters, adapterId) ? adapters[adapterId] : undefined;
  const flow = adapter && Object.hasOwn(adapter.flows, flowId) ? adapter.flows[flowId] : undefined;
  if (!adapter || !flow)
    return { ok: false, code: 'ADAPTER_TIDAK_ADA', message: 'adapter/flow tidak dikenal' };
  if (!matchOfficialOrigin(adapter.origin).ok)
    return { ok: false, code: 'ADAPTER_ORIGIN_NOT_OFFICIAL', message: 'origin adapter tidak resmi' };
  if (flow.kamera)
    return {
      ok: false,
      code: 'PERLU_PERANGKAT_WARGA',
      message:
        'Langkah ini butuh kamera (swafoto). Kerjakan di perangkat Anda sendiri; Urusin memandu langkahnya.',
    };
  const steps = flow.langkah(params);
  if (typeof steps === 'string') return { ok: false, code: 'PARAM_TIDAK_SAH', message: steps };
  const valid = validateSteps(steps);
  if (!valid.ok)
    return {
      ok: false,
      code: valid.issues[0]?.code ?? 'STEP_SCHEMA_INVALID',
      message: 'langkah tidak valid',
    };
  return {
    ok: true,
    program: {
      origin: adapter.origin,
      steps: valid.steps,
      ...(adapter.masuk ? { masuk: adapter.masuk } : {}),
      ...(flow.bukti ? { bukti: flow.bukti } : {}),
      ...(flow.bacaSaja ? { bacaSaja: true } : {}),
    },
  };
}

/** Indeks gate.human terakhir di level atas: gerbang pengiriman akhir (tombol Kirim/Selesai). */
export function finalGateIndex(steps: readonly Step[]): number {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]?.op === 'gate.human') return i;
  return -1;
}

/** Placeholder vault dan nama berkas yang dibutuhkan program (untuk diminta dari perangkat warga). */
export function requiredData(steps: readonly Step[]): { placeholder: string[]; berkas: string[] } {
  const ph = new Set<string>();
  const files = new Set<string>();
  const walk = (list: readonly Step[]) => {
    for (const s of list) {
      if (s.op === 'fill' || s.op === 'select')
        for (const m of s.value.matchAll(/\{\{[^{}]+\}\}/g)) ph.add(m[0]);
      if (s.op === 'upload') {
        const m = /^\{\{FILE:([A-Za-z][A-Za-z0-9_]*)\}\}$/.exec(s.file);
        if (m?.[1]) files.add(m[1]);
      }
      if (s.op === 'forEach') walk(s.steps);
      if (s.op === 'branch') {
        walk(s.then);
        walk(s.else ?? []);
      }
    }
  };
  walk(steps);
  return { placeholder: [...ph], berkas: [...files] };
}
