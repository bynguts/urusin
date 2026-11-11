import { FakeProvider, fakeCompletion, type ChatMessage } from '@urusin/llm';
import { SEED_ENTRIES, kontakLayanan } from '@urusin/registry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import { redactingProvider } from './guarded-llm.js';
import { PiiInterceptor, redactForStorage } from './pii.js';
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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);
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
  }, 20_000);
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

describe('properti: nama (gadis) ibu kandung tidak lolos ke LLM maupun DB', () => {
  /** Potongan nama nyata (>= 4 huruf, bukan kata umum) agar pemeriksa substring tidak salah kena. */
  const BAGIAN_NAMA = [
    'Sutinah',
    'Wiryosentono',
    'Siti',
    'Aminah',
    'Wahyuni',
    "Ma'rifah",
    'Kartika',
    'Rahayu',
    'Endang',
    'Purwanti',
    'Theresia',
    'Yohana',
    'Lestari',
    'Sulastri',
    'Ngatini',
    'Juwariyah',
    'Kadek',
    'Nyoman',
    'Fatimah',
    'Zahra',
    'Margaretha',
    'Simanjuntak',
  ];
  const kapital = fc.constantFrom(
    (s: string) => s,
    (s: string) => s.toLowerCase(),
    (s: string) => s.toUpperCase(),
  );
  const nama = fc
    .tuple(
      fc.array(fc.constantFrom(...BAGIAN_NAMA), { minLength: 1, maxLength: 4 }),
      kapital,
      fc.constantFrom('', '', 'Hj. ', 'Ny. ', 'Almh. '),
    )
    .map(([bagian, k, gelar]) => ({ bagian, teks: gelar + bagian.map(k).join(' ') }));
  const POLA = fc.constantFrom(
    (n: string) => `nama ibu kandung ${n}`,
    (n: string) => `nama ibu kandung saya ${n}`,
    (n: string) => `Nama gadis ibu kandung: ${n}`,
    (n: string) => `nama gadis ibu ${n}`,
    (n: string) => `nama ibu kandung saya adalah ${n}`,
    (n: string) => `NAMA IBU KANDUNG = ${n}`,
    (n: string) => `nama ibu: ${n}`,
    (n: string) => `nama ibunya ${n}`,
    (n: string) => `ibu kandung saya bernama ${n}`,
    (n: string) => `ibu saya namanya ${n}`,
    (n: string) => `mama saya bernama ${n}`,
    (n: string) => `ibu kandung: ${n}`,
    (n: string) => `ibu kandung saya adalah ${n}`,
    (n: string) => `${n} adalah nama ibu kandung saya`,
    (n: string) => `${n} itu nama gadis ibu saya`,
  );
  const AWAL = fc.constantFrom('', 'Ini data saya biar cepat: ', 'tolong bantu urus KTP. ', 'Oh iya, ');
  const AKHIR = fc.constantFrom(
    '',
    '.',
    ', tolong urusin ya',
    '. Tolong urusin ya, saya di Wonogiri.',
    ' dan ayah saya Budi',
    ' tolong dibantu',
    '\nterima kasih',
  );

  const bocor = (teks: string, bagian: readonly string[]) =>
    bagian.filter((b) => new RegExp(`(^|[^\\p{L}])${b}([^\\p{L}]|$)`, 'iu').test(teks));

  it('redaksi teks: tidak satu pun bagian nama tersisa', () => {
    fc.assert(
      fc.property(nama, POLA, AWAL, AKHIR, (n, pola, awal, akhir) => {
        const teks = awal + pola(n.teks) + akhir;
        const out = new PiiInterceptor().redact(teks);
        expect(bocor(out.text, n.bagian)).toEqual([]);
        expect(out.text).toContain('NAMA_IBU}}');
        expect(bocor(redactForStorage(teks), n.bagian)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('end-to-end: nama ibu tidak ada di prompt LLM maupun baris DB (turns, audit, span)', async () => {
    await fc.assert(
      fc.asyncProperty(nama, POLA, AWAL, AKHIR, async (n, pola, awal, akhir) => {
        const { provider, e } = env();
        const u = e.store.createUrusan({ jenis: 'ktp' });
        await runTurn(e.deps, { urusanId: u.id, userText: awal + pola(n.teks) + akhir });
        expect(bocor(semuaPrompt(provider), n.bagian)).toEqual([]);
        expect(bocor(dumpDb(e.store.db), n.bagian)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  }, 20_000);

  it('contoh p07: NIK dan nama gadis ibu dalam satu pesan', async () => {
    const { provider, e } = env();
    const u = e.store.createUrusan({ jenis: 'ktp' });
    await runTurn(e.deps, {
      urusanId: u.id,
      userText: `KTP saya rusak, patah jadi dua. Ini data saya biar cepat: NIK ${NIK_UJI}, nama ibu kandung Sutinah Wiryosentono. Tolong urusin ya, saya di Wonogiri.`,
    });
    for (const s of [semuaPrompt(provider), dumpDb(e.store.db)]) {
      expect(s).not.toMatch(/Sutinah|Wiryosentono/i);
      expect(proyeksiDigit(s)).not.toContain(NIK_UJI);
    }
    expect(semuaPrompt(provider)).toContain('{{PEMOHON.NAMA_IBU}}');
    expect(semuaPrompt(provider)).toContain('Wonogiri');
  });

  it('kalimat tanpa nama ibu tidak ikut diredaksi', () => {
    for (const teks of [
      'Demi keamanan, tidak perlu membagikan NIK atau nama ibu kandung di chat.',
      'Siapa nama ibu kandung Anda?',
      'Ibu kandung saya sudah meninggal tahun lalu.',
      'nama ibu kandung harus sesuai KK',
      'Mohon lengkapi nama ibu kandung pada formulir.',
      'Ibu saya tinggal di Sleman.',
    ])
      expect(new PiiInterceptor().redact(teks).text).toBe(teks);
  });
});

describe('kontak resmi instansi bukan data pribadi', () => {
  it('WA/email resmi dari kanal-layanan tetap utuh; nomor dan email warga tetap diganti placeholder', () => {
    const resmi = kontakLayanan('3312', 'adminduk')!;
    const wa = resmi.whatsapp[0]!;
    const email = resmi.email[0]!;
    const out = new PiiInterceptor().redact(
      `Hubungi WhatsApp Disdukcapil ${wa} atau ${email}. Nomor saya 0812-0000-0001, email saya warga@gmail.com`, // pii-scan:allow
    ).text;
    expect(out).toContain(wa);
    expect(out).toContain(email);
    expect(out).not.toContain('0812-0000-0001'); // pii-scan:allow
    expect(out).not.toContain('warga@gmail.com'); // pii-scan:allow
    expect(redactForStorage(`WA resmi ${wa}`)).toContain(wa);
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
