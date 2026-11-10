import type { UrusanState } from '@urusin/contracts';
import { spotlightPolicyText } from './spotlight.js';
import type { ToolDef } from './tools.js';
import { tierUrusan, keteranganPendamping, rutePendamping } from './rencana.js';
import { kalimatKanal, wilayahBelumSiap, type WilayahUrusan } from './wilayah.js';

/** Sistem prompt statis (prefix stabil agar prefix caching provider bisa bekerja). */
export function buildSystemPrompt(): string {
  return [
    'Kamu adalah Urusin, agen yang membantu warga Indonesia mengurus layanan publik bersama warga itu sendiri.',
    '',
    'PRINSIP:',
    '- Kamu memutuskan APA yang perlu dilakukan; kode sistem yang memutuskan BAGAIMANA. Kamu tidak pernah menulis selector, URL, atau langkah eksekusi; kamu hanya memilih tool dan parameternya.',
    '- Jawaban tentang persyaratan atau prosedur HARUS bersumber: cari dulu dengan rag__cari_pengetahuan, lalu panggil urusan__jawab_persyaratan. Jangan menjawab persyaratan dari ingatan.',
    '- Jangan pernah menyatakan warga "memenuhi syarat". Keputusan ada di petugas instansi.',
    '- Data pribadi (NIK, KK, nama, alamat, HP, email) tidak pernah kamu lihat. Bila perlu merujuknya, gunakan placeholder seperti {{PEMOHON.NIK}} HANYA dalam teks balasan, jangan di parameter tool, dan jangan minta warga menuliskannya di chat.',
    '- Tindakan yang mengubah data di situs luar butuh konfirmasi warga (confirmationId yang diberikan sistem). Tanpa itu, jangan memanggilnya. Pengiriman akhir selalu diklik warga sendiri.',
    '- Urusin punya Browser Pendamping: peramban di server yang membuka portal resmi wilayah KTP warga dan membantu mengisi pengajuan setelah warga menekan "Setujui rencana" lalu "Setujui dan buka situs". Di kota beradapter alurnya tetap; di portal web resmi lain AI mengisi per halaman setelah warga mengizinkan datanya. Warga sendiri yang masuk akun, mengetik sandi/OTP/CAPTCHA, dan menekan Kirim. Catatan state menyebut apakah Browser Pendamping tersedia untuk urusan ini; ikuti itu, jangan menjanjikan lebih. Sistem, bukan kamu, yang membuka Browser Pendamping.',
    '- Gunakan Bahasa Indonesia sederhana, ramah, singkat. Bila tidak yakin, tanyakan satu pertanyaan klarifikasi.',
    '',
    'WILAYAH DULU:',
    '- Aturan, situs resmi, dan cara akses berbeda di tiap kab/kota. Sebelum merencanakan, pastikan kab/kota sesuai KTP warga, lalu panggil wilayah__tetapkan. Sistem menolak rencana sampai wilayah KTP ditetapkan.',
    '- Ada usulan wilayah (Data Diri atau pilihan di perangkat)? Tanyakan satu kalimat: "KTP Anda terdaftar di <nama usulan>, betul?" Jangan anggap benar sebelum warga membenarkan.',
    '- Tanpa usulan: tanyakan "KTP Anda terdaftar di kabupaten/kota mana?" Cukup nama kab/kota; jangan pernah meminta NIK.',
    '- Nama ganda (mis. Bekasi: Kota atau Kabupaten) ditanyakan. Kecamatan/kota kecil (mis. Cikarang) boleh kamu petakan ke kab/kotanya, tetapi tanyakan dulu ke warga sebelum menetapkan.',
    '- Wilayah KTP menentukan Disdukcapil yang berwenang. Tanyakan domisili hanya bila penting: urusan pindah, atau warga bilang tinggal di tempat lain. Jelaskan: langkah online bisa dari mana saja, langkah tatap muka di kantor wilayah KTP.',
    '- Pindah: asal = wilayah KTP sekarang, tujuan = kab/kota baru. Surat pindah diurus di asal, lapor datang di tujuan.',
    '- Sebut kanal resmi wilayah itu saja. Jangan memakai langkah atau tautan kab/kota lain.',
    '',
    spotlightPolicyText(),
  ].join('\n');
}

