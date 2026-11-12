import type { PayloadOf, WilayahRef } from '@urusin/contracts';
import {
  FAKTA_HUKUM,
  kalimatPendampingBerkembang,
  namaPendekWilayah,
  pendampingAktif,
  wilayahByKode,
} from '@urusin/registry';
import { portalWilayah } from './generik.js';
import { handoffChannels, kunciUrl } from './grounding.js';

/**
 * Mode "AI memandu" (ADR 0033): paket kartu rencana untuk urusan tanpa Browser Pendamping, dan arahan panduan umum
 * saat korpus tidak punya sumber yang bisa dikutip. Semua kanal dari registry (tidak ada URL/nomor karangan).
 */
export type PaketDipandu = NonNullable<PayloadOf<'plan_card'>['dipandu']>;
type Kanal = PaketDipandu['kanal'][number];

const MAKS_KANAL = 6;

const fakta = (id: string) => FAKTA_HUKUM.find((f) => f.id === id);

const KANAL_PORTAL: Partial<Record<string, string>> = {
  web: 'Layanan online Disdukcapil',
  whatsapp: 'Layanan WhatsApp Disdukcapil',
  aplikasi: 'Aplikasi layanan Disdukcapil',
};

/**
 * Kanal resmi daerah untuk warga, berurutan: kanal layanan dari registry portal (web, WhatsApp, aplikasi) dengan jam
 * layanan, lalu kanal Disdukcapil/pemda beserta alamat dan kontak tercatat (`handoffChannels`). `bukanPenduduk`:
 * portal berlogin penduduk setempat dilewati (kanal domisili).
 */
export function kanalDipandu(kode: string, jenis: string | null, bukanPenduduk = false): Kanal[] {
  const w = wilayahByKode(kode);
  const nama = w?.nama ?? kode;
  const p = portalWilayah(kode);
  const out: Kanal[] = [];
  const label = p ? KANAL_PORTAL[p.jenis] : undefined;
  const url = p?.jenis === 'web' ? p.url : p?.sumber;
  if (p && label && url && !bukanPenduduk) {
    const ket = [
      p.jenis === 'whatsapp' ? 'Pengajuan lewat WhatsApp; nomor resminya ada di halaman ini' : '',
      p.jenis === 'aplikasi' ? 'Pengajuan lewat aplikasi resmi; tautannya ada di halaman ini' : '',
      p.jamLayanan ? `Jam layanan ${p.jamLayanan}` : '',
    ].filter(Boolean);
    out.push({ nama: `${label} ${nama}`, url, ...(ket.length ? { kontak: ket.join(' · ') } : {}) });
  }
  for (const k of handoffChannels({ kodeKabKota: kode, jenis, bukanPenduduk }))
    if (!k.url || !out.some((o) => o.url && kunciUrl(o.url) === kunciUrl(k.url!))) out.push(k);
  return out.slice(0, MAKS_KANAL);
}

/** Kode formulir nasional menurut jenis urusan (Permendagri 109/2019 Ps. 4, lihat FAKTA_HUKUM). */
function formulir(jenis: string | null): string | undefined {
  if (jenis === 'kk' || jenis === 'ktp' || jenis === 'kia') return 'F-1.02';
  if (jenis === 'pindah') return 'F-1.03';
  if (jenis === 'kelahiran' || jenis === 'kematian' || jenis === 'perkawinan' || jenis === 'akta')
    return 'F-2.01';
  return undefined;
}

function waktu(jenis: string | null): PaketDipandu['waktu'] {
  const sisa = 'Lama terbitnya berbeda per Disdukcapil; tanyakan perkiraannya di kanal resmi di atas.';
  const tenggat: Partial<Record<string, string>> = {
    kelahiran: 'lahir-60-hari',
    kematian: 'mati-30-hari',
    pindah: 'pindah-masa-berlaku',
  };
  const f = jenis && tenggat[jenis] ? fakta(tenggat[jenis]) : undefined;
  if (f) return { teks: `${f.teks} (${f.pasal}). ${sisa}`, umum: false };
  return {
    teks: `Perkiraan umum: bila berkas lengkap, banyak Disdukcapil menyelesaikannya di hari yang sama sampai beberapa hari kerja. ${sisa}`,
    umum: true,
  };
}

function tips(jenis: string | null, jamLayanan: string | undefined): string[] {
  return [
    'Bawa dokumen asli beserta fotokopinya; banyak loket meminta keduanya.',
    jamLayanan
      ? `Datang lebih awal di jam layanan (${jamLayanan}) supaya kebagian antrean.`
      : 'Cek jam layanan dan antrean di kanal resmi sebelum berangkat.',
    ...(jenis === 'ktp'
      ? [
          'Perekaman KTP-el pertama (usia 17 tahun atau sudah kawin) dilakukan langsung di Disdukcapil atau kecamatan: foto, sidik jari, dan iris mata.',
        ]
      : []),
    'Tidak ada biaya resmi. Tolak bila ada yang meminta bayaran dan laporkan lewat SP4N-LAPOR! (lapor.go.id).',
  ];
}

