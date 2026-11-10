// Satu percakapan persona dari Beranda sampai warga berhenti (atau batas giliran).
import { SesiWarga } from './klien.mjs';
import { renderLangkahAgen, tombolTersedia } from './layar.mjs';
import { aksiWarga } from './warga.mjs';

/**
 * @param {{origin: string, ip: string, persona: object, llmWarga: import('./llm.mjs').KlienLlm,
 *          wilayahPerangkat: string, maksGiliran: number, log?: (s: string) => void}} o
 */
export async function jalankanPercakapan({
  origin,
  ip,
  persona,
  llmWarga,
  wilayahPerangkat,
  maksGiliran,
  log,
}) {
  const rahasia = persona.rahasia?.() ?? {};
  const sesi = new SesiWarga({ origin, ip });
  const langkah = [];
  const layar = [];
  const mulaiMs = Date.now();
  let akhir = { alasan: 'batas_giliran', puas: false };
  const catat = (s) => log?.(`[${persona.id}] ${s}`);

  const tambahAgen = (events, extra = {}) => {
    const l = { peran: 'urusin', events, ...extra };
    langkah.push(l);
    const t = renderLangkahAgen(events, { denganProgres: extra.aksi === 'setujui' });
    layar.push(t || '(Urusin tidak menampilkan apa-apa)');
  };

  try {
    const pesan1 =
      typeof persona.pesanPertama === 'function' ? persona.pesanPertama(rahasia) : persona.pesanPertama;
    const t0 = Date.now();
    const r = await sesi.mulai(pesan1, wilayahPerangkat);
    langkah.push({ peran: 'warga', jenis: 'ketik', teks: pesan1, http: { status: r.status, kode: r.kode } });
    layar.push(`Warga: ${pesan1}`);
    if (r.status !== 303) {
      layar.push(`[GALAT] ${r.pesanWarga ?? 'Urusan tidak bisa dimulai.'}`);
      akhir = { alasan: 'gagal_mulai', puas: false };
      return selesai();
    }
    const done = await sesi.tungguDone(0, null);
    tambahAgen(sesi.sejak(0), { status: done?.status ?? 'tanpa_done', ms: Date.now() - t0 });
    catat(`giliran 1 selesai (${done?.status ?? 'tanpa_done'})`);

    for (let giliran = 2; giliran <= maksGiliran; giliran++) {
      const tombol = tombolTersedia(sesi.events);
      const a = await aksiWarga(llmWarga, {
        persona,
        rahasia,
        layar,
        tombol,
        sisaGiliran: maksGiliran - giliran + 1,
      });
      if (a.aksi === 'selesai') {
        akhir = { alasan: 'warga_selesai', puas: a.puas, catatan: a.alasan };
        break;
      }
      if (a.aksi === 'klik' && a.tombol === 'Setujui dan buka situs') {
        langkah.push({ peran: 'warga', jenis: 'klik', teks: a.tombol, alasan: a.alasan });
        layar.push(`Warga menekan [${a.tombol}]`);
        akhir = {
          alasan: 'pendamping_dibuka',
          puas: true,
          catatan: 'Browser Pendamping di luar cakupan eval',
        };
        break;
      }
      if (a.aksi === 'klik') {
        const t1 = Date.now();
        const s = await sesi.setujuiRencana();
        langkah.push({ peran: 'warga', jenis: 'klik', teks: a.tombol, http: s.http, alasan: a.alasan });
        layar.push(`Warga menekan [${a.tombol}]`);
        if (s.http.status >= 400) layar.push(`[GALAT] ${s.http.pesanWarga ?? `HTTP ${s.http.status}`}`);
        tambahAgen(sesi.sejak(s.seqAwal), { status: 'selesai', aksi: 'setujui', ms: Date.now() - t1 });
        catat(`giliran ${giliran}: klik ${a.tombol} -> ${s.body?.state ?? s.http.status}`);
        continue;
      }
      const t1 = Date.now();
      const k = await sesi.kirim(a.teks);
      langkah.push({ peran: 'warga', jenis: 'ketik', teks: a.teks, http: k.http, alasan: a.alasan });
      layar.push(`Warga: ${a.teks}`);
      if (k.http.status >= 400) {
        layar.push(`[GALAT] ${k.http.pesanWarga ?? `HTTP ${k.http.status}`}`);
        catat(`giliran ${giliran}: HTTP ${k.http.status} ${k.http.kode ?? ''}`);
        continue;
      }
      tambahAgen(sesi.sejak(k.seqAwal), { status: k.done?.status ?? 'tanpa_done', ms: Date.now() - t1 });
      catat(`giliran ${giliran} selesai (${k.done?.status ?? 'tanpa_done'})`);
    }
  } catch (e) {
    akhir = { alasan: 'galat_eval', puas: false, catatan: String(e?.message ?? e) };
    catat(`galat: ${akhir.catatan}`);
  }
  return selesai();

  async function selesai() {
    const kodeUrusan = sesi.id ? await sesi.kodeUrusan().catch(() => null) : null;
    sesi.tutup();
    return {
      persona: persona.id,
      urusanId: sesi.id,
      wilayahPerangkat,
      kodeUrusan,
      langkah,
      layar,
      akhir,
      rahasia,
      ms: Date.now() - mulaiMs,
      giliranWarga: langkah.filter((l) => l.peran === 'warga').length,
    };
  }
}
