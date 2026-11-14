import { findGuardIssues } from '@urusin/core';
import { z } from 'zod';
import { BatasCariWeb, type BatasWebConfig } from './web-cari.js';
import { URUSAN_STATES } from './state.js';
import { defineTool, type ToolResult } from './tools.js';

/**
 * Berkas buatan agen (`berkas__buat`): surat pernyataan, SPTJM, surat kuasa, formulir/checklist, tabel, slide.
 *
 * Privasi: model menulis isi berkas dengan placeholder brankas (`{{PEMOHON.NIK}}`, `{{PEMOHON.NAMA}}`, ...), BUKAN nilai.
 * Policy gate hanya meloloskan placeholder berbentuk sah di tool ini (`placeholderBrankas`); NIK/HP/email mentah tetap
 * ditolak. Nilai asli diambil SERVER dari brankas pemilik urusan tepat saat render (`LayananBerkas.nilai`), ditulis ke
 * berkas, lalu berkas disimpan terenkripsi di Dokumen pemilik. Hasil tool ke model hanya nama berkas, ukuran, dan
 * LABEL kolom yang dikosongkan; nilai tidak pernah kembali ke model maupun ke event.
 */

export const FORMAT_BERKAS = ['docx', 'pdf', 'xlsx', 'pptx'] as const;
export type FormatBerkas = (typeof FORMAT_BERKAS)[number];

export const MIME_BERKAS: Record<FormatBerkas, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Batas ukuran satu berkas hasil render (di bawah batas Dokumen 9 MB). */
export const MAKS_BYTE_BERKAS = 4 * 1024 * 1024;

/** Per jam: 10 berkas per urusan, 30 per pemilik, 300 global. */
export const BATAS_BERKAS_DEFAULT: BatasWebConfig = {
  perUrusan: 10,
  perAkun: 30,
  global: 300,
  jendelaMs: 3_600_000,
};

/** Layanan sisi server (apps/web): nilai brankas pemilik dan penyimpanan Dokumen terenkripsi. */
export type LayananBerkas = {
  /**
   * Nilai brankas untuk placeholder (kunci = placeholder persis, mis. `{{PEMOHON.NIK}}`). Placeholder yang tidak
   * dikenal/tidak terisi tidak ikut. Dipanggil HANYA saat render; hasilnya tidak pernah dikirim ke model.
   */
  nilai(
    pemilik: string,
    placeholder: readonly string[],
    kodeWilayah: string | null,
  ): Record<string, string> | Promise<Record<string, string>>;
  /** Simpan berkas di Dokumen pemilik (terenkripsi). Melempar galat ber-`kode` (mis. DOKUMEN_KUOTA_PENUH). */
  simpan(
    pemilik: string,
    berkas: { judul: string; mime: string; bytes: Buffer },
  ): { id: string } | Promise<{ id: string }>;
  batas: BatasCariWeb;
};

export function buatBatasBerkas(
  config: Partial<BatasWebConfig> = {},
  now: () => number = Date.now,
): BatasCariWeb {
  return new BatasCariWeb({ ...BATAS_BERKAS_DEFAULT, ...config }, now);
}

// --- Placeholder brankas ---

/** Placeholder brankas sah: `{{NAMA.NAMA(.NAMA)*}}` (tanpa `{{FILE:...}}`). */
const PH_RE = /\{\{[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+\}\}/g;

/** Salinan nilai dengan semua placeholder brankas sah dibuang (untuk pemeriksaan PII sisa di policy gate). */
export function tanpaPlaceholderBrankas<T>(value: T): T {
  if (typeof value === 'string') return value.replace(PH_RE, '') as T;
  if (Array.isArray(value)) return value.map(tanpaPlaceholderBrankas) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tanpaPlaceholderBrankas(v)])) as T;
  return value;
}

/** Semua placeholder brankas (unik) di nilai apa pun. */
export function kumpulkanPlaceholder(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const m of value.matchAll(PH_RE)) out.add(m[0]);
  else if (Array.isArray(value)) for (const v of value) kumpulkanPlaceholder(v, out);
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value)) kumpulkanPlaceholder(v, out);
  return out;
}

const LABEL_KOLOM: Record<string, string> = {
  NIK: 'NIK',
  KK: 'nomor KK',
  NO_KK: 'nomor KK',
  NOMOR_KK: 'nomor KK',
  HP: 'nomor HP',
  TELEPON: 'nomor HP',
  EMAIL: 'email',
  RT: 'RT',
  RW: 'RW',
  NAMA: 'nama',
  NAMA_LENGKAP: 'nama',
  TGL_LAHIR: 'tanggal lahir',
  JK: 'jenis kelamin',
};

/** Label warga untuk placeholder, mis. `{{IBU.NIK}}` → "NIK ibu", `{{PEMOHON.TANGGAL_LAHIR}}` → "tanggal lahir". */
export function labelPlaceholder(ph: string): string {
  const bagian = ph.slice(2, -2).split('.');
  const akhir = bagian.at(-1) ?? '';
  const kolom = LABEL_KOLOM[akhir] ?? akhir.toLowerCase().replace(/_/g, ' ');
  const orang = bagian.slice(0, -1).filter((b) => b !== 'PEMOHON');
  return orang.length ? `${kolom} ${orang.map((o) => o.toLowerCase()).join(' ')}` : kolom;
}

const BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** `2026-11-14` → "14 November 2026"; selain format ISO tanggal dikembalikan apa adanya. */
export function tanggalIndonesia(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const bulan = m ? BULAN[Number(m[2]) - 1] : undefined;
  return m && bulan ? `${Number(m[3])} ${bulan} ${m[1]}` : iso;
}

/** Tanggal hari ini di WIB (UTC+7) sebagai `YYYY-MM-DD`. */
export function hariIniWib(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Garis isian kosong untuk kolom yang diisi tangan. */
export const GARIS_KOSONG = '……………………………';

const rapikanNilai = (v: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return tanggalIndonesia(v);
  if (v === 'laki-laki' || v === 'perempuan') return v[0]!.toUpperCase() + v.slice(1);
  return v;
};

/**
 * Ganti placeholder brankas di semua string `value` dengan nilai asli; yang tidak ada nilainya menjadi garis kosong
 * dan labelnya dicatat di `kosong`.
 */
export function isiPlaceholder<T>(value: T, nilai: Readonly<Record<string, string>>, kosong: Set<string>): T {
  if (typeof value === 'string')
    return value.replace(PH_RE, (ph) => {
      const v = Object.hasOwn(nilai, ph) ? nilai[ph] : undefined;
      if (v) return rapikanNilai(v);
      kosong.add(labelPlaceholder(ph));
      return GARIS_KOSONG;
    }) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => isiPlaceholder(v, nilai, kosong)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, isiPlaceholder(v, nilai, kosong)]),
    ) as T;
  return value;
}

// --- Model isi berkas ---

const teks = (max: number) => z.string().max(max);

export const BlokBerkasSchema = z.object({
  jenis: z
    .enum(['judul_bagian', 'paragraf', 'isian', 'tabel', 'daftar'])
    .describe(
      'judul_bagian/paragraf: pakai `teks`; isian: pasangan label-nilai di `isian`; tabel: `kolom` + `baris`; daftar: `butir`.',
    ),
  teks: teks(4000).optional(),
  isian: z
    .array(z.object({ label: teks(120), nilai: teks(600) }))
    .max(40)
    .optional()
    .describe('Mis. [{"label":"Nama","nilai":"{{PEMOHON.NAMA}}"},{"label":"NIK","nilai":"{{PEMOHON.NIK}}"}]'),
  kolom: z.array(teks(120)).max(8).optional(),
  baris: z
    .array(z.array(teks(600)).max(8))
    .max(80)
    .optional(),
  butir: z.array(teks(600)).max(40).optional(),
  bernomor: z.boolean().optional(),
});
export type BlokBerkas = z.infer<typeof BlokBerkasSchema>;

const PenandaTanganSchema = z.object({
  peran: teks(120)
    .optional()
    .describe('Mis. "Yang membuat pernyataan,", "Pemberi Kuasa,", "Penerima Kuasa,"'),
  nama: teks(160).min(1).describe('Biasanya {{PEMOHON.NAMA}}; pihak lain: nama yang disebut warga.'),
  meterai: z
    .boolean()
    .optional()
    .describe('true = sediakan tempat meterai Rp10.000 yang ditempel warga sendiri.'),
});

export const BerkasBuatSchema = z.object({
  format: z.enum(FORMAT_BERKAS).describe('Format berkas. Mengisi templat: samakan dengan format templat.'),
  namaBerkas: teks(80).min(1).describe('Nama berkas tanpa ekstensi, mis. "Surat Pernyataan Belum Menikah".'),
  judul: teks(200).min(1).describe('Judul di dalam berkas, mis. "SURAT PERNYATAAN".'),
  kepada: z
    .array(teks(200))
    .max(6)
    .optional()
    .describe(
      'Surat permohonan: baris alamat tujuan, mis. ["Yth. Kepala Disdukcapil Kota Surabaya","di Tempat"].',
    ),
  perihal: teks(200).optional(),
  blok: z.array(BlokBerkasSchema).max(60).optional().describe('Isi berkas berurutan.'),
  tandaTangan: z
    .object({
      tempat: teks(80).min(1).describe('Kota tempat surat dibuat.'),
      tanggal: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('YYYY-MM-DD; kosong = hari ini.'),
      penanda: z.array(PenandaTanganSchema).min(1).max(3),
    })
    .optional()
    .describe('Blok tanda tangan (tempat, tanggal, nama; garis tanda tangan diisi warga sendiri).'),
  slide: z
    .array(z.object({ judul: teks(150).min(1), poin: z.array(teks(300)).max(10) }))
    .max(20)
    .optional()
    .describe('Khusus pptx: daftar slide (judul + poin).'),
});
export type IsiBerkas = z.infer<typeof BerkasBuatSchema>;

// --- Render ---

