import { LABEL_JENIS, periksaBerkas, type JenisDokumen } from '#lib/akun/klien.js';

/**
 * Tombol Enter di komposer. Laptop: Enter = kirim, Shift+Enter = baris baru. Layar sentuh (pointer: coarse):
 * Enter = baris baru seperti aplikasi chat HP, kirim lewat tombol. Selama komposisi IME (isComposing, atau
 * keyCode 229 di Safari) Enter memilih kata, jadi tidak pernah mengirim.
 */
export function aksiEnter(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'> & { keyCode?: number },
  sentuh = false,
): 'kirim' | null {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
  if (e.shiftKey || sentuh) return null;
  return 'kirim';
}

/** Lampiran yang belum terkirim. `docId` terisi setelah tersimpan di brankas (tidak diunggah dua kali). */
export type Lampiran = {
  kunci: string;
  berkas: File;
  jenis: JenisDokumen;
  pratinjau: string | null;
  docId?: string;
};

export const LAMPIRAN_MAKS = 5;

/** Label aman untuk penanda (tanpa nama berkas: nama berkas bisa memuat NIK). */
export const labelLampiran = (j: JenisDokumen) => (j === 'lainnya' ? 'Dokumen lain' : LABEL_JENIS[j]);

/** Tebak jenis dari nama berkas; hanya dipakai sebagai pilihan awal yang bisa diubah warga. */
export function tebakJenis(nama: string): JenisDokumen {
  const n = ` ${nama
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')} `;
  if (/ (e ?)?ktp /.test(n)) return 'ktp';
  if (/ kk | kartu ?keluarga /.test(n)) return 'kk';
  if (/ ak(ta|te)/.test(n)) return 'akta';
  if (/ pas ?foto /.test(n)) return 'foto';
  if (/ surat | sk | keterangan /.test(n)) return 'surat';
  return 'lainnya';
}

