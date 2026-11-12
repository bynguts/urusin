import type { Pengamatan } from '@urusin/contracts';
import { PiiInterceptor, newNonce, redactingProvider, spotlight, spotlightPolicyText } from '@urusin/harness';
import {
  StructuredOutputError,
  generateStructured,
  type CapabilityFlags,
  type ChatMessage,
  type ChatProvider,
  type RequestOptions,
} from '@urusin/llm';
import { blokPetunjukPortal } from './petunjuk.js';
import {
  KATALOG_BERKAS,
  KATALOG_PLACEHOLDER,
  RencanaKetatSchema,
  tautanWarga,
  type IdAturan,
} from './validasi.js';

/**
 * Prompt Navigator (ADR 0030, invariant 3/4). Semua teks halaman (judul, jalur, label, petunjuk, opsi, galat,
 * teks) adalah DATA tak tepercaya: diredaksi PII lebih dulu, lalu dibungkus `spotlight('dom')`. Provider
 * dibungkus `redactingProvider` sebagai lapis terakhir. Keluaran lewat structured output (json_schema strict),
 * lalu tetap divalidasi `validasiRencana`.
 */

export type KonfigLlm = {
  provider: ChatProvider;
  model: string;
  caps: Pick<CapabilityFlags, 'json_schema_strict' | 'tools'>;
};

export type MasukanPrompt = {
  pengamatan: Pengamatan;
  /** Judul urusan dari registry (bukan teks warga), mis. "Kelahiran". */
  tujuan: string;
  katalog?: readonly string[];
  berkas?: readonly string[];
  /** Kode kab/kota KTP: membantu pendeteksi NIK yang terpecah. */
  kodeKabKota?: string | null | undefined;
  /** Id aturan validator dari rencana sebelumnya di halaman yang sama (umpan balik, bukan teks bebas). */
  umpanBalik?: readonly IdAturan[];
  nonce?: string;
  /** Petunjuk peta portal TEPERCAYA dari registry (ADR 0034), masuk pesan sistem; lihat `blokPetunjukPortal`. */
  petunjukPortal?: string | undefined;
  /** Halaman daftar/buat akun portal (`halamanDaftarAkun`): sinyal `daftar_akun` + aturannya. */
  daftarAkun?: boolean;
  /** Baris sinyal peringkat tautan (hanya ref, tanpa teks halaman); lihat peringkat-tautan.ts. */
  petunjukTautan?: string | null | undefined;
};

export const NAMA_SKEMA = 'rencana_halaman';

/**
 * Deret 12+ angka (angka Unicode apa pun, boleh dipisah spasi/titik/garis/karakter tak terlihat, atau 1-4 tanda
 * baca lain seperti koma/titik dua/" ** ") di teks
 * halaman: potongan NIK/KK yang terpotong batas panjang worker tidak dikenali pemindai NIK, jadi ikut diganti.
 * Model tidak butuh angka panjang untuk memilih ref.
 */
const DERET_ANGKA = /\p{Nd}(?:(?:[\s.\-/\p{Cf}]*|[^\p{L}\p{Nd}]{0,4})\p{Nd}){11,}/gu;