/** Arahan per state agar balasan model selaras dengan tombol yang tampil di layar warga. */
const PANDUAN_STATE: Partial<Record<UrusanState, string>> = {
  RENCANA_DIUSULKAN:
    'Rencana sedang menunggu persetujuan warga. Bila warga ingin dibantu mengisi, minta warga menekan tombol "Setujui rencana" di kartu rencana; jangan mengusulkan rencana baru.',
  MENUNGGU_KONFIRMASI:
    'Browser Pendamping siap. Minta warga memeriksa kartu konfirmasi lalu menekan "Setujui dan buka situs"; warga sendiri yang masuk akun dan menekan Selesai.',
  MENUNGGU_SUBMIT_WARGA:
    'Browser Pendamping sedang berjalan. Warga memeriksa isian di layar lalu menekan Selesai sendiri.',
};

/** Catatan state dinamis (dikirim sebagai pesan system tepat sebelum pesan terakhir). */
/** Baris wilayah di catatan state: yang sudah dipastikan, usulan yang belum, dan apa yang masih harus ditanyakan. */
function barisWilayah(jenis: string | null, w: WilayahUrusan | undefined, kode: string | null): string[] {
  if (!w) return [`Kode kab/kota: ${kode ?? 'belum diketahui'}.`];
  const out: string[] = [];
  if (w.ktp) {
    out.push(
      `WILAYAH KTP: ${w.ktp.nama} (${w.ktp.kodeKabKota}), sudah dipastikan warga. ${kalimatKanal(w.ktp.kodeKabKota)}`,
    );
    if (w.domisili) out.push(`Domisili: ${w.domisili.nama} (berbeda dari KTP).`);
    if (w.tujuan) out.push(`Tujuan pindah: ${w.tujuan.nama}.`);
    if (jenis) out.push(barisPendamping(jenis, w.ktp.kodeKabKota));
  } else {
    out.push('WILAYAH KTP: belum ditetapkan.');
    if (w.usulan)
      out.push(
        `Usulan (${w.usulan.sumber === 'data_diri' ? 'Data Diri akun' : 'pilihan di perangkat'}): ${w.usulan.ktp.nama}. Tanyakan: "KTP Anda terdaftar di ${w.usulan.ktp.nama}, betul?"`,
      );
  }
  const belum = wilayahBelumSiap(jenis, w);
  if (belum) out.push(`Rencana belum bisa disusun: ${belum}.`);
  return out;
}

/** Satu baris state note: Browser Pendamping untuk urusan ini (sama dengan yang ditawarkan saat persetujuan). */
function barisPendamping(jenis: string, kode: string): string {
  const r = rutePendamping({ jenis, kodeKabKota: kode });
  if (r.jalur === 'dipandu')
    return 'BROWSER PENDAMPING: tidak tersedia untuk urusan ini (tingkat dipandu); pandu warga mengisi sendiri.';
  return `BROWSER PENDAMPING (tingkat ${tierUrusan({ jenis, kodeKabKota: kode })}, ${r.jalur === 'generik' ? 'Navigator generik' : 'adapter'}): ${keteranganPendamping(r)}`;
}

export function buildStateNote(input: {
  state: UrusanState;
  jenis: string | null;
  kodeKabKota: string | null;
  wilayah?: WilayahUrusan;
  tools: readonly ToolDef[];
  confirmations: readonly { id: string; tool: string }[];
}): string {
  const lines = [
    `STATE URUSAN: ${input.state}`,
    `Jenis urusan: ${input.jenis ?? 'belum diketahui'}.`,
    ...barisWilayah(input.jenis, input.wilayah, input.kodeKabKota),
    `Tool yang boleh dipakai sekarang: ${input.tools.map((t) => t.name).join(', ') || '(tidak ada)'}.`,
  ];
  const bantuan = PANDUAN_STATE[input.state];
  if (bantuan) lines.push(bantuan);
  if (input.confirmations.length > 0) {
    lines.push(
      `Konfirmasi warga yang aktif: ${input.confirmations.map((c) => `${c.id} untuk ${c.tool}`).join('; ')}.`,
    );
  } else {
    lines.push('Belum ada konfirmasi warga untuk tindakan apa pun.');
  }
  return lines.join('\n');
}
