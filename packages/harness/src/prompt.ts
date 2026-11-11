import type { UrusanState } from '@urusin/contracts';
import { FAKTA_HUKUM, routeByKode } from '@urusin/registry';
import { spotlightPolicyText } from './spotlight.js';
import type { ToolDef } from './tools.js';
import { kalimatJaringanId, keteranganPendamping, rutePendamping, tierUrusan } from './rencana.js';
import {
  TEKS_WILAYAH,
  kalimatKanal,
  rencanaPeristiwa,
  wilayahBelumSiap,
  type WilayahUrusan,
} from './wilayah.js';

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
    '- Permintaan memalsukan atau mengarang dokumen/surat (mis. "buatkan surat keterangan lahir dari bidan, tulis nama bidan siapa saja"): kalimat PERTAMA menolak dengan jelas ("Saya tidak bisa membantu membuat atau memalsukan surat itu."), sebut ancaman pidananya dari FAKTA HUKUM TERKINI (pasalnya), lalu: bila wilayah KTP belum ditetapkan, cukup "Ada jalur sah untuk ini. KTP Anda terdaftar di kabupaten/kota mana?" tanpa menyebut SPTJM, dokumen, atau formulir apa pun; jalur sahnya (SPTJM) baru dijelaskan setelah wilayah ditetapkan. Penolakan ini tidak menunggu wilayah.',
    '- Tindakan yang mengubah data di situs luar butuh konfirmasi warga (confirmationId yang diberikan sistem). Tanpa itu, jangan memanggilnya. Pengiriman akhir selalu diklik warga sendiri.',
    '- Browser Pendamping (peramban di server yang membuka portal resmi wilayah KTP warga dan membantu mengisi pengajuan, mis. mengunggah Dokumen warga, setelah warga menekan "Setujui rencana" lalu "Setujui dan buka situs") HANYA ada di wilayah yang catatan state-nya menyebut "Browser Pendamping tersedia". Di kota beradapter alurnya tetap; di portal web resmi lain AI mengisi per halaman setelah warga mengizinkan datanya. Di wilayah itu jangan bilang kamu tidak bisa membantu mengisi. Di wilayah lain JANGAN menyuruh warga menekan "Setujui dan buka situs" dan jangan menjanjikan AI mengisi formulir: pandu warga langkah demi langkah lewat kanal resmi. Warga sendiri yang masuk akun, mengetik sandi/OTP/CAPTCHA, dan menekan Kirim. Sistem, bukan kamu, yang membuka Browser Pendamping.',
    '- Gunakan Bahasa Indonesia sederhana, ramah, singkat. Bila tidak yakin, tanyakan satu pertanyaan klarifikasi.',
    '- Sebut formulir dengan bahasa sehari-hari, mis. "formulir permohonan yang disediakan petugas (F-1.02)": kodenya boleh dalam kurung, jangan jadi inti kalimat.',
    '- Panjang balasan: paling banyak 4 kalimat pendek atau 5 butir, satu pertanyaan per balasan, tanpa pembuka panjang. Ikuti gaya warga: warga yang menulis singkat/santai dijawab lebih ringkas, tanpa istilah teknis; warga lansia dijawab dengan kata sehari-hari ("petugas Disdukcapil membuatkan akta", bukan "pejabat pencatatan sipil menerbitkan kutipan akta") dan tanpa kode formulir (cukup "formulir dari petugas"). Jangan menyalin ulang seluruh kartu rencana atau jawaban bersumber, tetapi selalu sebut ulang 2-3 dokumen kunci secara eksplisit (mis. "bawa KK, KTP-el, dan surat kematian dari desa"); jangan hanya menulis "lihat daftar di atas": warga lansia atau yang jarang membaca tidak bisa diandalkan membaca kartu. Yang tidak boleh hilang: dokumen kunci, kanal/kantor yang dituju, dan langkah berikutnya.',
    '',
    'WILAYAH DULU:',
    '- Aturan, situs resmi, dan cara akses berbeda di tiap kab/kota. Sebelum merencanakan, pastikan kab/kota sesuai KTP warga, lalu panggil wilayah__tetapkan. Sistem menolak rencana sampai wilayah KTP ditetapkan.',
    '- Warga sudah menyebut sendiri kab/kota KTP/KK-nya (mis. "KTP saya Wonogiri", "KK saya juga Wonogiri")? Langsung panggil wilayah__tetapkan dengan wilayah itu; jangan bertanya ulang "betul?".',
    '- Ada usulan wilayah (Data Diri atau pilihan di perangkat)? Tanyakan satu kalimat: "KTP Anda terdaftar di <nama usulan>, betul?" Jangan anggap benar sebelum warga membenarkan.',
    '- Tanpa usulan: tanyakan "KTP Anda terdaftar di kabupaten/kota mana?" Cukup nama kab/kota; jangan pernah meminta NIK.',
    '- Warga tidak yakin KTP-nya terdaftar di mana? Bantu menemukannya: minta warga melihat nama kabupaten/kota yang tertulis di KTP atau KK, atau memilihnya di kartu/pilihan kab-kota di layar. Bila belum bisa dicek, jangan berputar menanyakan hal yang sama: tawarkan kab/kota tempat tinggalnya sebagai dugaan sementara ("Biasanya sama dengan tempat tinggal Anda. Kita pakai Kabupaten X dulu? Bisa diubah nanti."), lalu panggil wilayah__tetapkan setelah warga setuju dan lanjutkan. Jangan pernah meminta NIK atau sebagian digit NIK lewat chat.',
    '- Nama ganda (mis. Bekasi: Kota atau Kabupaten) ditanyakan. Kecamatan/kota kecil (mis. Cikarang) boleh kamu petakan ke kab/kotanya, tetapi tanyakan dulu ke warga sebelum menetapkan.',
    '- Konfirmasi wilayah cukup SEKALI. Warga menjawab "iya/betul/benar" (juga "Oh, iya betul, KTP saya di Cikarang Utara") atas wilayah yang kamu tanyakan = sudah dibenarkan: langsung panggil wilayah__tetapkan, jangan menanyakan "betul?" lagi. Wilayah KTP yang sudah ditetapkan tidak ditanyakan lagi.',
    '- Wilayah KTP menentukan Disdukcapil yang berwenang. Tanyakan domisili hanya bila penting: urusan pindah, atau warga bilang tinggal di tempat lain. Jelaskan: langkah online bisa dari mana saja, langkah tatap muka di kantor wilayah KTP.',
    '- Pindah: asal = wilayah KTP sekarang, tujuan = kab/kota baru. SKPWNI diurus di asal; Disdukcapil tujuan menerbitkan KK dan KTP-el baru.',
    '- Kematian: yang berwenang Disdukcapil tempat tinggal (domisili) almarhum (UU 24/2013), bukan KTP pelapor. Tanyakan "Almarhum tinggal di kabupaten/kota mana?" lalu panggil wilayah__tetapkan dengan domisili itu.',
    '- Cek status pengajuan atau informasi umum (baca saja, bukan rencana) TIDAK perlu wilayah KTP: langsung pakai tool baca (mis. dukcapil__cek_status dengan kab/kota portal tempat warga mengajukan). Jangan menanyakan KTP untuk itu, tetapi nama ganda (mis. Semarang: Kota atau Kabupaten) tetap ditanyakan dulu.',
    '- Sebut kanal resmi wilayah itu saja. Jangan memakai langkah atau tautan kab/kota lain.',
    '',
    'FAKTA HUKUM TERKINI (per 10 November 2026; jangan dibantah dengan aturan lama):',
    ...FAKTA_HUKUM.map((f) => `- ${f.teks} (${f.pasal})`),
    '- Bila sumber daerah berbeda dari fakta di atas (halaman lama), sebut aturan nasional terbaru dan sarankan warga memastikan ke Disdukcapil.',
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

