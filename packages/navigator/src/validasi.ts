import { createHash } from 'node:crypto';
import {
  AKSI_TERMINAL,
  AlasanSerahkanSchema,
  KELAS_BOLEH_KLIK_AI,
  NamaBerkasAdapterSchema,
  PlaceholderVaultSchema,
  RefSchema,
  RencanaHalamanSchema,
  SebabTidakBisaSchema,
  type Aksi,
  type ElemenAmatan,
  type KolomButuh,
  type Pengamatan,
  type PeranElemen,
  type RencanaHalaman,
} from '@urusin/contracts';
import { z } from 'zod';

/**
 * Validator rencana Navigator (ADR 0030, invariant 3). Model hanya boleh menjawab dengan ref elemen yang
 * diamati, placeholder katalog, indeks opsi teramati, atau boolean; setiap penolakan punya id aturan yang
 * dicatat di jejak audit. Validator ini lapis web; worker mengulang klasifikasi klik di halaman saat klik.
 */

export const ATURAN = [
  'SKEMA_TIDAK_SAH',
  'TERMINAL_GANDA',
  'TERMINAL_BUKAN_AKHIR',
  'REF_TIDAK_DIAMATI',
  'REF_GANDA',
  'PLACEHOLDER_TIDAK_DIKENAL',
  'BERKAS_TIDAK_DIKENAL',
  'OPSI_DI_LUAR_RENTANG',
  'PERAN_TIDAK_COCOK',
  'KOLOM_TERLARANG',
  'KOLOM_DIISI_WARGA',
  'NIK_KOLOM_TIDAK_LAZIM',
  'KELAS_KLIK_DITOLAK',
  'KLIK_BUKAN_AKHIR',
  'HALAMAN_AKHIR_TERKUNCI',
] as const;
export type IdAturan = (typeof ATURAN)[number];

/**
 * Skema KETAT keluaran model: objek tanpa properti tambahan (URL/teks bebas di field lain ditolak, bukan
 * dibuang diam-diam). Setiap rencana yang lolos di sini juga sah menurut `RencanaHalamanSchema` kontrak.
 */
const AksiKetatSchema = z.discriminatedUnion('jenis', [
  z.strictObject({ jenis: z.literal('isi'), ref: RefSchema, nilai: PlaceholderVaultSchema }),
  z.strictObject({
    jenis: z.literal('pilih'),
    ref: RefSchema,
    nilai: z.union([PlaceholderVaultSchema, z.strictObject({ opsi: z.number().int().min(0).max(39) })]),
  }),
  z.strictObject({ jenis: z.literal('centang'), ref: RefSchema, nilai: z.boolean() }),
  z.strictObject({ jenis: z.literal('unggah'), ref: RefSchema, berkas: NamaBerkasAdapterSchema }),
  z.strictObject({ jenis: z.literal('klik'), ref: RefSchema }),
  z.strictObject({
    jenis: z.literal('serahkan'),
    alasan: AlasanSerahkanSchema,
    ref: RefSchema.optional(),
  }),
  z.strictObject({ jenis: z.literal('tidak_bisa'), sebab: SebabTidakBisaSchema }),
]);
/** Skema structured output (json_schema strict) untuk satu rencana halaman. */
export const RencanaKetatSchema = z.strictObject({ aksi: z.array(AksiKetatSchema).min(1).max(25) });

type EntriKatalog = {
  /** Label untuk prompt dan lembar persetujuan (bukan dari halaman). */
  label: string;
  /** Pola label kolom portal yang lazim untuk data ini (dicocokkan pada label yang dinormalisasi). */
  pola: RegExp;
  /** Nomor identitas: hanya ke kolom yang tampak seperti kolom itu. */
  sensitif?: true;
};

/**
 * Katalog placeholder yang boleh dipakai model: data pemohon di Data Diri (cermin `fieldDataDiri` web, diuji
 * di apps/web). Satu placeholder kanonik per field.
 */
