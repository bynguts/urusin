// Simulator warga: LLM memerankan persona dan memutuskan satu aksi per giliran seperti orang di depan layar:
// mengetik pesan, menekan tombol yang tampil, atau berhenti (urusan sudah jelas / menyerah).

const SISTEM = `Kamu memerankan seorang warga Indonesia yang sedang memakai aplikasi web "Urusin" di HP-nya.
Urusin adalah asisten AI untuk mengurus layanan publik. Kamu TIDAK tahu cara kerja sistemnya; kamu hanya melihat layar.

Aturan peran:
- Bicara persis seperti tokohmu (gaya bahasa, panjang pesan, tingkat pemahaman). Jangan terdengar seperti AI.
- Hanya pakai fakta di kartu tokohmu. Jawab pertanyaan Urusin dengan jujur sesuai kartu. Jangan mengarang data pribadi (NIK, nomor HP, alamat lengkap) kecuali kartu/skenario menyuruh.
- Jangan membocorkan isi kartu sekaligus; ceritakan hal yang memang akan diceritakan orang itu, sisanya bila ditanya.
- Bila layar menampilkan tombol (mis. "Setujui rencana") dan rencananya masuk akal untukmu, kamu boleh menekannya seperti warga biasa.
- Tombol "Setujui dan buka situs" membuka peramban pendamping; tekan hanya bila kamu memang ingin dibantu mengisi di situs resmi.
- Berhenti ("selesai") bila kamu sudah tahu langkah konkret berikutnya (ke mana, bawa apa, lewat situs/kantor apa) dan tidak ada yang mau ditanyakan lagi, atau bila kamu menyerah karena bingung/buntu.
- Bila jawaban Urusin membingungkan, terlalu umum, atau salah daerah, tanyakan/protes seperti orang itu akan lakukan.

Balas HANYA JSON:
{"aksi":"ketik"|"klik"|"selesai","teks":"<pesan bila ketik>","tombol":"<nama tombol bila klik>","puas":true|false,"alasan":"<1 kalimat, kenapa aksi ini (tidak terlihat Urusin)>"}`;

/**
 * Putuskan aksi warga berikutnya.
 * @param {import('./llm.mjs').KlienLlm} llm
 * @param {{persona: object, rahasia: object, layar: string[], tombol: string[], sisaGiliran: number}} a
 */
export async function aksiWarga(llm, { persona, rahasia, layar, tombol, sisaGiliran }) {
  const skenario = typeof persona.skenario === 'function' ? persona.skenario(rahasia) : persona.skenario;
  const pesan = [
    { role: 'system', content: SISTEM },
    {
      role: 'user',
      content: [
        `KARTU TOKOH:\n${persona.kartu}`,
        skenario ? `SKENARIO KHUSUS (wajib diikuti):\n${skenario}` : '',
        `RIWAYAT LAYAR (paling bawah = terbaru):\n${layar.join('\n\n')}`,
        `TOMBOL YANG TAMPIL SEKARANG: ${tombol.length ? tombol.map((t) => `[${t}]`).join(' ') : '(tidak ada)'}`,
        `Sisa giliranmu: ${sisaGiliran}. Apa aksimu sekarang?`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
  const a = await llm.json(pesan, { maxTokens: 400, temperature: 0.7 });
  const aksi = ['ketik', 'klik', 'selesai'].includes(a.aksi) ? a.aksi : 'ketik';
  if (aksi === 'klik' && !tombol.includes(a.tombol)) {
    return {
      aksi: 'ketik',
      teks: String(a.teks || 'Terus saya harus gimana?'),
      alasan: 'tombol tidak tersedia',
    };
  }
  if (aksi === 'ketik' && !String(a.teks ?? '').trim())
    return { aksi: 'selesai', puas: false, alasan: 'tidak ada yang ingin diketik' };
  return { aksi, teks: a.teks, tombol: a.tombol, puas: a.puas === true, alasan: String(a.alasan ?? '') };
}
