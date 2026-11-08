import type { UrusanState } from './contracts.js';
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
    '- Gunakan Bahasa Indonesia sederhana, ramah, singkat. Bila tidak yakin, tanyakan satu pertanyaan klarifikasi.',
    '',
    spotlightPolicyText(),
  ].join('\n');
}

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
  if (input.confirmations.length > 0) {
    lines.push(
      `Konfirmasi warga yang aktif: ${input.confirmations.map((c) => `${c.id} untuk ${c.tool}`).join('; ')}.`,
    );
  } else {
    lines.push('Belum ada konfirmasi warga untuk tindakan apa pun.');
  }
  return lines.join('\n');
}