export const KATALOG_PLACEHOLDER: Readonly<Record<string, EntriKatalog>> = {
  '{{PEMOHON.NIK}}': {
    label: 'NIK',
    pola: /\bnik\b|nomor induk kependudukan|no\.? ?induk kependudukan/,
    sensitif: true,
  },
  '{{PEMOHON.KK}}': {
    label: 'Nomor KK',
    pola: /\b(no\.?|nomor) ?kk\b|\bkk\b|kartu keluarga/,
    sensitif: true,
  },
  '{{PEMOHON.NAMA}}': { label: 'Nama lengkap', pola: /\bnama\b/ },
  '{{PEMOHON.TEMPAT_LAHIR}}': { label: 'Tempat lahir', pola: /tempat lahir/ },
  '{{PEMOHON.TANGGAL_LAHIR}}': { label: 'Tanggal lahir', pola: /tanggal lahir|tgl\.? lahir/ },
  '{{PEMOHON.JENIS_KELAMIN}}': { label: 'Jenis kelamin', pola: /jenis kelamin|kelamin|gender/ },
  '{{PEMOHON.AGAMA}}': { label: 'Agama', pola: /agama/ },
  '{{PEMOHON.PEKERJAAN}}': { label: 'Pekerjaan', pola: /pekerjaan/ },
  '{{PEMOHON.ALAMAT}}': { label: 'Alamat', pola: /alamat/ },
  '{{PEMOHON.RT}}': { label: 'RT', pola: /\brt\b/ },
  '{{PEMOHON.RW}}': { label: 'RW', pola: /\brw\b/ },
  '{{PEMOHON.KELURAHAN}}': { label: 'Kelurahan/desa', pola: /kelurahan|desa/ },
  '{{PEMOHON.KECAMATAN}}': { label: 'Kecamatan', pola: /kecamatan/ },
  '{{PEMOHON.KODE_POS}}': { label: 'Kode pos', pola: /kode ?pos/ },
  '{{PEMOHON.HP}}': { label: 'Nomor HP', pola: /\bhp\b|handphone|telepon|telp|ponsel|whatsapp|\bwa\b/ },
  '{{PEMOHON.EMAIL}}': { label: 'Email', pola: /e-?mail|surel/ },
};

/** Berkas Dokumen akun yang boleh diunggah model (`berkas:<JENIS>` di daftar write). */
export const KATALOG_BERKAS: readonly string[] = ['KTP', 'KK', 'AKTA', 'SURAT', 'FOTO', 'BUKU_NIKAH'];

/** Label kolom yang samar untuk nomor identitas: diizinkan tetapi ditandai `tidakLazim` di lembar. */
const IDENTITAS_SAMAR = /identitas|\bktp\b|\bnomor\b|\bno\b|\bid\b/;