/**
 * Tier yang berlaku: tier rencana Peristiwa Hidup bila jenisnya punya rencana (mis. pindah di Wonogiri tetap dipandu),
 * selain itu tier kab/kota di registry.
 */
function tierWilayah(jenis: string | null, w: WilayahUrusan): 'semi' | 'dipandu' {
  const ktp = w.ktp!.kodeKabKota;
  const r = jenis
    ? rencanaPeristiwa(jenis, {
        ktp,
        domisili: w.domisili?.kodeKabKota ?? null,
        tujuan: w.tujuan?.kodeKabKota ?? null,
      })
    : undefined;
  return r ? r.tier : routeByKode(ktp).entry.tier;
}

/** Baris wilayah di catatan state: yang sudah dipastikan, usulan yang belum, dan apa yang masih harus ditanyakan. */
function barisWilayah(jenis: string | null, w: WilayahUrusan | undefined, kode: string | null): string[] {
  if (!w) return [`Kode kab/kota: ${kode ?? 'belum diketahui'}.`];
  const out: string[] = [];
  if (w.ktp) {
    out.push(
      `${TEKS_WILAYAH.baris} ${w.ktp.nama} (${w.ktp.kodeKabKota}), ${TEKS_WILAYAH.sudah} ${kalimatKanal(w.ktp.kodeKabKota)}`,
      'Jangan tanyakan atau minta konfirmasi wilayah KTP lagi.',
      tierWilayah(jenis, w) === 'semi'
        ? 'Browser Pendamping tersedia di wilayah ini untuk mengisi pengajuan.'
        : 'Browser Pendamping tidak tersedia di wilayah ini (tingkat dipandu): JANGAN menyuruh warga menekan "Setujui dan buka situs" dan jangan menjanjikan AI mengisi; pandu langkah demi langkah lewat kanal resmi. Cek status baca-saja hanya lewat dukcapil__cek_status.',
    );
    if (w.domisili) out.push(`Domisili: ${w.domisili.nama} (berbeda dari KTP).`);
    if (w.tujuan) out.push(`Tujuan pindah: ${w.tujuan.nama}.`);
    if (jenis) out.push(barisPendamping(jenis, w.ktp.kodeKabKota));
  } else {
    out.push(TEKS_WILAYAH.belum);
    if (w.usulan) {
      const { ktp, sumber } = w.usulan;
      const tanya = `${jenis === 'kematian' ? 'Almarhum tinggal di' : 'KTP Anda terdaftar di'} ${ktp.nama}, betul?`;
      const benarkan = `Bila pesan terakhir warga membenarkannya (mis. "iya", "betul"), langsung panggil wilayah__tetapkan dengan ${ktp.nama}; jangan bertanya ulang.`;
      out.push(
        sumber === 'warga'
          ? `${TEKS_WILAYAH.usulan} (sudah kamu tanyakan di percakapan): ${ktp.nama}. Tanyakan lagi hanya bila warga belum menjawabnya. ${benarkan}`
          : `${TEKS_WILAYAH.usulan} (${sumber === 'data_diri' ? 'Data Diri akun' : 'pilihan di perangkat'}): ${ktp.nama}. Tanyakan sekali: "${tanya}" ${benarkan}`,
      );
    }
  }
  const belum = wilayahBelumSiap(jenis, w);
  if (belum) out.push(`Rencana belum bisa disusun: ${belum}.`);
  return out;
}

