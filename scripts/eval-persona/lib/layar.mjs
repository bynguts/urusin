// Ubah event agen menjadi teks "layar" seperti yang dilihat warga di halaman urusan (kartu rencana, jawaban
// bersumber, hand-off, kartu konfirmasi Browser Pendamping, galat). Dipakai simulator warga, juri, dan transkrip.

const JENIS_LANGKAH = {
  'online-adapter': 'online (dibantu)',
  'online-manual': 'online',
  offline: 'datang langsung',
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
      return `[KARTU RENCANA] ${e.ringkasan}\n${baris.join('\n')}`;
    }
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
  for (const e of events) {
    if (e.type === 'state') state = e.state;
    if (e.type === 'plan_card') adaRencana = true;
    if (e.type === 'gate' && e.jenis === 'konfirmasi' && e.paramsHash) konfirmasi = true;
  }
  const t = [];
  if (state === 'RENCANA_DIUSULKAN' && adaRencana) t.push('Setujui rencana');
  if (konfirmasi) t.push('Setujui dan buka situs');
  return t;
}

export function stateTerakhir(events) {
  let s = null;
  for (const e of events) if (e.type === 'state') s = e.state;
  return s;
}
