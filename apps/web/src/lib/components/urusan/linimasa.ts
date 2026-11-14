import type { EventOf, UrusinEvent } from '#lib/contracts.js';
import type { PesanWarga } from '#lib/stores/lokal.svelte.js';

/** Satu gelembung/kartu di percakapan urusan, diturunkan dari event SSE + pesan warga di perangkat. */
export type ItemLinimasa =
  | { jenis: 'warga'; key: string; teks: string; setelahSeq: number }
  | { jenis: 'sistem'; key: string; teks: string; at: string }
  | { jenis: 'teks'; key: string; teks: string }
  | { jenis: 'jawaban'; key: string; e: EventOf<'grounded_answer'> }
  | { jenis: 'handoff'; key: string; e: EventOf<'handoff'> }
  | { jenis: 'rencana'; key: string; e: EventOf<'plan_card'>; terakhir: boolean }
  | { jenis: 'wilayah'; key: string; e: EventOf<'wilayah'>; terakhir: boolean }
  /** Ingatan warga berubah (ADR 0031); `dibatalkan` = butir ini sudah dihapus lagi di event berikutnya. */
  | { jenis: 'ingatan'; key: string; e: EventOf<'ingatan'>; dibatalkan: boolean }
  | { jenis: 'checklist'; key: string; e: EventOf<'checklist'> }
  | {
      jenis: 'konfirmasi';
      key: string;
      gate: EventOf<'gate'>;
      permintaan: EventOf<'execution_request'> | null;
      terakhir: boolean;
    }
  | { jenis: 'giliran'; key: string; gate: EventOf<'gate'>; terakhir: boolean }
  | { jenis: 'galat'; key: string; e: EventOf<'error'>; terakhir: boolean }
  | { jenis: 'waktu-habis'; key: string; terakhir: boolean }
  | { jenis: 'terkirim'; key: string; at: string };

/**
 * Kalimat sistem untuk transisi state yang perlu dilihat warga (lainnya cukup di panel). BERKAS_SIAP dan MENGISI
 * sengaja tidak di sini: harness memajukan keduanya sebagai pembukuan saat rencana disetujui (sebelum berkas
 * diperiksa dan sebelum situs dibuka). "Semua dokumen siap" hanya dari checklist yang benar-benar lengkap (lihat
 * `bangunLinimasa`); fase isi nyata tampil di layar Browser Pendamping.
 */
const KALIMAT_STATE: Partial<Record<EventOf<'state'>['state'], string>> = {
  RENCANA_DISETUJUI: 'Anda menyetujui rencana',
  DIPANDU: 'Beralih ke mode dipandu: Anda mengisi sendiri dengan panduan',
  DIBATALKAN: 'Urusan dibatalkan',
  GAGAL_AMAN: 'Urusin berhenti dengan aman. Tidak ada yang dikirim.',
  DITOLAK: 'Instansi menolak pengajuan',
  SELESAI: 'Urusan selesai',
};