/** Ukuran berkas untuk kartu lampiran: "12 KB", "1,4 MB". */
export function ukuranBerkas(bita: number): string {
  if (bita < 1024 * 1024) return `${Math.max(1, Math.round(bita / 1024))} KB`;
  return `${(bita / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const BENTUK = (mime: string) => (mime === 'application/pdf' ? 'PDF' : 'gambar');

/** Penanda non-PII untuk agen: "[warga melampirkan dokumen: Kartu Keluarga (gambar)]". */
export const penandaLampiran = (jenis: JenisDokumen, mime: string) =>
  `[warga melampirkan dokumen: ${labelLampiran(jenis)} (${BENTUK(mime)})]`;

const POLA_PENANDA = /^\[warga melampirkan dokumen: ([^\]()\n]{1,40}) \((gambar|PDF)\)\]$/;

/** Gabungkan penanda lampiran (satu per baris) dengan tulisan warga. */
export function teksDenganLampiran(teks: string, lampiran: { jenis: JenisDokumen; mime: string }[]): string {
  return [...lampiran.map((l) => penandaLampiran(l.jenis, l.mime)), teks.trim()].filter(Boolean).join('\n');
}

/** Pisahkan penanda lampiran dari tulisan warga untuk gelembung pesan (chip + teks). */
export function pecahPenanda(teks: string): {
  lampiran: { label: string; bentuk: 'gambar' | 'PDF' }[];
  teks: string;
} {
  const lampiran: { label: string; bentuk: 'gambar' | 'PDF' }[] = [];
  const sisa: string[] = [];
  for (const baris of teks.split('\n')) {
    const m = POLA_PENANDA.exec(baris);
    if (m) lampiran.push({ label: m[1]!, bentuk: m[2] as 'gambar' | 'PDF' });
    else sisa.push(baris);
  }
  return { lampiran, teks: sisa.join('\n').trim() };
}

/** Judul dokumen di brankas: jenis + urusan asalnya (milik pemilik, terenkripsi). */
export const judulLampiran = (jenis: JenisDokumen, urusan: string | null) =>
  `${labelLampiran(jenis)} (lampiran urusan: ${urusan ?? 'baru'})`.slice(0, 200);

/** Gambar per pesan yang dibaca AI dan sisi terpanjang salinannya (sama dengan batas /turn). */
export const GAMBAR_AI_MAKS = 3;
export const SISI_GAMBAR_AI = 1280;
const PANJANG_DATA_URL_MAKS = 2_000_000;

/** Ukuran salinan untuk AI: sisi terpanjang paling banyak `maks`, rasio tetap, tidak pernah diperbesar. */
export function ukuranPerkecil(w: number, h: number, maks = SISI_GAMBAR_AI): { w: number; h: number } {
  const s = Math.min(1, maks / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Salinan gambar lampiran untuk dibaca AI: diperkecil di perangkat (sisi terpanjang 1280 px, JPEG) supaya cepat
 * dikirim. Aslinya tetap disimpan terenkripsi di brankas. null bila bukan gambar atau peramban gagal membacanya.
 */
export async function gambarUntukAi(f: File): Promise<string | null> {
  if (!f.type.startsWith('image/')) return null;
  try {
    const bmp = await createImageBitmap(f);
    const { w, h } = ukuranPerkecil(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    // Latar putih: PNG transparan (tangkapan layar) tidak berubah hitam saat jadi JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    for (const q of [0.82, 0.6, 0.4]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.startsWith('data:image/jpeg;base64,') && url.length <= PANJANG_DATA_URL_MAKS) return url;
    }
    return null;
  } catch {
    return null;
  }
}

const HEIC = /\.(heic|heif)$/i;

/**
 * Foto HEIC (iPhone) tidak diterima brankas; bila peramban bisa membacanya (Safari), ubah ke JPEG di
 * perangkat. Mengembalikan berkas siap unggah, atau pesan galat untuk warga.
 */
export async function siapkanBerkas(f: File): Promise<File | string> {
  if (!/^image\/hei[cf]$/.test(f.type) && !HEIC.test(f.name)) return f;
  try {
    const bmp = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')?.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new Error('kosong');
    return new File([blob], 'lampiran.jpg', { type: 'image/jpeg' });
  } catch {
    return 'Foto HEIC belum bisa dibaca di peramban ini. Simpan sebagai JPG, lalu lampirkan lagi.';
  }
}

/**
 * Berkas pilihan/tempelan → lampiran baru (HEIC diubah ke JPEG, ukuran/jenis diperiksa, batas per pesan). Dipakai
 * komposer urusan dan kotak cerita Beranda. `galat` = pesan terakhir untuk warga, bila ada berkas yang ditolak.
 */
export async function buatLampiran(
  berkas: File[],
  sudahAda: number,
): Promise<{ baru: Lampiran[]; galat: string | null }> {
  const baru: Lampiran[] = [];
  let galat: string | null = null;
  for (const asli of berkas) {
    if (sudahAda + baru.length >= LAMPIRAN_MAKS) {
      galat = `Maksimal ${LAMPIRAN_MAKS} lampiran per pesan.`;
      break;
    }
    const f = await siapkanBerkas(asli);
    if (typeof f === 'string') {
      galat = f;
      continue;
    }
    const cek = periksaBerkas(f);
    if (cek) {
      galat = cek;
      continue;
    }
    baru.push({
      kunci: `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      berkas: f,
      jenis: tebakJenis(asli.name),
      pratinjau: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    });
  }
  return { baru, galat };
}

/**
 * Titipan pesan pertama Beranda yang membawa lampiran (memori klien, sekali pakai): server membuat urusan tanpa
 * menjalankan turn, lalu halaman urusan mengirim pesan itu bersama lampirannya lewat jalur komposer biasa
 * (brankas terenkripsi + gambar untuk AI). Hilang bila halaman dimuat ulang penuh: warga melampirkan lagi.
 */
let titipan: { teks: string; lampiran: Lampiran[] } | null = null;
export function titipkanPesanAwal(teks: string, lampiran: Lampiran[]): void {
  titipan = { teks, lampiran };
}
export function ambilTitipanPesanAwal(): { teks: string; lampiran: Lampiran[] } | null {
  const t = titipan;
  titipan = null;
  return t;
}