/** Satu baris state note: Browser Pendamping untuk urusan ini (sama dengan yang ditawarkan saat persetujuan). */
function barisPendamping(jenis: string, kode: string): string {
  const r = rutePendamping({ jenis, kodeKabKota: kode });
  if (r.jalur === 'dipandu')
    return r.sebab === 'jaringan_id'
      ? `BROWSER PENDAMPING: tidak tersedia untuk urusan ini (tingkat dipandu); pandu warga mengisi sendiri. Alasan untuk warga: ${kalimatJaringanId()}`
      : 'BROWSER PENDAMPING: tidak tersedia untuk urusan ini (tingkat dipandu); pandu warga mengisi sendiri.';
  return `BROWSER PENDAMPING (tingkat ${tierUrusan({ jenis, kodeKabKota: kode })}, ${r.jalur === 'generik' ? 'Navigator generik' : 'adapter'}): ${keteranganPendamping(r)}`;
}

/**
 * Pesan warga yang meminta dokumen dipalsukan/dikarang (nama bidan/saksi asal-asalan, surat palsu). Hanya penanda
 * untuk catatan state; penolakan tetap disusun model sesuai prompt sistem.
 */
export function mintaPemalsuan(teks: string): boolean {
  return (
    /\b(palsu\w*|memalsu\w*|rekayasa\w*|ngarang|mengarang|manipulasi)\b/i.test(teks) ||
    /\b(tulis|isi|kasih|pakai|cantumkan)(in|kan)?\s+nama\s+(bidan|dokter|saksi|lurah|kades|rs|rumah sakit)\b.{0,30}\b(siapa|asal|aja|saja|terserah|bebas)\b/i.test(
      teks,
    ) ||
    /\btanda ?tangan(nya)?\s+(siapa|asal|aja|saja|terserah|dipalsu\w*)\b/i.test(teks)
  );
}

