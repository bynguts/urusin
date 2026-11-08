import { FakeProvider, fakeCompletion, type ChatMessage } from '@urusin/llm';
import { SEED_ENTRIES } from '@urusin/registry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { redactingProvider } from './guarded-llm.js';
import { dumpDb, makeEnv } from './testing.js';

/**
 * Properti PII dari korpus bypass: tidak satu pun NIK (16 digit) atau nomor HP yang lolos ke
 * (a) panggilan provider LLM, (b) jalur embed/rerank, (c) seluruh baris DB (termasuk span attrs).
 * Pemeriksa SENGAJA independen dari pemindai produksi: semua teks diproyeksikan ke "hanya digit ASCII"
 * (NFKC, buang karakter format, angka Unicode -> ASCII) lalu dicari substring digit aslinya.
 */

const RUNS = 60;
const NIK_UJI = ['3271', '0101', '0190', '0001'].join('');

function proyeksiDigit(s: string): string {
  const asciiDigit = (c: string): string => {
    const cp = c.codePointAt(0)!;
    if (cp <= 0x7f) return c;
    let base = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(base - 1))) base--;
    return String((cp - base) % 10);
  };
  return [...s.normalize('NFKC').replace(/\p{Cf}/gu, '')]
    .map((c) => (/\p{Nd}/u.test(c) ? asciiDigit(c) : ''))
    .join('');
}

// --- generator ---

const digit = fc.integer({ min: 0, max: 9 }).map(String);
const digits = (n: number) => fc.array(digit, { minLength: n, maxLength: n }).map((a) => a.join(''));
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const kodeKabKota = fc.constantFrom(...SEED_ENTRIES.map((e) => e.kodeKabKota));

/** NIK sah menurut struktur: kode kab/kota dikenal + tanggal lahir (hari 01-31 atau 41-71) + bulan 01-12. */
const nikRest = fc
  .tuple(
    digits(2),
    fc.oneof(fc.integer({ min: 1, max: 31 }), fc.integer({ min: 41, max: 71 })),
    fc.integer({ min: 1, max: 12 }),
    digits(2),
    digits(4),
  )
  .map(([cc, d, m, yy, urut]) => `${cc}${pad(d)}${pad(m)}${yy}${urut}`);
const nik = fc.tuple(kodeKabKota, nikRest).map(([k, r]) => ({ kode: k, rest: r, full: k + r }));

const bentukAngka = [
  (c: string) => c,
  (c: string) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0), // lebar-penuh
  (c: string) => String.fromCodePoint(c.charCodeAt(0) - 0x30 + 0x0660), // Arab-Indic
  (c: string) => String.fromCodePoint(c.charCodeAt(0) - 0x30 + 0x06f0), // Arab-Indic Timur
];
const bentuk = fc.integer({ min: 0, max: bentukAngka.length - 1 });
const pemisah = fc.constantFrom('', ' ', '  ', '   ', '/', '_', '.', '-', ' - ', '/ ', ' / ', '–');
const tersembunyi = fc.constantFrom('', '', '', '​', '‍', '­', '​­');
const awalan = fc.constantFrom('', '', 'nik ', 'NIK:', 'hp', 'no.', 'wa ', '(', '"');
const akhiran = fc.constantFrom('', ' ', '.', ',', ')', '!');

/** Sisipkan pemisah/karakter tersembunyi antar digit dengan pola pengelompokan acak. */
function susun(ds: string, f: number, gaps: string[], hidden: string[], pre: string, post: string): string {
  let out = pre;
  for (let i = 0; i < ds.length; i++) {
    out += bentukAngka[f]!(ds[i]!);
    if (i < ds.length - 1) out += hidden[i % hidden.length]! + gaps[i % gaps.length]!;
  }
  return out + post;
}

/** Gaya penulisan: pemisah hanya pada batas kelompok yang dipilih (selebihnya rapat). */
const gaya = (n: number) =>
  fc.record({
    f: bentuk,
    grup: fc.constantFrom(1, 2, 3, 4, 5, 6, 8, 16),
    gap: fc.array(pemisah, { minLength: 1, maxLength: 4 }),
    hid: fc.array(tersembunyi, { minLength: 1, maxLength: 4 }),
    pre: awalan,
    post: akhiran,
    n: fc.constant(n),
  });

function tulis(ds: string, g: ReturnType<typeof gaya> extends fc.Arbitrary<infer T> ? T : never): string {
  let out = g.pre;
  for (let i = 0; i < ds.length; i++) {
    out += bentukAngka[g.f]!(ds[i]!);
    if (i < ds.length - 1) {
      out += g.hid[i % g.hid.length]!;
      if ((i + 1) % g.grup === 0) out += g.gap[Math.floor(i / g.grup) % g.gap.length]!;
    }
  }
  return out + g.post;
}
void susun;

const hpNasional = fc
  .tuple(fc.constantFrom('812', '813', '821', '852', '857', '878', '895'), digits(6))
  .map(([a, b]) => a + b);
const hpBentuk = fc.constantFrom('0', '62', '+62', '+62 ', '(0)', '0 ');
const hp = fc.tuple(hpNasional, hpBentuk).map(([nas, awal]) => ({ nas, awal }));
type Gaya = fc.Arbitrary<unknown> extends never ? never : Parameters<typeof tulis>[1];
/** Awalan negara/nol ditulis apa adanya (tanda kurung/plus/spasi); sisanya mengikuti gaya pengelompokan acak. */
const tulisHp = (h: { nas: string; awal: string }, g: Gaya): string =>
  /^\d+$/.test(h.awal)
    ? tulis(h.awal + h.nas, { ...g, f: 0 })
    : h.awal + tulis(h.nas, { ...g, f: 0, pre: '' });

