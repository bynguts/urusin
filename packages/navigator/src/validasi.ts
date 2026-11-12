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
  kendaliAkun,
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
    // `ketuk_tautan` hanya dibuat validator dari klik ke tautan pembuka (`tautanWarga`), tidak pernah oleh model:
    // model yang menyorot tombol Kirim sebagai "tautan" akan menyesatkan warga (review keamanan N1). `berhenti`
    // hanya serah akhir loop sendiri.
    alasan: AlasanSerahkanSchema.exclude(['ketuk_tautan', 'berhenti']),
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
/** Kolom isian (serah `isi_sendiri` hanya boleh menyorot salah satunya). */
const PERAN_KOLOM: readonly PeranElemen[] = [...PERAN_ISI, ...PERAN_PILIH, 'centang', 'berkas'];

/**
 * Tautan pembuka formulir yang dikelaskan `kirim` HANYA karena namanya ("Mulai Pendaftaran", "Ajukan
 * Permohonan", "Login / Register"; worker menandai `tautanPembuka`: GET, jalur/id/kelas/ikon bersih). AI boleh
 * membukanya: worker TIDAK mengekliknya, melainkan menavigasi GET ke href-nya di host allowlist (tanpa handler
 * JS halaman); gerbang tulis tetap menjaga. Halaman akhir tetap terkunci.
 */
export function tautanWarga(e: ElemenAmatan | undefined): boolean {
  return e?.peran === 'tautan' && e.kelas === 'kirim' && e.tautanPembuka === true;
}

/** Nama CTA pembuka pengajuan ("Mulai Pendaftaran", "Ajukan Permohonan", "Daftar Sekarang"). */
const RE_CTA_PENGAJUAN = /(^|[^a-z])(mulai|ajukan|buat|daftar)([^a-z]|$)/;
/** Bukan pengajuan layanan: daftar/masuk akun, batal, hapus, keluar. */
const RE_CTA_BUKAN = /akun|account|member|regist|login|masuk|keluar|logout|batal|hapus/;

/**
 * Tautan pembuka pengajuan di halaman pintu (tanpa kolom isian, bukan halaman akhir/masuk/tantangan): satu-satunya
 * nama `tautanWarga` yang berbunyi mulai/ajukan/buat/daftar layanan (probe 9171 PaceMace: "Mulai Pendaftaran"
 * di samping "Persyaratan & Formulir"). Tujuan Navigator selalu MENGAJUKAN urusan, jadi CTA ini didahulukan di
 * atas tautan informasi; loop membukanya sendiri (navigasi GET worker) tanpa bertanya ke model. Nama ganda
 * (menu ponsel + desktop) dihitung satu; dua CTA berbeda = ambigu, diputuskan model.
 */
export function pembukaPengajuan(p: Pengamatan): string | undefined {
  const s = p.sinyal;
  if (s.halamanAkhir || s.login || s.otp || s.captcha || s.tantangan || s.sukses) return undefined;
  if (p.elemen.some((e) => PERAN_KOLOM.includes(e.peran))) return undefined;
  const calon = new Map<string, string>();
  for (const e of p.elemen) {
    if (!tautanWarga(e)) continue;
    const nama = normalLabel(e.nama);
    if (!RE_CTA_PENGAJUAN.test(nama) || RE_CTA_BUKAN.test(nama)) continue;
    if (!calon.has(nama)) calon.set(nama, e.ref);
  }
  return calon.size === 1 ? [...calon.values()][0] : undefined;
}

/** Paling banyak kolom isian di beranda pintu akun (kotak cari / cek nomor pendaftaran), bukan formulir. */
const KOLOM_PINTU_MAKS = 2;

/**
 * Beranda pintu akun (QA prod Medan/Padang/Depok): kendali masuk akun warga terlihat ("Masuk", "LOGIN",
 * "Sudah punya akun? Masuk") bersama kendali daftar akun ("Daftar Akun Gratis") atau tanpa CTA pengajuan
 * layanan lain, belum ada sesi (tidak ada kendali keluar), bukan formulir (paling banyak 2 kolom: cari/cek
 * status), bukan halaman masuk/OTP/tantangan/akhir/sukses. Deterministik, tanpa LLM:
 * - `buka`: kendali masuk boleh dibuka AI (navigasi/ui_lokal/lanjut, atau tautan pembuka GET) = AI membuka
 *   halaman masuk sendiri; giliran warga diberikan di formulir masuk itu (`sinyal.login`).
 * - `serahkan`: kendali masuk hanya bisa ditekan warga (tombol masuk) = giliran `masuk_akun` dengan sorotan.
 */
