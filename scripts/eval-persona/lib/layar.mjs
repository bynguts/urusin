// Ubah event agen menjadi teks "layar" seperti yang dilihat warga di halaman urusan (kartu rencana, jawaban
// bersumber, hand-off, kartu konfirmasi Browser Pendamping, galat). Dipakai simulator warga, juri, dan transkrip.

const JENIS_LANGKAH = {
  'online-adapter': 'online (dibantu)',
  'online-manual': 'online',
  offline: 'datang langsung',
  'cek-kanal': 'cek kanal di Disdukcapil setempat',
};

export function renderEvent(e) {
  switch (e.type) {
    case 'assistant_text':
      return `Urusin: ${e.delta}`;
    case 'plan_card': {
      const baris = e.langkah.map((l, i) => {
        const sumber = (l.sumber ?? []).map((s) => `${s.judul} (${s.url})`).join('; ');
        return [
          `  ${i + 1}. ${l.judul} [${JENIS_LANGKAH[l.jenis] ?? l.jenis}${l.lokasi ? `, ${l.lokasi}` : ''}]`,
          l.bawa?.length ? `     Bawa: ${l.bawa.join(', ')}` : '',
          sumber ? `     Sumber: ${sumber}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      });
      return `[KARTU RENCANA] ${e.ringkasan}${wilayahRencana(e)}${e.catatan ? `\n  Catatan: ${e.catatan}` : ''}\n${baris.join('\n')}`;
    }
    case 'wilayah':
      return e.status === 'usulan'
        ? `[KARTU WILAYAH] KTP Anda terdaftar di ${e.ktp.nama}? (usulan dari ${e.sumber === 'data_diri' ? 'Data Diri akun Anda' : e.sumber === 'warga' ? 'percakapan ini' : 'pilihan wilayah di perangkat ini'}; rencana disusun setelah Anda memastikannya)`
        : `(sistem) ${kalimatWilayah(e)}`;
    case 'grounded_answer': {
      const klaim = e.klaim.map(
        (k) =>
          `  - ${k.teks}\n    (sumber: ${k.kutipan.map((q) => `${q.judul} — ${q.instansi}, ${q.url}`).join('; ')})`,
      );
      return `[JAWABAN BERSUMBER]\n${klaim.join('\n')}${e.klaimDibuang ? `\n  (${e.klaimDibuang} klaim dibuang karena kutipan tidak terverifikasi)` : ''}\n  ${e.kalimatTetap}`;
    }
    case 'handoff':
      return `[DIARAHKAN KE KANAL RESMI] ${e.alasan}\n${e.kanal.map((k) => `  - ${k.nama}${k.url ? ` ${k.url}` : ''}${k.kontak ? ` (${k.kontak})` : ''}`).join('\n')}`;
    case 'execution_request':
      return `[KARTU BROWSER PENDAMPING] ${e.ringkasan}${e.origin ? ` Situs: ${e.origin}` : ''}${e.bacaSaja ? ' (baca saja)' : ''}`;
    case 'gate':
      return e.jenis === 'konfirmasi' ? `[KONFIRMASI] ${e.pesan}` : `[MENUNGGU WARGA: ${e.jenis}] ${e.pesan}`;
    case 'error':
      return `[GALAT] ${e.pesanWarga}`;
    default:
      return '';
  }
}

/** Sama dengan kalimatWilayah di apps/web/src/lib/components/urusan/linimasa.ts (feat/wilayah-dulu). */
function kalimatWilayah(e) {
  let t = `Wilayah KTP: ${e.ktp.nama}`;
  if (e.tujuan) t += ` · pindah ke ${e.tujuan.nama}`;
  if (e.domisili) t += ` · tinggal di ${e.domisili.nama}`;
  return t;
}

function wilayahRencana(e) {
  if (!e.wilayah) return '';
  return `\n  ${kalimatWilayah(e.wilayah)}${e.tier ? ` (tingkat ${e.tier})` : ''}`;
}

/** Teks layar satu langkah agen (event yang terlihat warga saja). */
export function renderLangkahAgen(events, { denganProgres = false } = {}) {
  const out = [];
  for (const e of events) {
    if (e.type === 'progress' && denganProgres) out.push(`(status: ${e.label})`);
    const t = renderEvent(e);
    if (t) out.push(t);
  }
  return out.join('\n');
}

/**
 * Tombol yang tampil setelah semua event sejauh ini: "Setujui rencana" saat urusan RENCANA_DIUSULKAN dengan kartu
 * rencana; "Setujui dan buka situs" saat ada kartu konfirmasi Browser Pendamping yang belum dijawab.
 */
export function tombolTersedia(events) {
  let state = null;
  let adaRencana = false;
  let konfirmasi = false;
  let usulan = null;
  let ditetapkanSeq = 0;
  for (const e of events) {
    if (e.type === 'state') state = e.state;
    if (e.type === 'plan_card') adaRencana = true;
    if (e.type === 'gate' && e.jenis === 'konfirmasi' && e.paramsHash) konfirmasi = true;
    if (e.type === 'wilayah' && e.status === 'usulan') usulan = e;
    if (e.type === 'wilayah' && e.status === 'ditetapkan') ditetapkanSeq = e.seq;
  }
  const t = [];
  // Kartu wilayah (feat/wilayah-dulu: linimasa.ts + urusan/[id]/+page.svelte): usulan terakhir yang belum
  // dijawab, aktif selama urusan BARU/MEMAHAMI.
  if (usulan && usulan.seq > ditetapkanSeq && (state === null || state === 'BARU' || state === 'MEMAHAMI'))
    t.push('Ya, betul', 'Bukan');
  if (state === 'RENCANA_DIUSULKAN' && adaRencana) t.push('Setujui rencana');
  if (konfirmasi) t.push('Setujui dan buka situs');
  return t;
}

/** Usulan wilayah yang sedang bisa dijawab "Ya, betul", atau null. */
export function usulanWilayahAktif(events) {
  if (!tombolTersedia(events).includes('Ya, betul')) return null;
  return [...events].reverse().find((e) => e.type === 'wilayah' && e.status === 'usulan') ?? null;
}

export function stateTerakhir(events) {
  let s = null;
  for (const e of events) if (e.type === 'state') s = e.state;
  return s;
}