function aturanSistem(tujuan: string): string {
  return [
    `Kamu adalah Navigator Urusin. Warga sudah menyetujui urusan "${tujuan}" dan Browser Pendamping sedang membuka satu halaman portal resmi. Susun SATU rencana aksi untuk halaman ini.`,
    'ATURAN KERAS:',
    '- Jawab HANYA dengan JSON {"aksi":[...]} sesuai skema. Tanpa teks lain.',
    '- Rujuk elemen HANYA dengan ref dari daftar ELEMEN (mis. e3). Jangan mengarang ref.',
    '- Isi kolom HANYA dengan placeholder dari KATALOG DATA, ke kolom yang labelnya memang meminta data itu. JANGAN PERNAH menulis nilai, URL, teks bebas, tombol keyboard, atau kode.',
    '- Pilihan: pakai {"opsi":n} dengan n indeks dari daftar opsi elemen itu, atau placeholder katalog.',
    '- Unggah: pakai nama berkas dari KATALOG BERKAS.',
    '- Klik HANYA elemen dengan kelas navigasi, ui_lokal, atau lanjut. Paling banyak satu klik, dan harus aksi terakhir.',
    '- Tautan kelas tautan_warga membuka formulir layanan tetapi hanya boleh diketuk warga: bila formulir yang dituju ada di balik tautan itu, rencanakan klik ke ref itu sebagai aksi terakhir (sistem menyerahkannya ke warga).',
    '- Tujuanmu MENGAJUKAN urusan: di halaman tanpa formulir, tautan pembuka pengajuan (mis. "Mulai Pendaftaran", "Ajukan Permohonan", "Buat Permohonan", "Daftar Layanan") didahulukan di atas tautan informasi (persyaratan, unduh formulir, panduan, alur, cek status, berita).',
    '- Jangan mengisi, mencentang, atau mengeklik elemen bertanda terlarang (sandi, otp, captcha, pernyataan).',
    '- Tombol kirim/simpan/ajukan/daftar dan halaman tinjauan atau pernyataan SELALU dikerjakan warga: akhiri dengan {"jenis":"serahkan","alasan":"final"}.',
    '- Halaman masuk akun, OTP, atau CAPTCHA: {"jenis":"serahkan","alasan":"masuk_akun"|"otp"|"captcha"}.',
    '- SINYAL daftar_akun (formulir daftar/buat akun portal, BUKAN formulir masuk): isi kolom data diri dari KATALOG DATA (NIK, email, nomor HP, nama, dsb.) dan pilih opsi yang jelas; JANGAN isi username/nama pengguna/sandi/PIN. Akhiri dengan {"jenis":"serahkan","alasan":"isi_sendiri","ref":<kolom username atau sandi pertama>}.',
    '- Kolom yang datanya tidak ada di katalog: {"jenis":"serahkan","alasan":"isi_sendiri","ref":"eN"}.',
    '- Layanan tidak ada di situs ini, atau hanya lewat aplikasi/WhatsApp: {"jenis":"tidak_bisa","sebab":...}.',
    '- Bila ragu: {"jenis":"serahkan","alasan":"tidak_yakin"}.',
    '- Paling banyak satu aksi terminal (serahkan/tidak_bisa), dan harus terakhir.',
    spotlightPolicyText(),
  ].join('\n');
}

