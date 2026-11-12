import type { HarnessStore } from './store.js';

/**
 * Status NYATA Browser Pendamping eksekusi terakhir urusan, dihitung dari rantai event (jejak worker + loop
 * Navigator), bukan dari state urusan. Dasar satu-satunya bagi agen chat untuk berbicara tentang isian: QA prod
 * 2026-11-12 (Klampid Buat Akun) agen menulis "Isian sudah menunggu diperiksa" padahal Pendamping belum mengisi
 * apa pun, karena catatan state hanya berkata "warga memeriksa isian".
 */
export type StatusPendamping = {
  /** Baris isian/berkas yang nilainya benar-benar dikirim ke Pendamping untuk diisi AI (jejak `persetujuan.n`). */
  kolomDiisi: number;
  /** Ada lembar izin tanpa satu pun baris terkirim: ditolak warga, atau Data Diri tidak memuat datanya. */
  izinKosong: boolean;
  /** Pemegang kendali sekarang: `ai`, atau alasan serah terakhir yang belum selesai (`warga` bila tanpa alasan). */
  giliran: string;
  /** Loop Navigator sudah berakhir (resi tercatat): AI tidak melanjutkan di sesi ini. Nilai = cara berakhir. */
  aiBerakhir?: string;
  /** Sesi sudah ditutup (hasil eksekusi tercatat): dibatalkan/berhasil/gagal/... */
  hasil?: string;
  /** Demo (akun juri) di situs resmi asli, mode "lihat saja": AI hanya menavigasi, tidak pernah mengisi. */
  lihatSaja?: true;
};

type JejakEvent = {
  executionId?: unknown;
  catatan?: { jenis?: unknown; n?: unknown; fase?: unknown; alasan?: unknown; akhir?: unknown };
};

/** Status Pendamping eksekusi terakhir; undefined bila urusan belum pernah membuka Browser Pendamping. */
export function statusPendamping(store: HarnessStore, urusanId: string): StatusPendamping | undefined {
  const req = store.eventsOfType(urusanId, 'execution_request', 1)[0]?.payload as
    { executionId?: unknown } | undefined;
  const executionId = typeof req?.executionId === 'string' ? req.executionId : undefined;
  if (!executionId) return undefined;
  const s: StatusPendamping = { kolomDiisi: 0, izinKosong: false, giliran: 'ai' };
  const jejak = store
    .eventsOfType(urusanId, 'jejak_pendamping', 500)
    .map((e) => e.payload as JejakEvent)
    .filter((p) => p.executionId === executionId)
    .reverse();
  for (const { catatan: c } of jejak) {
    if (!c) continue;
    if (c.jenis === 'persetujuan' && typeof c.n === 'number') {
      if (c.n > 0) s.kolomDiisi += c.n;
      else s.izinKosong = true;
    } else if (c.jenis === 'ambil_alih') {
      s.giliran = c.fase === 'mulai' ? (typeof c.alasan === 'string' ? c.alasan : 'warga') : 'ai';
    } else if (c.jenis === 'resi' && typeof c.akhir === 'string') {
      s.aiBerakhir = c.akhir;
    } else if (c.jenis === 'lihat_saja') {
      s.lihatSaja = true;
    }
  }
  const hasil = store.hasilEksekusi(urusanId, executionId);
  if (hasil) s.hasil = hasil;
  return s;
}