/** `jenis` (opsional) = jenis urusan, untuk kalimat wilayah yang tepat per jenis (lihat `kalimatWilayah`). */
export function bangunLinimasa(
  events: readonly UrusinEvent[],
  pesan: readonly PesanWarga[],
  jenis?: string | null,
): ItemLinimasa[] {
  const out: ItemLinimasa[] = [];
  const warga = [...pesan].sort((a, b) => a.setelahSeq - b.setelahSeq);
  let iw = 0;
  const st: { teks: { jenis: 'teks'; key: string; teks: string } | null } = { teks: null };
  const permintaan = new Map<string, EventOf<'execution_request'>>();
  let permintaanTerakhir: EventOf<'execution_request'> | null = null;
  let wilayahDitetapkanSeq = 0;
  // Checklist terakhir yang sudah tiba: dasar satu-satunya untuk "Semua dokumen siap".
  let checklistTerakhir: EventOf<'checklist'> | null = null;

  const sisipkanWarga = (sampaiSeq: number) => {
    while (iw < warga.length && warga[iw]!.setelahSeq < sampaiSeq) {
      const w = warga[iw]!;
      out.push({ jenis: 'warga', key: `w${iw}-${w.setelahSeq}`, teks: w.teks, setelahSeq: w.setelahSeq });
      st.teks = null;
      iw++;
    }
  };

  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'heartbeat') continue;
    sisipkanWarga(e.seq);
    const key = `e${e.seq}`;
    switch (e.type) {
      case 'assistant_text':
        // Pesan utuh dari server (di luar turn): gelembung sendiri, tidak menyambung dan tidak disambung.
        if (e.utuh) {
          out.push({ jenis: 'teks', key, teks: e.delta });
          st.teks = null;
        } else if (st.teks) st.teks.teks += e.delta;
        else {
          st.teks = { jenis: 'teks', key, teks: e.delta };
          out.push(st.teks);
        }
        continue;
      case 'done':
        st.teks = null;
        continue;
      // Progres membuka turn/langkah baru: teks berikutnya tidak menyambung pesan sebelumnya (mis. pesan tetap
      // "Rencana disetujui…" yang terbit di luar turn, tanpa `done`). Teks model terbit sekali di akhir turn.
      case 'progress':
        st.teks = null;
        continue;
      case 'grounded_answer':
        out.push({ jenis: 'jawaban', key, e });
        break;
      case 'handoff':
        out.push({ jenis: 'handoff', key, e });
        break;
      case 'plan_card':
        out.push({ jenis: 'rencana', key, e, terakhir: false });
        break;
      case 'checklist':
        checklistTerakhir = e;
        out.push({ jenis: 'checklist', key, e });
        break;
      case 'wilayah':
        if (e.status === 'usulan') out.push({ jenis: 'wilayah', key, e, terakhir: false });
        else {
          wilayahDitetapkanSeq = e.seq;
          out.push({ jenis: 'sistem', key, teks: kalimatWilayah(e, jenis), at: e.at });
        }
        break;
      case 'ingatan':
        if (e.aksi === 'hapus')
          for (const it of out)
            if (it.jenis === 'ingatan' && it.e.butir.id === e.butir.id) it.dibatalkan = true;
        out.push({ jenis: 'ingatan', key, e, dibatalkan: false });
        break;
      case 'execution_request':
        permintaan.set(e.paramsHash, e);
        permintaanTerakhir = e;
        continue;
      case 'gate':
        if (e.jenis === 'konfirmasi')
          out.push({
            jenis: 'konfirmasi',
            key,
            gate: e,
            permintaan: (e.paramsHash && permintaan.get(e.paramsHash)) || permintaanTerakhir,
            terakhir: false,
          });
        else out.push({ jenis: 'giliran', key, gate: e, terakhir: false });
        break;
      case 'error':
        out.push({ jenis: 'galat', key, e, terakhir: false });
        break;
      case 'timeout':
        out.push({ jenis: 'waktu-habis', key, terakhir: false });
        break;
      case 'state': {
        if (e.state === 'TERKIRIM') out.push({ jenis: 'terkirim', key, at: e.at });
        else if (e.state === 'BERKAS_SIAP') {
          if (e.dari !== e.state && dokumenLengkap(checklistTerakhir))
            out.push({ jenis: 'sistem', key, teks: 'Semua dokumen siap', at: e.at });
        } else {
          const teks = KALIMAT_STATE[e.state];
          if (teks && e.dari !== e.state) out.push({ jenis: 'sistem', key, teks, at: e.at });
        }
        break;
      }
      default:
        continue;
    }
    st.teks = null;
  }
  sisipkanWarga(Number.POSITIVE_INFINITY);

  // Hanya kartu terakhir dari tiap jenis yang masih bisa ditindaklanjuti.
  for (const jenis of ['rencana', 'wilayah', 'konfirmasi', 'giliran', 'galat', 'waktu-habis'] as const) {
    for (let i = out.length - 1; i >= 0; i--) {
      const it = out[i]!;
      if (it.jenis === jenis) {
        (it as { terakhir: boolean }).terakhir = true;
        break;
      }
    }
  }
  // Galat/waktu habis yang sudah disusul pesan warga atau jawaban baru tidak lagi aktif.
  const idxTerakhirWarga = out.map((x) => x.jenis).lastIndexOf('warga');
  for (let i = 0; i < out.length; i++) {
    const it = out[i]!;
    if ((it.jenis === 'galat' || it.jenis === 'waktu-habis') && i < idxTerakhirWarga) it.terakhir = false;
    // Usulan wilayah yang sudah dijawab (wilayah ditetapkan sesudahnya) tidak bisa dikonfirmasi lagi.
    if (it.jenis === 'wilayah' && it.e.seq < wilayahDitetapkanSeq) it.terakhir = false;
  }
  return kartuWilayahSaatPerlu(out, jenis);
}

/**
 * Kartu wilayah hanya muncul saat dibutuhkan (keputusan pemilik 2026-11-14), bukan sebagai pembuka obrolan.
 * Usulan yang terbit saat urusan dibuat (Data Diri, pilihan perangkat, Ingatan) disembunyikan selama jenis urusan
 * belum jelas, lalu tampil di ujung percakapan begitu jenisnya diketahui (rencana memang menunggu wilayah).
 * Usulan `warga` terbit tepat saat agen menanyakan wilayah di obrolan, jadi tetap di tempatnya. Usulan awal yang
 * sudah tidak aktif tidak ditampilkan: wilayah yang ditetapkan tampil sebagai kalimat sistem.
 */
function kartuWilayahSaatPerlu(out: ItemLinimasa[], jenis: string | null | undefined): ItemLinimasa[] {
  const jenisJelas = !!jenis && jenis !== 'lainnya';
  const hasil: ItemLinimasa[] = [];
  const ditunda: ItemLinimasa[] = [];
  for (const it of out) {
    if (it.jenis !== 'wilayah' || it.e.sumber === 'warga') hasil.push(it);
    else if (it.terakhir && jenisJelas) ditunda.push(it);
  }
  return [...hasil, ...ditunda];
}