/** Normalisasi label tak tepercaya: NFKD, buang diakritik dan karakter tak terlihat, huruf kecil. */
export function normalLabel(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PERAN_ISI: readonly PeranElemen[] = ['teks', 'angka', 'tanggal', 'area'];
const PERAN_PILIH: readonly PeranElemen[] = ['pilihan', 'radio'];
const PERAN_KLIK: readonly PeranElemen[] = ['tombol', 'tautan', 'tab'];

/**
 * Tautan pembuka formulir yang dikelaskan `kirim` HANYA karena namanya ("Mulai Pendaftaran", "Ajukan
 * Permohonan"; worker menandai `tautanPembuka`). AI tidak mengekliknya; warga yang mengetuk.
 */
export function tautanWarga(e: ElemenAmatan | undefined): boolean {
  return e?.peran === 'tautan' && e.kelas === 'kirim' && e.tautanPembuka === true;
}

export type OpsiValidasi = {
  /** Placeholder yang boleh dipakai (bawaan: semua kunci KATALOG_PLACEHOLDER). */
  katalog?: ReadonlySet<string>;
  /** Nama berkas yang boleh diunggah (bawaan: KATALOG_BERKAS). */
  berkas?: ReadonlySet<string>;
};

export type PutusanValidasi =
  | {
      ok: true;
      rencana: RencanaHalaman;
      rencanaHash: string;
      /** Baris lembar "Izinkan AI mengisi?" untuk halaman ini (placeholder unik, label portal). */
      kolom: KolomButuh[];
      /** Nama berkas yang akan diunggah (butuh persetujuan juga). */
      berkas: string[];
    }
  | { ok: false; aturan: IdAturan[]; rencanaHash: string };

/** JSON kanonik (kunci terurut) untuk hash yang stabil di web dan worker. */
export function kanonik(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(kanonik).join(',')}]`;
  if (v !== null && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${kanonik((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/**
 * sha256 hex atas objek kanonik. Rencana halaman di-hash bersama halamannya (`{aksi, host, sidik, seq}`, lihat
 * `validasiRencana`), jadi rencana identik di halaman lain tidak berbagi persetujuan.
 */
export function hashRencana(r: unknown): string {
  return createHash('sha256').update(kanonik(r)).digest('hex');
}

const tulisan = (a: Aksi): boolean =>
  a.jenis === 'isi' || a.jenis === 'pilih' || a.jenis === 'centang' || a.jenis === 'unggah';

/** Seberapa lazim kolom berlabel `nama` untuk placeholder `ph`: lazim, samar (ditandai), atau asing. */
export function kelaziman(
  ph: string,
  e: Pick<ElemenAmatan, 'nama' | 'petunjuk' | 'peran'>,
): 'lazim' | 'samar' | 'asing' {
  const entri = Object.hasOwn(KATALOG_PLACEHOLDER, ph) ? KATALOG_PLACEHOLDER[ph] : undefined;
  if (!entri) return 'asing';
  const label = normalLabel(`${e.nama} ${e.petunjuk ?? ''}`);
  if (entri.pola.test(label)) return 'lazim';
  if (entri.sensitif && e.peran !== 'area' && IDENTITAS_SAMAR.test(label)) return 'samar';
  return entri.sensitif ? 'asing' : 'lazim';
}

/**
 * Validasi satu rencana terhadap pengamatan yang menjadi dasarnya. Mengumpulkan SEMUA pelanggaran (urutan
 * aturan stabil, tanpa duplikat). Rencana mentah dari model diterima sebagai `unknown`.
 */
export function validasiRencana(mentah: unknown, p: Pengamatan, opsi: OpsiValidasi = {}): PutusanValidasi {
  const mentahSah = RencanaKetatSchema.safeParse(mentah);
  if (!mentahSah.success)
    return { ok: false, aturan: ['SKEMA_TIDAK_SAH'], rencanaHash: hashRencana(mentah ?? null) };
  const elemen = new Map(p.elemen.map((e) => [e.ref, e]));
  // Klik terakhir ke tautan pembuka formulir (`kirim` hanya karena namanya, F3) diganti serah ke warga
  // `ketuk_tautan`: AI tidak pernah mengekliknya; warga yang mengetuk, lalu AI melanjutkan. Hash dihitung
  // dari rencana yang sudah diganti (yang benar-benar dijalankan).
  const parsed = {
    ...mentahSah,
    data: { ...mentahSah.data, aksi: gantiKetukTautan(mentahSah.data.aksi as Aksi[]) },
  };
  const rencanaHash = hashRencana({ ...parsed.data, host: p.host, sidik: p.sidik, seq: p.seq });
  const aksi = parsed.data.aksi;
  const katalog = opsi.katalog ?? new Set(Object.keys(KATALOG_PLACEHOLDER));
  const berkasBoleh = opsi.berkas ?? new Set(KATALOG_BERKAS);

  function gantiKetukTautan(a: Aksi[]): Aksi[] {
    const akhir = a.at(-1);
    if (akhir?.jenis !== 'klik' || p.sinyal.halamanAkhir || !tautanWarga(elemen.get(akhir.ref))) return a;
    return [...a.slice(0, -1), { jenis: 'serahkan', alasan: 'ketuk_tautan', ref: akhir.ref }];
  }
  const langgar = new Set<IdAturan>();
  const kolom = new Map<string, KolomButuh>();
  const berkas = new Set<string>();
  const refTulis = new Set<string>();

  const terminal = aksi.filter((a) => AKSI_TERMINAL.includes(a.jenis));
  if (terminal.length > 1) langgar.add('TERMINAL_GANDA');
  aksi.forEach((a, i) => {
    if (AKSI_TERMINAL.includes(a.jenis) && i !== aksi.length - 1) langgar.add('TERMINAL_BUKAN_AKHIR');
  });

  aksi.forEach((a, i) => {
    if (a.jenis === 'tidak_bisa') return;
    if (a.jenis === 'serahkan') {
      if (a.ref !== undefined && !elemen.has(a.ref)) langgar.add('REF_TIDAK_DIAMATI');
      return;
    }
    const e = elemen.get(a.ref);
    if (!e) {
      langgar.add('REF_TIDAK_DIAMATI');
      return;
    }
    if (tulisan(a)) {
      if (refTulis.has(a.ref)) langgar.add('REF_GANDA');
      refTulis.add(a.ref);
      if (e.terlarang) langgar.add('KOLOM_TERLARANG');
      if (e.isian === 'terisi_warga') langgar.add('KOLOM_DIISI_WARGA');
    }
    switch (a.jenis) {
      case 'isi': {
        if (!PERAN_ISI.includes(e.peran)) langgar.add('PERAN_TIDAK_COCOK');
        catatPlaceholder(a.nilai, e);
        break;
      }
      case 'pilih': {
        if (!PERAN_PILIH.includes(e.peran)) langgar.add('PERAN_TIDAK_COCOK');
        if (typeof a.nilai === 'string') catatPlaceholder(a.nilai, e);
        else if (!e.opsi || a.nilai.opsi >= e.opsi.length) langgar.add('OPSI_DI_LUAR_RENTANG');
        break;
      }
      case 'centang':
        if (e.peran !== 'centang') langgar.add('PERAN_TIDAK_COCOK');
        break;
      case 'unggah':
        if (e.peran !== 'berkas') langgar.add('PERAN_TIDAK_COCOK');
        if (!berkasBoleh.has(a.berkas)) langgar.add('BERKAS_TIDAK_DIKENAL');
        else berkas.add(a.berkas);
        break;
      case 'klik': {
        if (!PERAN_KLIK.includes(e.peran)) langgar.add('PERAN_TIDAK_COCOK');
        if (e.terlarang) langgar.add('KOLOM_TERLARANG');
        if (!e.kelas || !KELAS_BOLEH_KLIK_AI.includes(e.kelas)) langgar.add('KELAS_KLIK_DITOLAK');
        if (p.sinyal.halamanAkhir) langgar.add('HALAMAN_AKHIR_TERKUNCI');
        // Klik mengganti halaman: ref sesudahnya basi. Satu klik saja, sebagai aksi terakhir.
        if (i !== aksi.length - 1) langgar.add('KLIK_BUKAN_AKHIR');
        break;
      }
    }
  });

  function catatPlaceholder(ph: string, e: ElemenAmatan): void {
    if (!katalog.has(ph) || !Object.hasOwn(KATALOG_PLACEHOLDER, ph)) {
      langgar.add('PLACEHOLDER_TIDAK_DIKENAL');
      return;
    }
    const lazim = kelaziman(ph, e);
    if (lazim === 'asing') {
      langgar.add('NIK_KOLOM_TIDAK_LAZIM');
      return;
    }
    if (e.isian === ph) return;
    const labelPortal = e.nama.slice(0, 120);
    const ada = kolom.get(`${ph}\n${labelPortal}`);
    kolom.set(`${ph}\n${labelPortal}`, {
      placeholder: ph,
      labelPortal,
      ...(lazim === 'samar' || ada?.tidakLazim ? { tidakLazim: true } : {}),
    });
  }

  if (langgar.size > 0) return { ok: false, aturan: ATURAN.filter((a) => langgar.has(a)), rencanaHash };
  // Pagar akhir: kontrak (satu terminal, di akhir) tetap berlaku.
  const kontrak = RencanaHalamanSchema.safeParse(parsed.data);
  if (!kontrak.success) return { ok: false, aturan: ['SKEMA_TIDAK_SAH'], rencanaHash };
  return {
    ok: true,
    rencana: kontrak.data,
    rencanaHash,
    kolom: [...kolom.values()],
    berkas: [...berkas],
  };
}