const GILIRAN: Readonly<Record<string, string>> = {
  masuk_akun:
    'Sekarang giliran warga di halaman masuk/daftar akun portal: username, sandi, dan CAPTCHA diketik warga sendiri (AI tidak pernah mengetik sandi). Sesudah itu warga menekan Lanjutkan di layar agar AI melanjutkan.',
  captcha:
    'Sekarang giliran warga menyelesaikan CAPTCHA/verifikasi keamanan di layar, lalu menekan Lanjutkan agar AI melanjutkan.',
  otp: 'Sekarang giliran warga mengetik kode OTP di layar, lalu menekan Lanjutkan agar AI melanjutkan.',
  isi_sendiri:
    'Sekarang giliran warga mengisi sendiri kolom yang disorot (datanya tidak diizinkan atau tidak ada di Data Diri Urusin), lalu menekan Lanjutkan.',
  final:
    'Sekarang giliran warga memeriksa isian di layar lalu menekan sendiri tombol kirim situs, kemudian Selesai.',
  ketuk_tautan: 'Sekarang giliran warga mengetuk tautan yang disorot di layar.',
  ai: 'AI sedang bekerja di layar Browser Pendamping; minta warga menunggu sebentar dan mengikuti petunjuk di layar.',
};
const GILIRAN_LAIN =
  'Sekarang warga memegang layar dan AI menunggu. Warga bisa menekan Lanjutkan di layar agar AI mencoba lagi.';

const LIHAT_SAJA = [
  '- Sesi ini DEMO (akun juri) di situs resmi ASLI dalam mode lihat saja: AI hanya membuka dan menavigasi halaman, TIDAK mengisi kolom apa pun dan TIDAK menekan Lanjut/Simpan/Kirim, karena data demo adalah data contoh yang tidak boleh masuk ke sistem pemerintah. JANGAN bilang AI sudah, sedang, atau akan mengisi di sesi ini.',
  '- Bila ditanya kenapa AI tidak mengisi: jelaskan dengan ramah bahwa dengan akun sendiri (Daftar atau Masuk dengan Google) AI mengisi kolom dari Data Diri setelah warga menekan Izinkan isi, dan tombol Kirim selalu warga yang menekan. Contoh pengisian dengan data contoh bisa dilihat lewat tombol "Lihat contoh pengisian (simulasi)" di layar bila tersedia.',
];

/** Baris catatan state dari status nyata Pendamping (tanpa nilai isian, tanpa teks halaman). */
export function barisStatusPendamping(s: StatusPendamping): string {
  const out = [
    'STATUS NYATA BROWSER PENDAMPING (dari jejak sistem; satu-satunya dasar ucapanmu tentang isian):',
  ];
  if (s.lihatSaja) {
    out.push(...LIHAT_SAJA);
    if (s.hasil) out.push(`- Sesi Browser Pendamping sudah ditutup (hasil: ${s.hasil}).`);
    return out.join('\n');
  }
  if (s.hasil) {
    out.push(
      `- Sesi Browser Pendamping sudah ditutup (hasil: ${s.hasil}). Tidak ada isian yang menunggu diperiksa; jangan menyuruh warga menekan Selesai.`,
    );
  } else if (s.aiBerakhir) {
    out.push(
      `- Bantuan AI di sesi ini sudah berhenti (${s.aiBerakhir}); AI tidak mengisi lagi di sesi ini. Warga melanjutkan sendiri dari layar mengikuti pesan di layar.`,
    );
  } else {
    out.push(`- ${GILIRAN[s.giliran] ?? GILIRAN_LAIN}`);
  }
  out.push(
    s.kolomDiisi > 0
      ? `- AI sudah diberi izin dan data untuk mengisi ${s.kolomDiisi} kolom/berkas di sesi ini; warga memeriksanya di layar.`
      : '- AI BELUM mengisi kolom apa pun di sesi ini. JANGAN bilang isian sudah terisi, sudah menunggu diperiksa, atau siap dikirim.',
  );
  if (s.izinKosong)
    out.push(
      '- Ada izin isi yang tidak menghasilkan isian: warga menolak barisnya atau Data Diri di Urusin belum memuat data itu. Sarankan melengkapi menu Data Diri, atau mengisi sendiri kolom itu di layar.',
    );
  out.push(
    '- Bila warga meminta AI mengisi: jawab jujur sesuai status ini (apa yang sudah/belum diisi AI, alasannya, dan SATU langkah berikutnya untuk warga). Kamu tidak mengendalikan Browser Pendamping dari chat; AI di layar melanjutkan setelah warga menekan Lanjutkan.',
  );
  return out.join('\n');
}