const BANTUAN = fc.constantFrom(
  'tolong bantu urus akta kelahiran',
  'ini data saya',
  'mohon dicek ya',
  'untuk anak saya',
);

function semuaPrompt(p: FakeProvider): string {
  return JSON.stringify(p.calls.map((c) => (c.kind === 'create' ? c.params.messages : [])));
}

const env = () => {
  const provider = new FakeProvider({
    replies: Array.from({ length: 4 }, () => fakeCompletion({ content: 'baik' })),
  });
  return { provider, e: makeEnv({ provider }) };
};

describe('properti: NIK berformat tidak lolos ke LLM maupun DB', () => {
  it('NIK 16 digit dalam segala bentuk penulisan', async () => {
    await fc.assert(
      fc.asyncProperty(nik, gaya(16), BANTUAN, async (n, g, bantuan) => {
        const { provider, e } = env();
        const u = e.store.createUrusan({ jenis: 'akta' });
        await runTurn(e.deps, { urusanId: u.id, userText: `${bantuan} ${tulis(n.full, g)} terima kasih` });
        expect(proyeksiDigit(semuaPrompt(provider))).not.toContain(n.full);
        expect(proyeksiDigit(dumpDb(e.store.db))).not.toContain(n.full);
      }),
      { numRuns: RUNS },
    );
  });

  it('NIK terbagi lintas bidang: kodeKabKota di urusan + 12 digit sisa di pesan', async () => {
    await fc.assert(
      fc.asyncProperty(nik, gaya(12), async (n, g) => {
        const { provider, e } = env();
        const u = e.store.createUrusan({ jenis: 'akta', kodeKabKota: n.kode });
        await runTurn(e.deps, { urusanId: u.id, userText: `nomornya ${tulis(n.rest, g)} ya` });
        expect(proyeksiDigit(semuaPrompt(provider))).not.toContain(n.rest);
        expect(proyeksiDigit(dumpDb(e.store.db))).not.toContain(n.rest);
      }),
      { numRuns: RUNS },
    );
  });

  it('NIK terbagi lintas turn: kodeKabKota baru diketahui sesudah turn pertama', async () => {
    await fc.assert(
      fc.asyncProperty(nik, gaya(12), async (n, g) => {
        const { provider, e } = env();
        const u = e.store.createUrusan({ jenis: 'akta' });
        await runTurn(e.deps, { urusanId: u.id, userText: `kota saya kode ${n.kode}` });
        e.store.db.prepare('UPDATE urusan SET kode_kabkota = ? WHERE id = ?').run(n.kode, u.id);
        await runTurn(e.deps, { urusanId: u.id, userText: `sisanya ${tulis(n.rest, g)}` });
        expect(proyeksiDigit(semuaPrompt(provider))).not.toContain(n.rest);
        expect(proyeksiDigit(dumpDb(e.store.db))).not.toContain(n.rest);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('properti: nomor HP berformat tidak lolos ke LLM maupun DB', () => {
  it('HP dengan awalan 0/62/+62, tanda kurung, spasi, strip, menempel huruf', async () => {
    await fc.assert(
      fc.asyncProperty(hp, gaya(0), BANTUAN, async (h, g, bantuan) => {
        const { provider, e } = env();
        const u = e.store.createUrusan({ jenis: 'akta' });
        const teks = tulisHp(h, g);
        await runTurn(e.deps, { urusanId: u.id, userText: `${bantuan} ${teks} ya` });
        expect(proyeksiDigit(semuaPrompt(provider))).not.toContain(h.nas);
        expect(proyeksiDigit(dumpDb(e.store.db))).not.toContain(h.nas);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('properti: jalur embed dan rerank (lapis provider terakhir)', () => {
  const tangkap = () => {
    const seen: string[] = [];
    const inner = {
      baseURL: 'x',
      create: async (p: { messages: ChatMessage[] }) => {
        seen.push(JSON.stringify(p.messages));
        return fakeCompletion({ content: '{}' });
      },
      stream: async (p: { messages: ChatMessage[] }) => {
        seen.push(JSON.stringify(p.messages));
        return (async function* () {})();
      },
      transcribe: async () => ({ text: '' }),
      embed: async (i: { texts: string[] }) => {
        seen.push(JSON.stringify(i.texts));
        return i.texts.map(() => [0]);
      },
    };
    return { seen, provider: redactingProvider(inner as never) };
  };

  it('embed dan chat (rewrite/rerank) tidak pernah membawa NIK atau HP, apa pun bentuknya', async () => {
    await fc.assert(
      fc.asyncProperty(nik, gaya(16), hp, gaya(0), async (n, g, h, gh) => {
        const { seen, provider } = tangkap();
        const teks = `dokumen ${tulis(n.full, g)} dan ${tulisHp(h, gh)}`;
        await provider.embed({ model: 'm', texts: [teks] });
        await provider.create({ model: 'm', messages: [{ role: 'user', content: teks }] } as never);
        const semua = proyeksiDigit(seen.join('\n'));
        expect(semua).not.toContain(n.full);
        expect(semua).not.toContain(h.nas);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('sanity pemeriksa', () => {
  it('proyeksiDigit menyatukan lebar-penuh, Arab-Indic, dan karakter tersembunyi', () => {
    expect(proyeksiDigit('１２​３ ٤٥­٦')).toBe('123456');
  });
  it('korpus: satu contoh per kategori memang mengandung digit aslinya sebelum disaring', () => {
    expect(
      proyeksiDigit(tulis(NIK_UJI, { f: 1, grup: 4, gap: ['  '], hid: ['​'], pre: 'NIK:', post: '', n: 16 })),
    ).toBe(NIK_UJI);
  });
});