export function pintuAkun(p: Pengamatan): { jenis: 'buka' | 'serahkan'; ref: string } | undefined {
  const s = p.sinyal;
  if (s.halamanAkhir || s.login || s.otp || s.captcha || s.tantangan || s.sukses) return undefined;
  const kolom = p.elemen.filter((e) => PERAN_KOLOM.includes(e.peran));
  if (kolom.length > KOLOM_PINTU_MAKS || kolom.some((e) => e.terlarang)) return undefined;
  const { masuk, daftar, keluar } = kendaliAkun(p.elemen);
  if (!masuk || keluar) return undefined;
  if (!daftar && pembukaPengajuan(p) !== undefined) return undefined;
  const bisaDibuka =
    (masuk.kelas !== undefined && KELAS_BOLEH_KLIK_AI.includes(masuk.kelas)) || tautanWarga(masuk);
  return { jenis: bisaDibuka ? 'buka' : 'serahkan', ref: masuk.ref };
}

/**
 * Petunjuk terbaik untuk warga saat AI tidak maju (loop tanpa kemajuan): kendali masuk akun, daftar akun, lalu
 * tautan/tombol layanan (layanan/permohonan/pengajuan/ajukan/mulai/formulir), lalu pembuka menu. undefined bila
 * tidak ada.
 */
export function petunjukWarga(p: Pengamatan): string | undefined {
  if (p.sinyal.halamanAkhir) return undefined;
  const akun = kendaliAkun(p.elemen);
  // Kendali akun yang hanya `kirim` (tombol submit formulir) tidak pernah disorot sebagai petunjuk.
  const akunBoleh = [akun.masuk, akun.daftar].find((e) => e && (e.kelas !== 'kirim' || tautanWarga(e)));
  if (!akun.keluar && akunBoleh) return akunBoleh.ref;
  const klik = p.elemen.filter(
    (e) =>
      PERAN_KLIK.includes(e.peran) &&
      e.kelas !== 'kirim' &&
      e.kelas !== 'tantangan' &&
      e.kelas !== 'tidak_pasti' &&
      !e.terlarang,
  );
  const layanan = klik.find((e) => RE_PETUNJUK_LAYANAN.test(normalLabel(e.nama)));
  if (layanan) return layanan.ref;
  return klik.find((e) => e.kelas === 'ui_lokal' && RE_PETUNJUK_MENU.test(normalLabel(e.nama)))?.ref;
}
const RE_PETUNJUK_LAYANAN = /layanan|permohonan|pengajuan|ajukan|mulai|formulir/;
const RE_PETUNJUK_MENU = /menu|navigasi|navigation|toggle/;

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

/** Alasan serah yang tidak pernah boleh menyorot tombol kirim akhir (hanya `final` yang boleh). */
const SERAH_BUKAN_KIRIM: readonly string[] = ['masuk_akun', 'otp', 'captcha', 'tidak_yakin'];

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
  // Data non-sensitif ke kolom yang labelnya tidak cocok: tetap boleh, tetapi ditandai di lembar (F8).
  return entri.sensitif ? 'asing' : 'samar';
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
  // Klik ke tautan pembuka formulir (`kirim` hanya karena namanya, F3) diterima: worker membukanya lewat
  // navigasi GET ke href-nya (host allowlist), bukan klik (QA prod gel6: "Buka 'Login / Register'" sebagai
  // giliran warga = langkah tambahan yang tidak perlu).
  const parsed = mentahSah;
  const rencanaHash = hashRencana({ ...parsed.data, host: p.host, sidik: p.sidik, seq: p.seq });
  const aksi = parsed.data.aksi as Aksi[];
  const katalog = opsi.katalog ?? new Set(Object.keys(KATALOG_PLACEHOLDER));
  const berkasBoleh = opsi.berkas ?? new Set(KATALOG_BERKAS);

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
      // Ref yang disorot harus diamati dan cocok dengan alasannya (sorotan = apa yang diminta dari warga).
      const e = a.ref !== undefined ? elemen.get(a.ref) : undefined;
      if (a.ref !== undefined && !e) langgar.add('REF_TIDAK_DIAMATI');
      if (a.alasan === 'ketuk_tautan' && (!tautanWarga(e) || p.sinyal.halamanAkhir))
        langgar.add('KELAS_KLIK_DITOLAK');
      if (a.alasan === 'isi_sendiri' && e && !PERAN_KOLOM.includes(e.peran)) langgar.add('PERAN_TIDAK_COCOK');
      // Tombol kirim akhir hanya boleh disorot sebagai serah `final`: sorotan "masuk akun"/"OTP"/"tidak yakin"
      // ke tombol Kirim menggiring warga menekan kiriman yang tidak mereka tinjau (review keamanan gel-4).
      // `isi_sendiri` sudah ditolak lewat peran, `ketuk_tautan` lewat `tautanWarga` di atas.
      if (SERAH_BUKAN_KIRIM.includes(a.alasan) && e?.kelas === 'kirim' && !tautanWarga(e))
        langgar.add('KELAS_KLIK_DITOLAK');
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
        if (
          (!e.kelas || !KELAS_BOLEH_KLIK_AI.includes(e.kelas)) &&
          (!tautanWarga(e) || p.sinyal.halamanAkhir)
        )
          langgar.add('KELAS_KLIK_DITOLAK');
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
