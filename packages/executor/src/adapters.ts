import {
  byName,
  byRole,
  click,
  countIncreased,
  css,
  fill,
  filePlaceholder,
  gate,
  matchOfficialOrigin,
  nav,
  placeholder,
  upload,
  urlIncludes,
  validateSteps,
  type Step,
} from '@urusin/core';

/**
 * Program adapter bawaan (kode, bukan tulisan LLM): `execution_request {adapterId, flowId, params}` dari
 * harness diterjemahkan menjadi langkah DSL di sini. Nilai pribadi selalu placeholder; eksekutor
 * me-resolve-nya tepat sebelum op dijalankan di halaman.
 */

export type Params = Record<string, string | number | boolean>;
export type Program = { origin: string; steps: Step[] };
export type BuildResult = { ok: true; program: Program } | { ok: false; code: string; message: string };

type FlowBuilder = (params: Params) => Step[] | string;
type Adapter = { origin: string; flows: Record<string, FlowBuilder> };

/** Telunjuk Sakti Wonogiri (struktur dari recon read-only; direplikasi di apps/fixtures). */
const TS_BASE = '/telunjuksakti/index.php';

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
  flows: {
    /** Login (warga: sandi + CAPTCHA), unggah berkas satu per satu (AI), Selesai (warga). */
    ajukan(params) {
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
  },
};

export const ADAPTERS: Readonly<Record<string, Adapter>> = Object.freeze({
  'telunjuk-sakti-wonogiri': telunjukSakti,
});

/** Bangun program tervalidasi (origin resmi + aturan DSL: final hanya lewat gate.human). */
export function buildProgram(adapterId: string, flowId: string, params: Params): BuildResult {
  const adapter = Object.hasOwn(ADAPTERS, adapterId) ? ADAPTERS[adapterId] : undefined;
  const flow = adapter && Object.hasOwn(adapter.flows, flowId) ? adapter.flows[flowId] : undefined;
  if (!adapter || !flow)
    return { ok: false, code: 'ADAPTER_TIDAK_ADA', message: 'adapter/flow tidak dikenal' };
  if (!matchOfficialOrigin(adapter.origin).ok)
    return { ok: false, code: 'ADAPTER_ORIGIN_NOT_OFFICIAL', message: 'origin adapter tidak resmi' };
  const steps = flow(params);
  if (typeof steps === 'string') return { ok: false, code: 'PARAM_TIDAK_SAH', message: steps };
  const valid = validateSteps(steps);
  if (!valid.ok)
    return {
      ok: false,
      code: valid.issues[0]?.code ?? 'STEP_SCHEMA_INVALID',
      message: 'langkah tidak valid',
    };
  return { ok: true, program: { origin: adapter.origin, steps: valid.steps } };
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