/** Teks aman untuk nama berkas (tanpa karakter terlarang di sistem berkas). */
export function namaBerkasAman(nama: string, format: FormatBerkas): string {
  const dasar =
    nama
      .replace(/\.(docx|pdf|xlsx|pptx)$/i, '')
      .replace(/[^\p{L}\p{N} ()_.,-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Berkas Urusin';
  return `${dasar}.${format}`;
}

const tanggalTtd = (isi: IsiBerkas, hariIni: string): string =>
  isi.tandaTangan ? `${isi.tandaTangan.tempat}, ${tanggalIndonesia(isi.tandaTangan.tanggal ?? hariIni)}` : '';

/** Surat bergaya permohonan (ada alamat tujuan): tempat-tanggal di kanan atas, judul tidak dicetak di tengah. */
const gayaSurat = (isi: IsiBerkas) => Boolean(isi.kepada?.length);

const teksBlok = (b: BlokBerkas): string[] => {
  switch (b.jenis) {
    case 'judul_bagian':
    case 'paragraf':
      return b.teks ? [b.teks] : [];
    case 'isian':
      return (b.isian ?? []).map((r) => `${r.label}: ${r.nilai}`);
    case 'tabel':
      return [
        ...(b.kolom?.length ? [b.kolom.join(' | ')] : []),
        ...(b.baris ?? []).map((r) => r.join(' | ')),
      ];
    case 'daftar':
      return (b.butir ?? []).map((x, i) => (b.bernomor ? `${i + 1}. ${x}` : `• ${x}`));
  }
};

async function renderDocx(isi: IsiBerkas, hariIni: string): Promise<Buffer> {
  const d = await import('docx');
  const FONT = 'Times New Roman';
  const run = (text: string, o: { bold?: boolean; underline?: boolean; size?: number } = {}) =>
    new d.TextRun({
      text,
      font: FONT,
      size: o.size ?? 24,
      bold: o.bold ?? false,
      ...(o.underline ? { underline: {} } : {}),
    });
  const para = (
    text: string,
    o: {
      bold?: boolean;
      underline?: boolean;
      size?: number;
      align?: 'left' | 'center' | 'right' | 'justify';
      after?: number;
      indent?: number;
    } = {},
  ) =>
    new d.Paragraph({
      children: [run(text, o)],
      alignment:
        o.align === 'center'
          ? d.AlignmentType.CENTER
          : o.align === 'right'
            ? d.AlignmentType.RIGHT
            : o.align === 'justify'
              ? d.AlignmentType.JUSTIFIED
              : d.AlignmentType.LEFT,
      spacing: { after: o.after ?? 120, line: 300 },
      ...(o.indent ? { indent: { left: o.indent } } : {}),
    });
  const tanpaGaris = {
    top: { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideHorizontal: { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideVertical: { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  };
  const sel = (text: string, persen: number, o: { bold?: boolean; shade?: boolean; after?: number } = {}) =>
    new d.TableCell({
      width: { size: persen, type: d.WidthType.PERCENTAGE },
      ...(o.shade ? { shading: { fill: 'E7ECF2', type: d.ShadingType.CLEAR, color: 'auto' } } : {}),
      children: text
        .split('\n')
        .map((t) => para(t, { ...(o.bold ? { bold: true } : {}), after: o.after ?? 40 })),
    });

  const anak: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];
  const surat = gayaSurat(isi);
  if (surat) {
    if (isi.tandaTangan) anak.push(para(tanggalTtd(isi, hariIni), { align: 'right', after: 240 }));
    if (isi.perihal) anak.push(para(`Perihal : ${isi.perihal}`, { after: 240 }));
    anak.push(para('Kepada', { after: 0 }));
    for (const k of isi.kepada ?? []) anak.push(para(k, { after: 0 }));
    anak.push(para('', { after: 240 }));
  } else {
    anak.push(para(isi.judul, { bold: true, underline: true, size: 28, align: 'center', after: 360 }));
  }
  for (const b of isi.blok ?? []) {
    if (b.jenis === 'judul_bagian' && b.teks) anak.push(para(b.teks, { bold: true, after: 120 }));
    else if (b.jenis === 'paragraf' && b.teks)
      for (const t of b.teks.split(/\n+/)) anak.push(para(t, { align: 'justify' }));
    else if (b.jenis === 'isian' && b.isian?.length)
      anak.push(
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          borders: tanpaGaris,
          rows: b.isian.map(
            (r) => new d.TableRow({ children: [sel(r.label, 34), sel(':', 3), sel(r.nilai, 63)] }),
          ),
        }),
        para('', { after: 120 }),
      );
    else if (b.jenis === 'tabel' && (b.kolom?.length || b.baris?.length)) {
      const n = Math.max(b.kolom?.length ?? 0, ...(b.baris ?? []).map((r) => r.length), 1);
      const lebar = Math.floor(100 / n);
      const lengkap = (r: readonly string[]) => [...r, ...Array<string>(n - r.length).fill('')];
      anak.push(
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: [
            ...(b.kolom?.length
              ? [
                  new d.TableRow({
                    tableHeader: true,
                    children: lengkap(b.kolom).map((k) => sel(k, lebar, { bold: true, shade: true })),
                  }),
                ]
              : []),
            ...(b.baris ?? []).map((r) => new d.TableRow({ children: lengkap(r).map((c) => sel(c, lebar)) })),
          ],
        }),
        para('', { after: 120 }),
      );
    } else if (b.jenis === 'daftar')
      (b.butir ?? []).forEach((x, i) =>
        anak.push(para(`${b.bernomor ? `${i + 1}.` : '•'}  ${x}`, { indent: 360, after: 60 })),
      );
  }
  if (isi.tandaTangan) {
    const p = isi.tandaTangan.penanda;
    const lebar = Math.floor(100 / p.length);
    if (!surat) anak.push(para('', { after: 240 }));
    const kolomTtd = (x: (typeof p)[number], i: number) => {
      const atas = !surat && i === p.length - 1 ? [tanggalTtd(isi, hariIni)] : [''];
      return new d.TableCell({
        width: { size: lebar, type: d.WidthType.PERCENTAGE },
        children: [
          ...atas.map((t) => para(t, { align: 'center', after: 0 })),
          para(x.peran ?? '', { align: 'center', after: 0 }),
          para(x.meterai ? 'Meterai Rp10.000' : '', { align: 'center', size: 18, after: 0 }),
          para('', { after: 0 }),
          para('', { after: 0 }),
          para('', { after: 0 }),
          para(x.nama, { bold: true, underline: true, align: 'center', after: 0 }),
        ],
      });
    };
    anak.push(
      new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        borders: tanpaGaris,
        rows: [new d.TableRow({ children: p.map(kolomTtd) })],
      }),
    );
  }
  const doc = new d.Document({
    creator: 'Urusin',
    title: isi.judul,
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1418, bottom: 1418, left: 1701, right: 1418 },
          },
        },
        children: anak,
      },
    ],
  });
  return Buffer.from(await d.Packer.toBuffer(doc));
}