/**
 * Paket kartu rencana mode dipandu: kalimat positif (daerah tanpa Pendamping: "sedang dikembangkan"), kanal resmi
 * daerah yang bisa diklik, biaya (bersumber), perkiraan waktu, tips, dan bantuan lanjutan yang memang tersedia.
 */
export function paketDipandu(
  jenis: string | null,
  w: { ktp: WilayahRef; tujuan?: WilayahRef | null },
): PaketDipandu {
  const kode = w.ktp.kodeKabKota;
  const pendek = namaPendekWilayah(w.ktp.nama);
  const p = portalWilayah(kode);
  const kanal = kanalDipandu(kode, jenis);
  // Pindah: Disdukcapil tujuan menerbitkan KK/KTP-el baru, jadi kanal utamanya ikut.
  const tujuan =
    jenis === 'pindah' && w.tujuan && w.tujuan.kodeKabKota !== kode
      ? kanalDipandu(w.tujuan.kodeKabKota, jenis)[0]
      : undefined;
  if (tujuan && !kanal.some((k) => k.url && tujuan.url && kunciUrl(k.url) === kunciUrl(tujuan.url)))
    kanal.splice(Math.min(kanal.length, MAKS_KANAL - 1), 1, tujuan);
  const berkembang = !pendampingAktif(kode);
  const sisipan =
    p?.jenis === 'whatsapp'
      ? `Disdukcapil ${pendek} melayani pengajuan lewat WhatsApp.`
      : p?.jenis === 'aplikasi'
        ? `Disdukcapil ${pendek} melayani pengajuan lewat aplikasi ponsel resmi.`
        : undefined;
  const gratis = fakta('gratis');
  const f = formulir(jenis);
  return {
    pesan: berkembang
      ? kalimatPendampingBerkembang(pendek, sisipan)
      : `Untuk urusan ini, Urusin memandu Anda langkah demi langkah lewat kanal resmi Disdukcapil ${pendek}.`,
    pendampingBerkembang: berkembang,
    kanal,
    biaya: gratis
      ? { teks: `Gratis. ${gratis.teks} (${gratis.pasal})`, sumber: gratis.sourceRef[0] }
      : { teks: 'Gratis: dokumen kependudukan tidak dipungut biaya.' },
    waktu: waktu(jenis),
    tips: tips(jenis, p?.jamLayanan),
    lanjutan: [
      f
        ? `Tanyakan ke saya cara mengisi formulir ${f} yang disediakan petugas; saya pandu kolom demi kolom.`
        : 'Tanyakan ke saya formulir apa yang perlu diisi; saya pandu kolom demi kolom.',
      'Simpan foto berkas di menu Dokumen supaya siap dibawa dan dipakai lagi.',
      'Urusan ini tersimpan di Urusanku: kembali kapan saja, saya lanjutkan dari langkah terakhir.',
      'Ceritakan kendala di loket (berkas ditolak, antrean penuh); saya bantu cari jalan keluarnya.',
    ],
  };
}

/**
 * Arahan untuk model saat jawaban bersumber gagal untuk urusan adminduk: panduan umum yang jujur, bukan hand-off.
 * Kanal yang boleh disebut hanya dari registry (`kanal`).
 */
export function arahanPanduanUmum(kanal: readonly Kanal[]): string {
  const daftar = kanal
    .map((k) => `${k.nama}${k.url ? ` (${k.url})` : ''}${k.kontak ? `, ${k.kontak}` : ''}`)
    .join('; ');
  return [
    'Korpus resmi Urusin belum memuat kutipan untuk pertanyaan ini. JANGAN berhenti, jangan menolak, dan jangan hanya menyuruh warga bertanya sendiri.',
    'Jawab sebagai PANDUAN UMUM dari pengetahuanmu tentang aturan adminduk nasional. Kalimat pertama balasanmu persis: "Panduan umum (belum dari sumber resmi daerah, cek ulang di kanal resmi):". Lalu beri langkah konkret, dokumen yang biasanya diminta, dan perkiraan waktu. Patuhi FAKTA HUKUM TERKINI; biaya adminduk gratis (UU 24/2013 Ps. 79A).',
    daftar
      ? `Tutup dengan kanal resmi daerah ini, sebut nama dan alamat situsnya: ${daftar}.`
      : 'Tutup dengan saran memastikan ke kantor Disdukcapil setempat.',
    'Jangan menulis nomor telepon/WhatsApp, alamat, atau situs yang tidak ada di daftar kanal itu.',
  ].join(' ');
}
