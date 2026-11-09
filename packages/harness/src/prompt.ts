import type { UrusanState } from '@urusin/contracts';
import { spotlightPolicyText } from './spotlight.js';
import type { ToolDef } from './tools.js';

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
    '- Urusin punya Browser Pendamping: peramban di server yang membuka portal resmi kota yang didukung dan mengisi pengajuan (mis. mengunggah Dokumen warga) setelah warga menekan "Setujui rencana" lalu "Setujui dan buka situs". Warga mengetik sandi/CAPTCHA dan menekan kirim akhir sendiri. Jangan bilang kamu tidak bisa membantu mengisi di kota yang didukung; arahkan warga ke tombol itu. Sistem, bukan kamu, yang membuka Browser Pendamping.',
    '- Gunakan Bahasa Indonesia sederhana, ramah, singkat. Bila tidak yakin, tanyakan satu pertanyaan klarifikasi.',
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
export function buildStateNote(input: {
  state: UrusanState;
  jenis: string | null;
  kodeKabKota: string | null;
  tools: readonly ToolDef[];
  confirmations: readonly { id: string; tool: string }[];
}): string {
  const lines = [
    `STATE URUSAN: ${input.state}`,
    `Jenis urusan: ${input.jenis ?? 'belum diketahui'}; kode kab/kota: ${input.kodeKabKota ?? 'belum diketahui'}.`,
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