/** Karakter di luar WinAnsi (font standar PDF) diganti padanan ASCII atau "?". */
const WINANSI_EKSTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function teksWinAnsi(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[→⇒]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/\t/g, '    ')
    .replace(/[^\n]/gu, (c) => {
      const k = c.codePointAt(0)!;
      return (k >= 0x20 && k <= 0x7e) || (k >= 0xa0 && k <= 0xff) || WINANSI_EKSTRA.includes(c) ? c : '?';
    });
}

async function renderPdf(isi: IsiBerkas, hariIni: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(teksWinAnsi(isi.judul));
  doc.setCreator('Urusin');
  doc.setProducer('Urusin');
  const biasa = await doc.embedFont(StandardFonts.TimesRoman);
  const tebal = await doc.embedFont(StandardFonts.TimesRomanBold);
  const A4: [number, number] = [595.28, 841.89];
  const KIRI = 85;
  const KANAN = 57;
  const ATAS = 70;
  const BAWAH = 70;
  const LEBAR = A4[0] - KIRI - KANAN;
  let page = doc.addPage(A4);
  let y = A4[1] - ATAS;
  const hitam = rgb(0, 0, 0);
  const pastikan = (h: number) => {
    if (y - h < BAWAH) {
      page = doc.addPage(A4);
      y = A4[1] - ATAS;
    }
  };
  type Font = typeof biasa;
  const bungkus = (t: string, font: Font, size: number, lebar: number): string[] => {
    const out: string[] = [];
    for (const paragraf of teksWinAnsi(t).split('\n')) {
      let baris = '';
      for (const kata of paragraf.split(/ +/)) {
        const coba = baris ? `${baris} ${kata}` : kata;
        if (font.widthOfTextAtSize(coba, size) <= lebar || !baris) baris = coba;
        else {
          out.push(baris);
          baris = kata;
        }
        // Kata tunggal yang lebih lebar dari kolom dipotong paksa.
        while (font.widthOfTextAtSize(baris, size) > lebar && baris.length > 1) {
          let n = baris.length - 1;
          while (n > 1 && font.widthOfTextAtSize(baris.slice(0, n), size) > lebar) n--;
          out.push(baris.slice(0, n));
          baris = baris.slice(n);
        }
      }
      out.push(baris);
    }
    return out;
  };
  const tulis = (
    t: string,
    o: {
      bold?: boolean;
      size?: number;
      align?: 'left' | 'center' | 'right';
      indent?: number;
      after?: number;
      garis?: boolean;
    } = {},
  ) => {
    const font = o.bold ? tebal : biasa;
    const size = o.size ?? 12;
    const tinggi = size * 1.35;
    const x0 = KIRI + (o.indent ?? 0);
    const lebar = LEBAR - (o.indent ?? 0);
    for (const b of bungkus(t, font, size, lebar)) {
      pastikan(tinggi);
      const w = font.widthOfTextAtSize(b, size);
      const x = o.align === 'center' ? x0 + (lebar - w) / 2 : o.align === 'right' ? x0 + lebar - w : x0;
      y -= tinggi;
      page.drawText(b, { x, y, size, font, color: hitam });
      if (o.garis) page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + w, y: y - 1.5 }, thickness: 0.7 });
    }
    y -= o.after ?? 6;
  };
  const tabel = (baris: string[][], lebarKolom: number[], o: { garis: boolean; tebalPertama: boolean }) => {
    const size = 11;
    const tinggiBaris = size * 1.3;
    const pad = o.garis ? 4 : 1;
    baris.forEach((r, ri) => {
      const font = o.tebalPertama && ri === 0 ? tebal : biasa;
      const sel = lebarKolom.map((w, ci) => bungkus(r[ci] ?? '', font, size, w - pad * 2));
      const h = Math.max(...sel.map((s) => s.length)) * tinggiBaris + pad * 2;
      pastikan(h);
      let x = KIRI;
      sel.forEach((s, ci) => {
        const w = lebarKolom[ci]!;
        if (o.garis) {
          if (o.tebalPertama && ri === 0)
            page.drawRectangle({ x, y: y - h, width: w, height: h, color: rgb(0.906, 0.925, 0.949) });
          page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: hitam, borderWidth: 0.6 });
        }
        s.forEach((t, li) =>
          page.drawText(t, { x: x + pad, y: y - pad - (li + 1) * tinggiBaris + 3, size, font, color: hitam }),
        );
        x += w;
      });
      y -= h;
    });
    y -= 8;
  };

  const surat = gayaSurat(isi);
  if (surat) {
    if (isi.tandaTangan) tulis(tanggalTtd(isi, hariIni), { align: 'right', after: 14 });
    if (isi.perihal) tulis(`Perihal : ${isi.perihal}`, { after: 14 });
    tulis('Kepada', { after: 0 });
    for (const k of isi.kepada ?? []) tulis(k, { after: 0 });
    y -= 14;
  } else tulis(isi.judul, { bold: true, size: 14, align: 'center', after: 20, garis: true });

  for (const b of isi.blok ?? []) {
    if (b.jenis === 'judul_bagian' && b.teks) tulis(b.teks, { bold: true, after: 4 });
    else if (b.jenis === 'paragraf' && b.teks) tulis(b.teks, { after: 8 });
    else if (b.jenis === 'isian' && b.isian?.length)
      tabel(
        b.isian.map((r) => [r.label, ':', r.nilai]),
        [LEBAR * 0.34, LEBAR * 0.03, LEBAR * 0.63],
        { garis: false, tebalPertama: false },
      );
    else if (b.jenis === 'tabel' && (b.kolom?.length || b.baris?.length)) {
      const n = Math.max(b.kolom?.length ?? 0, ...(b.baris ?? []).map((r) => r.length), 1);
      tabel([...(b.kolom?.length ? [b.kolom] : []), ...(b.baris ?? [])], Array<number>(n).fill(LEBAR / n), {
        garis: true,
        tebalPertama: Boolean(b.kolom?.length),
      });
    } else if (b.jenis === 'daftar')
      (b.butir ?? []).forEach((x, i) =>
        tulis(`${b.bernomor ? `${i + 1}.` : '-'} ${x}`, { indent: 18, after: 3 }),
      );
  }
  if (isi.tandaTangan) {
    const p = isi.tandaTangan.penanda;
    const w = LEBAR / p.length;
    const size = 12;
    const t = size * 1.35;
    pastikan(t * 8);
    y -= 18;
    const tengah = (s: string, kol: number, font: Font, garis = false, ukuran = size) => {
      const s2 = teksWinAnsi(s);
      const lebar = font.widthOfTextAtSize(s2, ukuran);
      const x = KIRI + kol * w + (w - lebar) / 2;
      page.drawText(s2, { x, y, size: ukuran, font, color: hitam });
      if (garis)
        page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + lebar, y: y - 1.5 }, thickness: 0.7 });
    };
    if (!surat) {
      y -= t;
      tengah(tanggalTtd(isi, hariIni), p.length - 1, biasa);
    }
    y -= t;
    p.forEach((x, i) => tengah(x.peran ?? '', i, biasa));
    y -= t;
    p.forEach((x, i) => {
      if (x.meterai) tengah('Meterai Rp10.000', i, biasa, false, 8);
    });
    y -= t * 3;
    p.forEach((x, i) => tengah(x.nama, i, tebal, true));
  }
  return Buffer.from(await doc.save());
}