/** Pesan prompt untuk satu halaman. Teks halaman diredaksi lalu dibungkus; struktur (ref, peran, kelas) dari skema. */
export function pesanRencana(m: MasukanPrompt): ChatMessage[] {
  const p = m.pengamatan;
  const nonce = m.nonce ?? newNonce();
  const pii = new PiiInterceptor(undefined, { kodeKabKota: m.kodeKabKota ?? null });
  const data = (teks: string, id?: string, maxChars?: number) =>
    spotlight('dom', pii.redact(teks).text.replace(DERET_ANGKA, '{{DATA.ANGKA}}'), {
      nonce,
      ...(id ? { id } : {}),
      ...(maxChars ? { maxChars } : {}),
    });
  const katalog = m.katalog ?? Object.keys(KATALOG_PLACEHOLDER);
  const berkas = m.berkas ?? KATALOG_BERKAS;
  const s = p.sinyal;
  const baris = p.elemen.map((e) => {
    const bagian: string[] = [e.ref, e.peran];
    if (e.wajib) bagian.push('wajib');
    if (e.isian) bagian.push(`isian=${e.isian}`);
    if (e.kelas) bagian.push(`kelas=${tautanWarga(e) ? 'tautan_warga' : e.kelas}`);
    if (e.terlarang) bagian.push(`terlarang=${e.terlarang}`);
    if (e.form) bagian.push(`form=${e.form}`);
    if (e.isyarat) bagian.push(`isyarat=${e.isyarat}`);
    bagian.push(`nama=${data(e.nama, e.ref, 200)}`);
    if (e.petunjuk) bagian.push(`petunjuk=${data(e.petunjuk, e.ref, 200)}`);
    if (e.galat) bagian.push(`galat=${data(e.galat, e.ref, 200)}`);
    if (e.opsi?.length)
      bagian.push(`opsi: ${e.opsi.map((o, i) => `${i}=${data(o, `${e.ref}.${i}`, 120)}`).join('; ')}`);
    return `- ${bagian.join(' | ')}`;
  });
  const user = [
    `HALAMAN: host ${p.host} | jalur ${data(p.jalur, 'jalur', 200)} | judul ${data(p.judul, 'judul', 200)}`,
    `SINYAL: ${
      [
        ...Object.entries(s)
          .filter(([k, v]) => v && !(m.daftarAkun && k === 'login'))
          .map(([k]) => k),
        ...(m.daftarAkun ? ['daftar_akun'] : []),
      ].join(', ') || 'tidak ada'
    }`,
    `TEKS HALAMAN: ${data(p.teks, 'teks', 2500)}`,
    'ELEMEN:',
    ...baris,
    `KATALOG DATA: ${katalog
      .map((k) => `${k} (${Object.hasOwn(KATALOG_PLACEHOLDER, k) ? KATALOG_PLACEHOLDER[k]!.label : 'data'})`)
      .join(', ')}`,
    `KATALOG BERKAS: ${berkas.join(', ') || 'tidak ada'}`,
    ...(m.petunjukTautan ? [m.petunjukTautan] : []),
    ...(m.umpanBalik?.length
      ? [`UMPAN BALIK: rencana sebelumnya untuk halaman ini ditolak validator: ${m.umpanBalik.join(', ')}.`]
      : []),
  ].join('\n');
  // Petunjuk tepercaya di pesan sistem; teks halaman tetap di pesan pengguna (terbungkus).
  const petunjuk = blokPetunjukPortal(m.petunjukPortal);
  return [
    {
      role: 'system',
      content: petunjuk ? `${aturanSistem(m.tujuan)}\n\n${petunjuk}` : aturanSistem(m.tujuan),
    },
    { role: 'user', content: user },
  ];
}

export type HasilMinta =
  | {
      ok: true;
      rencana: unknown;
      panggilan: number;
      tokenMasuk: number;
      tokenKeluar: number;
    }
  | { ok: false; panggilan: number; tokenMasuk: number; tokenKeluar: number };

/**
 * Minta satu rencana halaman ke model lewat jalur structured @urusin/llm (json_schema strict lebih dulu).
 * Gagal skema → `ok:false` (validator mencatat SKEMA_TIDAK_SAH). Galat jaringan/provider dilempar.
 */
export async function mintaRencana(
  llm: KonfigLlm,
  m: MasukanPrompt,
  signal?: RequestOptions['signal'],
): Promise<HasilMinta> {
  const provider = redactingProvider(llm.provider);
  try {
    const r = await generateStructured({
      provider,
      model: llm.model,
      messages: pesanRencana(m),
      schema: RencanaKetatSchema,
      name: NAMA_SKEMA,
      caps: llm.caps,
      maxRepairs: 0,
      maxTokens: 1200,
      signal,
    });
    return {
      ok: true,
      rencana: r.data,
      panggilan: r.attempts,
      tokenMasuk: r.usage.reduce((a, u) => a + u.prompt_tokens, 0),
      tokenKeluar: r.usage.reduce((a, u) => a + u.completion_tokens, 0),
    };
  } catch (e) {
    if (e instanceof StructuredOutputError)
      return { ok: false, panggilan: e.attempts, tokenMasuk: 0, tokenKeluar: 0 };
    throw e;
  }
}