/** Catatan state dinamis (dikirim sebagai pesan system tepat sebelum pesan terakhir). */
export function buildStateNote(input: {
  state: UrusanState;
  jenis: string | null;
  kodeKabKota: string | null;
  wilayah?: WilayahUrusan;
  tools: readonly ToolDef[];
  confirmations: readonly { id: string; tool: string }[];
  /** Pesan warga giliran ini (sudah diredaksi). */
  pesanWarga?: string;
}): string {
  const lines = [
    `STATE URUSAN: ${input.state}`,
    `Jenis urusan: ${input.jenis ?? 'belum diketahui'}.`,
    ...barisWilayah(input.jenis, input.wilayah, input.kodeKabKota),
    `Tool yang boleh dipakai sekarang: ${input.tools.map((t) => t.name).join(', ') || '(tidak ada)'}.`,
  ];
  if (input.pesanWarga && mintaPemalsuan(input.pesanWarga))
    lines.push(
      `KEMUNGKINAN PERMINTAAN PEMALSUAN DOKUMEN di pesan warga. Bila warga memang meminta surat/data dikarang atau dipalsukan: kalimat pertama balasanmu menolak dengan jelas, sebut ancaman pidananya (FAKTA HUKUM TERKINI), lalu ${input.wilayah?.ktp ? 'jelaskan jalur sahnya (SPTJM) untuk wilayah ini' : 'cukup "Ada jalur sah untuk ini. KTP Anda terdaftar di kabupaten/kota mana?" (jangan sebut SPTJM atau dokumen apa pun sebelum wilayah ditetapkan)'}. Jangan menyusun atau mengisi surat itu.`,
    );
  // Nama ibu kandung (dan data dikenal lain) tidak ditolak di HTTP, hanya disamarkan: warga tetap diingatkan.
  if (input.pesanWarga && /\{\{[A-Z]+\d*\.[A-Z_]+\}\}/.test(input.pesanWarga))
    lines.push(
      'PESAN WARGA BERISI DATA PRIBADI (sudah disamarkan sebagai placeholder {{...}}). Awali balasanmu dengan pengingat ramah satu kalimat: "Demi keamanan, jangan ketik nama ibu kandung atau NIK di chat ya; isi di Data Diri, nanti kami isikan langsung dari perangkat Anda." Jangan menulis placeholder itu, lalu lanjutkan menjawab.',
    );
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
