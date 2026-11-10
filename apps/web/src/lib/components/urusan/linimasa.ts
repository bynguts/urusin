import type { EventOf, UrusinEvent } from '#lib/contracts.js';
import type { PesanWarga } from '#lib/stores/lokal.svelte.js';

/** Satu gelembung/kartu di percakapan urusan, diturunkan dari event SSE + pesan warga di perangkat. */
export type ItemLinimasa =
  | { jenis: 'warga'; key: string; teks: string }
  | { jenis: 'sistem'; key: string; teks: string; at: string }
  | { jenis: 'teks'; key: string; teks: string }
  | { jenis: 'jawaban'; key: string; e: EventOf<'grounded_answer'> }
  | { jenis: 'handoff'; key: string; e: EventOf<'handoff'> }
  | { jenis: 'rencana'; key: string; e: EventOf<'plan_card'>; terakhir: boolean }
  | { jenis: 'wilayah'; key: string; e: EventOf<'wilayah'>; terakhir: boolean }
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

/** Kalimat sistem untuk transisi state yang perlu dilihat warga (lainnya cukup di panel). */
const KALIMAT_STATE: Partial<Record<EventOf<'state'>['state'], string>> = {
  RENCANA_DISETUJUI: 'Anda menyetujui rencana',
  BERKAS_SIAP: 'Semua dokumen siap',
  MENGISI: 'AI mulai mengisi formulir di situs resmi',
  DIPANDU: 'Beralih ke mode dipandu: Anda mengisi sendiri dengan panduan',
  DIBATALKAN: 'Urusan dibatalkan',
  GAGAL_AMAN: 'Urusin berhenti dengan aman. Tidak ada yang dikirim.',
  DITOLAK: 'Instansi menolak pengajuan',
  SELESAI: 'Urusan selesai',
};

export function bangunLinimasa(events: readonly UrusinEvent[], pesan: readonly PesanWarga[]): ItemLinimasa[] {
  const out: ItemLinimasa[] = [];
  const warga = [...pesan].sort((a, b) => a.setelahSeq - b.setelahSeq);
  let iw = 0;
  const st: { teks: { jenis: 'teks'; key: string; teks: string } | null } = { teks: null };
  const permintaan = new Map<string, EventOf<'execution_request'>>();
  let permintaanTerakhir: EventOf<'execution_request'> | null = null;
  let wilayahDitetapkanSeq = 0;

  const sisipkanWarga = (sampaiSeq: number) => {
    while (iw < warga.length && warga[iw]!.setelahSeq < sampaiSeq) {
      const w = warga[iw]!;
      out.push({ jenis: 'warga', key: `w${iw}-${w.setelahSeq}`, teks: w.teks });
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
        if (st.teks) st.teks.teks += e.delta;
        else {
          st.teks = { jenis: 'teks', key, teks: e.delta };
          out.push(st.teks);
        }
        continue;
      case 'done':
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
        out.push({ jenis: 'checklist', key, e });
        break;
      case 'wilayah':
        if (e.status === 'usulan') out.push({ jenis: 'wilayah', key, e, terakhir: false });
        else {
          wilayahDitetapkanSeq = e.seq;
          out.push({ jenis: 'sistem', key, teks: kalimatWilayah(e), at: e.at });
        }
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
        else {
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
  return out;
}

/** "Wilayah KTP: Kabupaten Wonogiri" + tujuan pindah/domisili bila ada. */
export function kalimatWilayah(e: EventOf<'wilayah'>): string {
  let t = `Wilayah KTP: ${e.ktp.nama}`;
  if (e.tujuan) t += ` · pindah ke ${e.tujuan.nama}`;
  if (e.domisili) t += ` · tinggal di ${e.domisili.nama}`;
  return t;
}

const LABEL_ALAT: Record<string, string> = {
  rag__cari_pengetahuan: 'Mencari sumber resmi…',
  urusan__jawab_persyaratan: 'Menyusun jawaban dari sumber resmi…',
  urusan__susun_rencana: 'Menyusun rencana…',
};

/** Label progres tanpa nama teknis tool (DESIGN.md: jangan tampilkan penanda teknis). */
export function labelProgres(label: string | null, toolName?: string): string {
  if (toolName && LABEL_ALAT[toolName]) return LABEL_ALAT[toolName]!;
  if (!label) return 'Urusin sedang bekerja…';
  const m = /^Menjalankan ([\w-]+)…?$/.exec(label);
  if (m) return LABEL_ALAT[m[1]!] ?? 'Urusin sedang bekerja…';
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