async function renderXlsx(isi: IsiBerkas, hariIni: string): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Urusin';
  wb.title = isi.judul;
  const namaLembar =
    isi.judul
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Lembar 1';
  const ws = wb.addWorksheet(namaLembar, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const nKolom = Math.max(
    2,
    ...(isi.blok ?? []).map((b) =>
      b.jenis === 'tabel' ? Math.max(b.kolom?.length ?? 0, ...(b.baris ?? []).map((r) => r.length)) : 2,
    ),
  );
  const garis = { style: 'thin' as const, color: { argb: 'FF8A94A6' } };
  const kotak = { top: garis, bottom: garis, left: garis, right: garis };
  const satuBaris = (t: string, o: { bold?: boolean; size?: number } = {}) => {
    const r = ws.addRow([t]);
    ws.mergeCells(r.number, 1, r.number, nKolom);
    r.getCell(1).font = { name: 'Calibri', bold: o.bold ?? false, size: o.size ?? 11 };
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    return r;
  };
  satuBaris(isi.judul, { bold: true, size: 14 });
  if (isi.perihal) satuBaris(`Perihal: ${isi.perihal}`);
  ws.addRow([]);
  for (const b of isi.blok ?? []) {
    if (b.jenis === 'judul_bagian' && b.teks) satuBaris(b.teks, { bold: true });
    else if (b.jenis === 'paragraf' && b.teks) satuBaris(b.teks);
    else if (b.jenis === 'isian')
      for (const r of b.isian ?? []) {
        const row = ws.addRow([r.label, r.nilai]);
        row.getCell(1).font = { bold: true };
        row.eachCell((c) => {
          c.border = kotak;
          c.alignment = { wrapText: true, vertical: 'top' };
        });
      }
    else if (b.jenis === 'tabel') {
      if (b.kolom?.length) {
        const h = ws.addRow(b.kolom);
        h.eachCell((c) => {
          c.font = { bold: true };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECF2' } };
          c.border = kotak;
          c.alignment = { wrapText: true, vertical: 'middle' };
        });
      }
      for (const r of b.baris ?? []) {
        const row = ws.addRow(r);
        for (let i = 1; i <= Math.max(r.length, b.kolom?.length ?? 0); i++) {
          const c = row.getCell(i);
          c.border = kotak;
          c.alignment = { wrapText: true, vertical: 'top' };
        }
      }
    } else if (b.jenis === 'daftar')
      (b.butir ?? []).forEach((x, i) => satuBaris(`${b.bernomor ? `${i + 1}.` : '•'} ${x}`));
    ws.addRow([]);
  }
  if (isi.tandaTangan) {
    ws.addRow([]);
    satuBaris(tanggalTtd(isi, hariIni));
    for (const p of isi.tandaTangan.penanda) {
      if (p.peran) satuBaris(p.peran);
      ws.addRow([]);
      ws.addRow([]);
      satuBaris(p.nama, { bold: true });
    }
  }
  for (let i = 1; i <= nKolom; i++) ws.getColumn(i).width = i === 1 ? 32 : 28;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function renderPptx(isi: IsiBerkas): Promise<Buffer> {
  // Tipe pptxgenjs dibaca sebagai CJS (`default.default`); saat jalan (ESM) kelasnya ada di `default`.
  const mod = await import('pptxgenjs');
  const PptxGenJS = mod.default as unknown as typeof mod.default.default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = isi.judul;
  pptx.author = 'Urusin';
  const WARNA = '1F3A5F';
  const sampul = pptx.addSlide();
  sampul.background = { color: 'F5F7FA' };
  sampul.addText(isi.judul, {
    x: 0.6,
    y: 2.0,
    w: 8.8,
    h: 1.2,
    fontSize: 32,
    bold: true,
    color: WARNA,
    fontFace: 'Calibri',
  });
  if (isi.perihal)
    sampul.addText(isi.perihal, {
      x: 0.6,
      y: 3.2,
      w: 8.8,
      h: 0.8,
      fontSize: 18,
      color: '475569',
      fontFace: 'Calibri',
    });
  // Tanpa `slide`: blok dijadikan slide (judul_bagian memulai slide baru).
  const slides =
    isi.slide && isi.slide.length > 0
      ? isi.slide.map((s) => ({ judul: s.judul, poin: s.poin, tabel: undefined as BlokBerkas | undefined }))
      : (isi.blok ?? []).reduce<{ judul: string; poin: string[]; tabel: BlokBerkas | undefined }[]>(
          (acc, b) => {
            if (b.jenis === 'judul_bagian' || acc.length === 0 || (b.jenis === 'tabel' && acc.at(-1)!.tabel))
              acc.push({
                judul: b.jenis === 'judul_bagian' ? (b.teks ?? '') : isi.judul,
                poin: [],
                tabel: undefined,
              });
            const s = acc.at(-1)!;
            if (b.jenis === 'tabel') s.tabel = b;
            else if (b.jenis !== 'judul_bagian') s.poin.push(...teksBlok(b));
            return acc;
          },
          [],
        );
  for (const s of slides) {
    const sl = pptx.addSlide();
    sl.addShape('rect', { x: 0, y: 0, w: 10, h: 0.12, fill: { color: WARNA } });
    sl.addText(s.judul, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 26,
      bold: true,
      color: WARNA,
      fontFace: 'Calibri',
    });
    if (s.tabel) {
      const rows = [...(s.tabel.kolom?.length ? [s.tabel.kolom] : []), ...(s.tabel.baris ?? [])].map((r, i) =>
        r.map((text) => ({
          text,
          options: i === 0 && s.tabel?.kolom?.length ? { bold: true, fill: { color: 'E7ECF2' } } : {},
        })),
      );
      sl.addTable(rows, {
        x: 0.5,
        y: 1.3,
        w: 9,
        fontSize: 12,
        border: { type: 'solid', pt: 0.5, color: '8A94A6' },
        autoPage: true,
      });
    } else if (s.poin.length)
      sl.addText(
        s.poin.map((p) => ({ text: p, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: 1.3, w: 8.8, h: 4.0, fontSize: 18, color: '1E293B', valign: 'top', fontFace: 'Calibri' },
      );
  }
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer | Uint8Array;
  return Buffer.from(out);
}

/** Render isi (placeholder SUDAH diganti) ke bytes format yang diminta. `hariIni` = `YYYY-MM-DD`. */
export async function renderBerkas(isi: IsiBerkas, hariIni: string): Promise<Buffer> {
  switch (isi.format) {
    case 'docx':
      return renderDocx(isi, hariIni);
    case 'pdf':
      return renderPdf(isi, hariIni);
    case 'xlsx':
      return renderXlsx(isi, hariIni);
    case 'pptx':
      return renderPptx(isi);
  }
}

// --- Templat lampiran warga ---

export const MIME_TEMPLAT = [MIME_BERKAS.docx, MIME_BERKAS.pdf] as const;
/** Teks templat maksimal yang diteruskan ke agen (sesudah ekstraksi, sebelum dibungkus). */
export const MAKS_TEKS_TEMPLAT = 6000;

/**
 * Teks mentah templat DOCX (mammoth) atau PDF (unpdf/pdf.js). null = jenis lain, tidak terbaca, atau tanpa teks
 * (PDF hasil pindai). Belum diredaksi: pemanggil (agen) meredaksi PII sebelum ke model.
 */
export async function teksTemplat(b: { mime: string; bytes: Buffer }): Promise<string | null> {
  try {
    let teks: string;
    if (b.mime === MIME_BERKAS.docx) {
      const mammoth = (await import('mammoth')).default;
      teks = (await mammoth.extractRawText({ buffer: b.bytes })).value;
    } else if (b.mime === MIME_BERKAS.pdf) {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(b.bytes));
      teks = (await extractText(pdf, { mergePages: true })).text;
    } else return null;
    const rapi = teks
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return rapi ? rapi.slice(0, MAKS_TEKS_TEMPLAT) : null;
  } catch {
    return null;
  }
}

/**
 * Isian templat `{{Nama}}`/`{{ nik }}` buatan warga bukan placeholder brankas: diubah menjadi `[isian: Nama]` agar
 * model tidak menyalin kurung kurawal liar ke parameter tool (ditolak gate).
 */
export function rapikanIsianTemplat(teks: string): string {
  return teks.replace(/\{\{\s*([^{}]{1,60}?)\s*\}\}/g, (m, isi: string) =>
    /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/.test(isi) ? m : `[isian: ${isi}]`,
  );
}

// --- Tool ---

/** Judul yang meniru kop/terbitan instansi: berkas warga tidak boleh tampak diterbitkan pemerintah. */
const JUDUL_INSTANSI_RE =
  /^\s*(pemerintah|kementerian|kantor|dinas|badan|kepolisian|pengadilan|kelurahan|desa|kecamatan|rumah\s+sakit|puskesmas)\b/i;

const LABEL_FORMAT: Record<FormatBerkas, string> = { docx: 'DOCX', pdf: 'PDF', xlsx: 'XLSX', pptx: 'PPTX' };

const ukuranTeks = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

function pesanGalatSimpan(e: unknown): string {
  const kode =
    e !== null && typeof e === 'object' && 'kode' in e ? String((e as { kode: unknown }).kode) : '';
  if (kode === 'DOKUMEN_KUOTA_PENUH')
    return 'Dokumen warga sudah penuh. Minta warga menghapus dokumen lama di halaman Dokumen, lalu coba lagi.';
  if (kode === 'PENYIMPANAN_PENUH' || kode === 'DOKUMEN_TERLALU_BESAR')
    return 'Penyimpanan Dokumen sedang penuh. Sampaikan jujur ke warga dan coba lagi nanti.';
  return 'Berkas gagal disimpan. Sampaikan jujur ke warga dan tawarkan mencoba lagi.';
}

export const BERKAS_TOOL = 'berkas__buat';

export const berkasBuat = defineTool({
  name: BERKAS_TOOL,
  description:
    'Membuat berkas unduhan (docx/pdf/xlsx/pptx) yang disusun warga sendiri: surat pernyataan, SPTJM, surat kuasa, surat permohonan, formulir/templat yang diisi, checklist, tabel, slide. Data pribadi WAJIB ditulis sebagai placeholder brankas ({{PEMOHON.NAMA}}, {{PEMOHON.NIK}}, {{PEMOHON.KK}}, {{PEMOHON.TEMPAT_LAHIR}}, {{PEMOHON.TANGGAL_LAHIR}}, {{PEMOHON.JENIS_KELAMIN}}, {{PEMOHON.AGAMA}}, {{PEMOHON.PEKERJAAN}}, {{PEMOHON.ALAMAT}}, {{PEMOHON.RT}}, {{PEMOHON.RW}}, {{PEMOHON.KELURAHAN}}, {{PEMOHON.KECAMATAN}}, {{PEMOHON.HP}}, {{PEMOHON.EMAIL}}; anggota keluarga {{AYAH|IBU|ANAK|PASANGAN.NAMA|NIK|TANGGAL_LAHIR|TEMPAT_LAHIR|JENIS_KELAMIN}}): sistem mengisinya dari Data Diri warga saat berkas dibuat; jangan pernah menulis nomor asli. Tanpa kop/logo instansi, stempel, atau tanda tangan. Berkas tersimpan di Dokumen warga dan kartu Unduh tampil otomatis.',
  effect: 'plan',
  input: BerkasBuatSchema,
  allowedStates: URUSAN_STATES,
  placeholderBrankas: true,
  async execute(ctx, args): Promise<ToolResult> {
    const layanan = ctx.deps.berkas;
    const pemilik = ctx.pemilikBerkas;
    if (!layanan || !pemilik)
      return {
        content:
          'Pembuatan berkas tidak tersedia untuk urusan ini. Tawarkan kerangka isinya di balasan teks (tanpa data pribadi).',
      };
    if (JUDUL_INSTANSI_RE.test(args.judul))
      return {
        content:
          'Ditolak: judul meniru kop/terbitan instansi. Berkas Urusin adalah surat/formulir yang disusun warga sendiri (mis. "SURAT PERNYATAAN", "SURAT KUASA"); jangan memakai kop, logo, nama instansi sebagai penerbit, stempel, atau tanda tangan pejabat.',
      };
    if ((args.blok?.length ?? 0) === 0 && (args.slide?.length ?? 0) === 0)
      return { content: 'Isi berkas kosong: lengkapi `blok` (atau `slide` untuk pptx), lalu panggil lagi.' };
    const c = layanan.batas.config;
    if (
      !layanan.batas.coba([
        { kunci: `urusan:${ctx.urusan.id}`, batas: c.perUrusan },
        { kunci: `akun:${pemilik}`, batas: c.perAkun },
        { kunci: 'global', batas: c.global },
      ])
    )
      return {
        content:
          'Batas pembuatan berkas untuk saat ini tercapai (paling banyak 10 berkas per urusan per jam). Sampaikan ke warga untuk mencoba lagi nanti.',
      };

    const placeholder = [...kumpulkanPlaceholder(args)];
    let nilai: Record<string, string> = {};
    try {
      if (placeholder.length)
        nilai = await layanan.nilai(pemilik, placeholder, ctx.urusan.kodeKabKota ?? null);
    } catch {
      nilai = {}; // brankas tidak terbuka: semua kolom pribadi jadi garis kosong (diisi tangan)
    }
    const kosong = new Set<string>();
    const isi = isiPlaceholder(args, nilai, kosong);
    const hariIni = hariIniWib(ctx.deps.now());
    let bytes: Buffer;
    try {
      bytes = await renderBerkas(isi, hariIni);
    } catch {
      return {
        content: 'Berkas gagal disusun. Sederhanakan isinya (lebih sedikit tabel/baris), lalu coba lagi.',
      };
    }
    if (bytes.length > MAKS_BYTE_BERKAS)
      return { content: 'Berkas terlalu besar. Kurangi isi (baris tabel/slide), lalu coba lagi.' };
    const nama = namaBerkasAman(args.namaBerkas, args.format);
    let id: string;
    try {
      ({ id } = await layanan.simpan(pemilik, { judul: nama, mime: MIME_BERKAS[args.format], bytes }));
    } catch (e) {
      return { content: pesanGalatSimpan(e) };
    }
    const label = [...kosong];
    return {
      content: [
        `Berkas "${nama}" (${LABEL_FORMAT[args.format]}, ${ukuranTeks(bytes.length)}) sudah dibuat dan tersimpan di Dokumen warga; kartu Unduh sudah tampil di layar.`,
        label.length
          ? `Kolom yang dibiarkan kosong (garis titik-titik) karena belum ada di Data Diri: ${label.join(', ')}. Sampaikan bahwa kolom itu bisa diisi tangan, atau lengkapi Data Diri lalu minta dibuat ulang.`
          : 'Data pribadi sudah diisi otomatis dari Data Diri warga.',
        'Balas warga singkat (1-2 kalimat): berkas siap diunduh, periksa isinya, tanda tangan sendiri (dan tempel meterai bila ada). Jangan menulis ulang isi berkas.',
      ].join('\n'),
      events: [
        {
          type: 'berkas',
          id,
          nama,
          format: args.format,
          mime: MIME_BERKAS[args.format],
          ukuran: bytes.length,
          judul: args.judul.slice(0, 200),
        },
      ],
    };
  },
});

/** Kebijakan berkas di catatan state (hanya bila `berkas__buat` ditawarkan). */
export const KEBIJAKAN_BERKAS =
  'BERKAS: bila warga meminta dibuatkan/diisikan surat, formulir, templat, checklist, tabel, atau slide (mis. surat pernyataan, SPTJM, surat kuasa, surat permohonan), atau langkah rencana butuh surat yang disusun warga sendiri, panggil berkas__buat. Tanyakan dulu data yang memang belum diketahui dan bukan data pribadi (tujuan surat, nama pihak lain, keperluan, kota), satu pertanyaan saja; data pribadi pemohon/keluarga ditulis sebagai placeholder brankas ({{PEMOHON.NAMA}}, {{PEMOHON.NIK}}, ...) dan diisi sistem dari Data Diri, KHUSUS di parameter berkas__buat. Ada templat lampiran warga: ikuti struktur dan kolomnya, format sama dengan templat kecuali warga minta lain. Format bawaan surat: docx (pdf bila warga minta PDF/siap cetak). Berkas ini disusun warga sendiri: JANGAN membuat kop/logo instansi, stempel/cap, tanda tangan, nomor surat resmi, atau surat yang seolah-olah diterbitkan instansi/pejabat (surat keterangan, akta, izin), dan jangan mengarang data/saksi. Sesudah berkas jadi, balas singkat; jangan menyalin isinya ke chat.';

/** Pesan warga meminta dibuatkan/diisikan berkas (lewati jalur cepat jawaban persyaratan). */
export function mintaBerkas(teks: string): boolean {
  return (
    /\b(buat\w*|bikin\w*|susun\w*|isi\w*|tulis\w*|siapkan|generate|convert|ubah)\s+(\S+\s+){0,4}?(surat|sptjm|formulir|form|templat|template|berkas|dokumen\s+(word|pdf|excel)|checklist|daftar\s+periksa|tabel|slide|presentasi|ppt|pptx|docx|xlsx|excel|word|pdf)\b/i.test(
      teks,
    ) ||
    /\b(surat\s+(pernyataan|kuasa|permohonan)|sptjm)\b.{0,40}\b(buat\w*|bikin\w*|isi\w*|tulis\w*)\b/i.test(
      teks,
    )
  );
}

/** PII sisa sesudah placeholder brankas dibuang (dipakai policy gate untuk tool `placeholderBrankas`). */
export function masalahPiiBerkas(rawArgs: unknown) {
  return findGuardIssues(tanpaPlaceholderBrankas(rawArgs));
}