/**
 * Jenis urusan terkini dari stream: `plan_card` atau `done` terakhir yang membawanya, selain itu jenis saat halaman
 * dimuat. Halaman bisa dimuat sebelum harness mengklasifikasi, dan giliran yang hanya berakhir dengan kartu wilayah
 * tidak punya kartu rencana.
 */
export function jenisTerkini(events: readonly UrusinEvent[], awal: string | null): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if ((e.type === 'plan_card' || e.type === 'done') && e.jenis) return e.jenis;
  }
  return awal;
}

/** Checklist ada, tidak kosong, dan semua butirnya `ok`. */
function dokumenLengkap(c: EventOf<'checklist'> | null): boolean {
  return !!c && c.item.length > 0 && c.item.every((i) => i.status === 'ok');
}

/**
 * Kalimat wilayah yang ditetapkan, netral terhadap jenis urusan: wilayah yang menentukan layanan tidak selalu
 * wilayah KTP pelapor (kematian: domisili almarhum). Pindah: "Pindah dari X ke Y". Domisili berbeda ditambahkan.
 */
export function kalimatWilayah(e: EventOf<'wilayah'>, jenis?: string | null): string {
  let t =
    e.tujuan || jenis === 'pindah'
      ? e.tujuan
        ? `Pindah dari ${e.ktp.nama} ke ${e.tujuan.nama}`
        : `Pindah dari ${e.ktp.nama}`
      : `Wilayah layanan: ${e.ktp.nama}`;
  if (e.domisili) t += ` · tinggal di ${e.domisili.nama}`;
  return t;
}

const LABEL_ALAT: Record<string, string> = {
  rag__cari_pengetahuan: 'Mencari sumber resmi…',
  web__cari: 'Mencari di situs resmi pemerintah…',
  urusan__jawab_persyaratan: 'Menyusun jawaban dari sumber resmi…',
  urusan__susun_rencana: 'Menyusun rencana…',
};

/** Label progres umum; gelembung mengetik cukup menampilkan tiga titik (teks ini hanya untuk pembaca layar). */
export const LABEL_UMUM_PROGRES = 'Urusin sedang bekerja…';

/** Label progres tanpa nama teknis tool (design system tim: jangan tampilkan penanda teknis). */
export function labelProgres(label: string | null, toolName?: string): string {
  if (toolName && LABEL_ALAT[toolName]) return LABEL_ALAT[toolName]!;
  if (!label) return LABEL_UMUM_PROGRES;
  const m = /^Menjalankan ([\w-]+)…?$/.exec(label);
  if (m) return LABEL_ALAT[m[1]!] ?? LABEL_UMUM_PROGRES;
  return label;
}

/** Nama parameter formulir yang terbaca warga: `namaAnak` / `nama_anak` → "Nama anak". */
export function labelParam(kunci: string): string {
  const s = kunci
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : kunci;
}

/** Nilai parameter untuk layar konfirmasi: placeholder Data Diri tidak pernah ditampilkan mentah. */
export function nilaiParam(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  const s = String(v);
  if (/\{\{[^}]+\}\}/.test(s)) return 'Diambil dari Data Diri Anda';
  return s;
}

/**
 * Kutipan unik per `refId`, urutan pertama dipertahankan. Satu klaim bisa membawa beberapa kutipan persis dari
 * potongan sumber yang sama; tanpa ini blok `{#each … (q.refId)}` melempar each_key_duplicate dan halaman urusan
 * jatuh ke 500 setiap kali dimuat.
 */
export function unikPerRef<T extends { refId: string }>(kutipan: readonly T[]): T[] {
  const peta = new Map<string, T>();
  for (const q of kutipan) if (!peta.has(q.refId)) peta.set(q.refId, q);
  return [...peta.values()];
}

/** Parameter rute Pendamping (jalur portal, kode wilayah, id layanan): penanda teknis, bukan isian warga. */
const PARAM_TEKNIS = new Set(['jalur', 'kode', 'jenis', 'layanan_id', 'layananId', 'urusinCode']);

/** Baris "periksa sebelum AI mengisi": tanpa parameter teknis; daftar berkas adapter dibuat terbaca. */
export function barisKonfirmasi(
  params: Readonly<Record<string, string | number | boolean>>,
): [label: string, nilai: string][] {
  return Object.entries(params)
    .filter(([k]) => !PARAM_TEKNIS.has(k))
    .slice(0, 12)
    .map(([k, v]): [string, string] =>
      k === 'berkas' && typeof v === 'string'
        ? [
            'Berkas yang diunggah',
            v
              .split(',')
              .map((b) => b.trim().toUpperCase())
              .filter(Boolean)
              .join(', '),
          ]
        : [labelParam(k), nilaiParam(v)],
    );
}
