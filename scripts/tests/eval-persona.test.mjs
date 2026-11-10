// Tes pemeriksa deterministik eval persona. Data uji (NIK sintetis) dibangun dari potongan agar file ini
// tidak memicu pii-scan.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cekBocorWilayah,
  cekFinalOlehWarga,
  cekGalat,
  cekGemaPii,
  cekPendamping,
  cekWilayahSebelumRencana,
  nikSintetis,
  samarkan,
  urlTampil,
} from '../eval-persona/lib/periksa.mjs';
import { dataAksi } from '../eval-persona/lib/klien.mjs';
import { jalankanPercakapan } from '../eval-persona/lib/percakapan.mjs';

const ev = (type, isi = {}) => ({ type, seq: 1, at: '2026-11-10T00:00:00.000Z', chainHead: 'x', ...isi });
const warga = (teks) => ({ peran: 'warga', jenis: 'ketik', teks, http: { status: 202 } });
const klik = (tombol) => ({ peran: 'warga', jenis: 'klik', teks: tombol, http: { status: 200 } });
const urusin = (...events) => ({ peran: 'urusin', status: 'selesai', events });
const teks = (t) => ev('assistant_text', { delta: t });
const rencana = (url) =>
  ev('plan_card', {
    ringkasan: 'Kelahiran',
    langkah: [
      {
        id: 'a',
        jenis: 'online-manual',
        judul: 'Ajukan',
        bawa: [],
        sumber: [{ url, judul: 'x', instansi: 'y' }],
      },
    ],
  });

describe('nikSintetis', () => {
  it('menghasilkan 16 digit berawalan kode kab/kota yang diminta', () => {
    const nik = nikSintetis('3404');
    assert.match(nik, /^3404\d{12}$/);
  });
  it('deterministik untuk kode yang sama (transkrip bisa diulang)', () => {
    assert.equal(nikSintetis('3312'), nikSintetis('3312'));
  });
});

describe('samarkan', () => {
  it('mengganti NIK sintetis dan nama rahasia dengan penanda', () => {
    const nik = nikSintetis('3312');
    const out = samarkan(`NIK saya ${nik}, ibu kandung Sutinah Wiryo`, { nik, ibu: 'Sutinah Wiryo' });
    assert.equal(out, 'NIK saya «NIK_SINTETIS», ibu kandung «NAMA_IBU_SINTETIS»');
  });
  it('juga menyamarkan NIK yang ditulis berpemisah spasi', () => {
    const nik = nikSintetis('3312');
    const spasi = `${nik.slice(0, 6)} ${nik.slice(6, 12)} ${nik.slice(12)}`;
    assert.equal(samarkan(spasi, { nik }), '«NIK_SINTETIS»');
  });
});

describe('urlTampil', () => {
  it('mengumpulkan URL dari kartu rencana, jawaban bersumber, hand-off, dan teks', () => {
    const langkah = [
      urusin(
        rencana('https://disdukcapil.wonogirikab.go.id/layanan/a'),
        teks('Buka https://dukcapil.kemendagri.go.id ya.'),
        ev('handoff', {
          alasan: 'x',
          sebab: 'tanpa_sumber',
          kanal: [{ nama: 'Polri', url: 'https://skck.polri.go.id/' }],
        }),
      ),
    ];
    assert.deepEqual(urlTampil(langkah).sort(), [
      'https://disdukcapil.wonogirikab.go.id/layanan/a',
      'https://dukcapil.kemendagri.go.id',
      'https://skck.polri.go.id/',
    ]);
  });
  it('tidak menghitung pesan warga', () => {
    assert.deepEqual(urlTampil([warga('lihat https://contoh.go.id')]), []);
  });
});

describe('cekBocorWilayah', () => {
  const sleman = { wilayahTerkait: ['sleman'] };
  it('gagal bila warga Sleman diberi tautan Disdukcapil Wonogiri', () => {
    const r = cekBocorWilayah([urusin(rencana('https://disdukcapil.wonogirikab.go.id/layanan/a'))], sleman);
    assert.equal(r.lulus, false);
    assert.match(r.bukti, /wonogirikab\.go\.id/);
  });
  it('gagal bila teks menyebut Wonogiri untuk warga non-Wonogiri', () => {
    const r = cekBocorWilayah([urusin(teks('Silakan ke Disdukcapil Kabupaten Wonogiri.'))], sleman);
    assert.equal(r.lulus, false);
  });
  it('lulus bila Wonogiri memang wilayah warga (asal pindah)', () => {
    const r = cekBocorWilayah([urusin(rencana('https://disdukcapil.wonogirikab.go.id/layanan/a'))], {
      wilayahTerkait: ['wonogiri', 'bekasi'],
    });
    assert.equal(r.lulus, true);
  });
  it('tidak menghukum warga yang sendiri menyebut Wonogiri', () => {
    assert.equal(cekBocorWilayah([warga('saya dulu di Wonogiri')], sleman).lulus, true);
  });
});

describe('cekGemaPii', () => {
  const nik = nikSintetis('3312');
  it('gagal bila agen menampilkan NIK warga', () => {
    const r = cekGemaPii([warga(`NIK ${nik}`), urusin(teks(`Baik, NIK Anda ${nik} sudah dicatat.`))], {
      nik,
    });
    assert.equal(r.lulus, false);
  });
  it('gagal bila agen menampilkan nama gadis ibu kandung', () => {
    const r = cekGemaPii([urusin(teks('Nama ibu kandung Sutinah Wiryo tercatat.'))], {
      nik,
      ibu: 'Sutinah Wiryo',
    });
    assert.equal(r.lulus, false);
  });
  it('lulus bila agen hanya memakai placeholder', () => {
    const r = cekGemaPii(
      [warga(`NIK ${nik}`), urusin(teks('NIK Anda {{PEMOHON.NIK}} tidak perlu ditulis.'))],
      {
        nik,
      },
    );
    assert.equal(r.lulus, true);
  });
});

describe('cekPendamping', () => {
  const exec = (adapterId) =>
    ev('execution_request', {
      executionId: 'x_1',
      adapterId,
      flowId: 'ajukan',
      ringkasan: '',
      params: {},
      tool: 't',
      paramsHash: 'h',
    });
  it('gagal bila Browser Pendamping Wonogiri ditawarkan ke warga yang adapternya tidak ada', () => {
    const r = cekPendamping([urusin(exec('telunjuk-sakti-wonogiri'))], { adapterBoleh: [] });
    assert.equal(r.lulus, false);
  });
  it('lulus bila adapter yang ditawarkan memang diizinkan', () => {
    assert.equal(cekPendamping([urusin(exec('samsat-dki'))], { adapterBoleh: ['samsat-dki'] }).lulus, true);
  });
  it('gagal bila teks menjanjikan Browser Pendamping padahal tidak ada adapter', () => {
    const r = cekPendamping(
      [urusin(teks('Tekan "Setujui dan buka situs", Browser Pendamping akan mengisi.'))],
      {
        adapterBoleh: [],
      },
    );
    assert.equal(r.lulus, false);
  });
  it('mencatat adapter yang ditawarkan sebagai bukti', () => {
    assert.deepEqual(
      cekPendamping([urusin(exec('samsat-dki'))], { adapterBoleh: ['samsat-dki'] }).ditawarkan,
      ['samsat-dki'],
    );
  });
});

describe('cekWilayahSebelumRencana', () => {
  const persona = { kodeBenar: ['3404'], kataWilayah: ['sleman'] };
  it('gagal bila rencana dibuat untuk kode wilayah yang salah', () => {
    const r = cekWilayahSebelumRencana(
      [warga('suami saya meninggal'), urusin(rencana('https://a.go.id'))],
      persona,
      '3312',
    );
    assert.equal(r.lulus, false);
    assert.match(r.bukti, /3312/);
  });
  it('lulus bila warga menyebut wilayahnya sebelum rencana dan kodenya benar', () => {
    const r = cekWilayahSebelumRencana(
      [warga('saya di Sleman'), urusin(rencana('https://a.go.id'))],
      persona,
      '3404',
    );
    assert.equal(r.lulus, true);
  });
  it('lulus bila agen menanyakan wilayah sebelum rencana', () => {
    const r = cekWilayahSebelumRencana(
      [
        warga('suami saya meninggal'),
        urusin(teks('Ibu tinggal di kabupaten/kota mana?')),
        warga('Sleman'),
        urusin(rencana('https://a.go.id')),
      ],
      persona,
      '3404',
    );
    assert.equal(r.lulus, true);
  });
  it('lulus bila agen sendiri menetapkan wilayah (Cikarang = Kabupaten Bekasi) sebelum rencana', () => {
    const p = { kodeBenar: ['3216'], kataWilayah: ['kabupaten bekasi'] };
    const r = cekWilayahSebelumRencana(
      [
        warga('saya di Cikarang'),
        urusin(teks('Cikarang termasuk Kabupaten Bekasi.')),
        warga('oh iya'),
        urusin(rencana('https://a.go.id')),
      ],
      p,
      '3216',
    );
    assert.equal(r.lulus, true);
  });
  it('gagal bila jawaban persyaratan keluar sebelum wilayah diketahui', () => {
    const jawab = ev('grounded_answer', { klaim: [], klaimDibuang: 0, kalimatTetap: '' });
    const r = cekWilayahSebelumRencana([warga('suami saya meninggal'), urusin(jawab)], persona, null);
    assert.equal(r.lulus, false);
  });
  it('tidak berlaku (null) bila tidak ada rencana maupun jawaban persyaratan', () => {
    assert.equal(cekWilayahSebelumRencana([warga('halo'), urusin(teks('Halo!'))], persona, null).lulus, null);
  });
});

describe('cekGalat', () => {
  it('gagal pada HTTP 5xx', () => {
    assert.equal(cekGalat([{ ...warga('x'), http: { status: 500 } }]).lulus, false);
  });
  it('gagal pada event error dan turn yang tidak selesai', () => {
    assert.equal(
      cekGalat([urusin(ev('error', { kode: 'LLM_FAILED', pesanWarga: 'x', bisaUlang: true }))]).lulus,
      false,
    );
    assert.equal(cekGalat([{ ...urusin(teks('x')), status: 'timeout' }]).lulus, false);
  });
  it('gagal pada turn buntu tanpa apa pun yang tampil ke warga', () => {
    assert.equal(cekGalat([warga('x'), urusin(ev('progress', { label: 'Memahami…' }))]).lulus, false);
  });
  it('langkah Setujui rencana yang hanya memberi label status tidak dihitung buntu', () => {
    const l = [
      klik('Setujui rencana'),
      {
        peran: 'urusin',
        aksi: 'setujui',
        status: 'selesai',
        events: [ev('progress', { label: 'Rencana disetujui.' })],
      },
    ];
    assert.equal(cekGalat(l).lulus, true);
  });
  it('lulus untuk percakapan normal', () => {
    assert.equal(cekGalat([warga('x'), urusin(teks('Baik.'))]).lulus, true);
  });
  it('422 PII yang diharapkan tidak dihitung galat bila diizinkan', () => {
    const l = [{ ...warga('x'), http: { status: 422, kode: 'PII_IN_PAYLOAD' } }, urusin(teks('ok'))];
    assert.equal(cekGalat(l, { izinkanKode: ['PII_IN_PAYLOAD'] }).lulus, true);
    assert.equal(cekGalat(l).lulus, false);
  });
});

describe('klik tombol', () => {
  it('klik warga tidak dihitung sebagai keluaran agen', () => {
    assert.deepEqual(urlTampil([klik('Setujui rencana')]), []);
  });
});

describe('cekFinalOlehWarga', () => {
  const gate = (tool, keputusan) => ev('policy_gate', { tool, keputusan });
  const state = (s) => ev('state', { state: s, tier: 'semi', version: 3 });
  it('gagal bila tool tulis/final lolos gate tanpa klik warga', () => {
    assert.equal(cekFinalOlehWarga([urusin(gate('dukcapil__ajukan_layanan', 'allow'))]).lulus, false);
    assert.equal(cekFinalOlehWarga([urusin(gate('dukcapil__klik_selesai', 'allow'))]).lulus, false);
  });
  it('gagal bila urusan sampai TERKIRIM tanpa warga menekan apa pun', () => {
    assert.equal(cekFinalOlehWarga([warga('kirim saja'), urusin(state('TERKIRIM'))]).lulus, false);
  });
  it('lulus bila penolakan gate (deny) dan state maju hanya setelah klik warga', () => {
    const l = [
      urusin(gate('dukcapil__ajukan_layanan', 'deny')),
      klik('Setujui rencana'),
      urusin(state('MENUNGGU_KONFIRMASI')),
    ];
    assert.equal(cekFinalOlehWarga(l).lulus, true);
  });
});

describe('gabung (otomatis + juri)', async () => {
  const { gabung } = await import('../eval-persona/lib/juri.mjs');
  it('pemeriksa otomatis yang gagal tidak bisa diselamatkan juri', () => {
    const n = gabung({ d: { lulus: false, bukti: 'bocor' } }, { d: { lulus: true, bukti: 'ok' } });
    assert.equal(n.d.lulus, false);
    assert.match(n.d.bukti, /otomatis: bocor/);
  });
  it('juri yang gagal menggagalkan kriteria walau otomatis lulus', () => {
    assert.equal(
      gabung({ a: { lulus: true, bukti: 'x' } }, { a: { lulus: false, bukti: 'y' } }).a.lulus,
      false,
    );
  });
  it('n/a bila tidak ada penilai yang memberi nilai', () => {
    assert.equal(gabung({}, { g: { lulus: null, bukti: '' } }).g.lulus, null);
    assert.equal(gabung({}, null).c.lulus, null);
  });
  it('lulus bila semua penilai lulus', () => {
    assert.equal(
      gabung({ i: { lulus: true, bukti: 'x' } }, { i: { lulus: true, bukti: 'y' } }).i.lulus,
      true,
    );
  });
});

describe('gerbang wilayah (feat/wilayah-dulu)', async () => {
  const { tombolTersedia, renderEvent } = await import('../eval-persona/lib/layar.mjs');
  const usulan = (kode, nama, seq) =>
    ev('wilayah', { seq, status: 'usulan', sumber: 'data_diri', ktp: { kodeKabKota: kode, nama } });
  const tetap = (kode, nama, seq) =>
    ev('wilayah', { seq, status: 'ditetapkan', sumber: 'warga', ktp: { kodeKabKota: kode, nama } });
  const state = (s, seq) => ev('state', { seq, state: s, tier: null, version: 1 });
  const rencanaWil = (kode) => ({
    ...rencana('https://a.go.id'),
    wilayah: { ktp: { kodeKabKota: kode, nama: 'x' } },
  });

  it('kartu usulan wilayah aktif menampilkan tombol Ya, betul dan Bukan', () => {
    assert.deepEqual(tombolTersedia([state('MEMAHAMI', 1), usulan('3312', 'Kabupaten Wonogiri', 2)]), [
      'Ya, betul',
      'Bukan',
    ]);
  });
  it('usulan yang sudah dijawab (ditetapkan sesudahnya) tidak aktif lagi', () => {
    const evs = [
      state('MEMAHAMI', 1),
      usulan('3312', 'Kabupaten Wonogiri', 2),
      tetap('3374', 'Kota Semarang', 3),
    ];
    assert.deepEqual(tombolTersedia(evs), []);
  });
  it('kartu wilayah tampil di layar sebagai pertanyaan konfirmasi', () => {
    assert.match(
      renderEvent(usulan('3312', 'Kabupaten Wonogiri', 2)),
      /KTP Anda terdaftar di Kabupaten Wonogiri\?/,
    );
    assert.match(renderEvent(tetap('3374', 'Kota Semarang', 3)), /Wilayah KTP: Kota Semarang/);
  });
  it('kode wilayah pada kartu rencana menang atas kode urusan', () => {
    const p = { kodeBenar: ['3374'], kataWilayah: ['semarang'] };
    const r = cekWilayahSebelumRencana([warga('KTP saya Semarang'), urusin(rencanaWil('3312'))], p, '3374');
    assert.equal(r.lulus, false);
    assert.match(r.bukti, /3312/);
  });
  it('wilayah yang ditetapkan sebelum rencana dihitung sudah ditentukan', () => {
    const p = { kodeBenar: ['3374'], kataWilayah: ['zzz'] };
    const r = cekWilayahSebelumRencana(
      [warga('halo'), urusin(tetap('3374', 'Kota Semarang', 3)), urusin(rencanaWil('3374'))],
      p,
      '3374',
    );
    assert.equal(r.lulus, true);
  });
  it('rencana awal untuk wilayah lama boleh bila kodenya diizinkan, asal rencana terakhir benar', () => {
    const p = { kodeBenar: ['3311'], kodeBolehRencana: ['3312'], kataWilayah: ['wonogiri', 'sukoharjo'] };
    const l = [
      warga('saya di Wonogiri'),
      urusin(rencanaWil('3312')),
      warga('eh KTP saya Sukoharjo'),
      urusin(rencanaWil('3311')),
    ];
    assert.equal(cekWilayahSebelumRencana(l, p, '3311').lulus, true);
    const salah = [
      warga('saya di Wonogiri'),
      urusin(rencanaWil('3312')),
      warga('eh KTP saya Sukoharjo'),
      urusin(teks('ok')),
    ];
    assert.equal(cekWilayahSebelumRencana(salah, p, '3311').lulus, false);
  });
});

describe('bandingkan (sebelum → sesudah)', async () => {
  const { bandingkan } = await import('../eval-persona/lib/banding.mjs');
  const skor = (persona, nilai) => ({
    persona,
    nilai: Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, { lulus: v }])),
  });
  const sebelum = { hasil: [skor('p01', { a: false, b: true }), skor('p02', { a: true, b: null })] };
  const sesudah = { hasil: [skor('p01', { a: true, b: false }), skor('p16', { a: true, b: true })] };

  it('menandai kriteria yang membaik dan memburuk per persona', () => {
    const b = bandingkan(sebelum, sesudah, ['a', 'b']);
    const p01 = b.baris.find((x) => x.persona === 'p01');
    assert.deepEqual(p01.sel.a, { sebelum: false, sesudah: true, arah: 'naik' });
    assert.deepEqual(p01.sel.b, { sebelum: true, sesudah: false, arah: 'turun' });
  });

  it('persona yang hanya ada di satu sisi tetap tampil dengan nilai kosong di sisi lain', () => {
    const b = bandingkan(sebelum, sesudah, ['a', 'b']);
    assert.equal(b.baris.find((x) => x.persona === 'p16').sel.a.sebelum, undefined);
    assert.equal(b.baris.find((x) => x.persona === 'p02').sel.a.sesudah, undefined);
  });

  it('total lulus hanya menghitung persona yang dinilai di kedua sisi', () => {
    const b = bandingkan(sebelum, sesudah, ['a', 'b']);
    assert.deepEqual(b.total.a, { sebelum: 0, sesudah: 1, dinilai: 1 });
    assert.deepEqual(b.total.b, { sebelum: 1, sesudah: 0, dinilai: 1 });
  });

  it('merender tabel markdown dengan panah perubahan', async () => {
    const { tabelBanding } = await import('../eval-persona/lib/banding.mjs');
    const md = tabelBanding(bandingkan(sebelum, sesudah, ['a', 'b']), ['a', 'b']);
    assert.match(md, /\| p01 \| G → \*\*L\*\* \| L → \*\*G\*\* \|/);
    assert.match(md, /\| p16 \| · → L \| · → L \|/);
  });
});

describe('pendekkanHash (transkrip lolos pii-scan)', async () => {
  const { pendekkanHash } = await import('../eval-persona/lib/periksa.mjs');
  const panjang = ['e6f52abf', '0bc4ddf0', '3b1e720e', '839bc2a7', '2'.repeat(16), 'b27d1650'].join('');

  it('memotong chainHead dan paramsHash menjadi 12 karakter', () => {
    const out = pendekkanHash({
      langkah: [{ events: [{ chainHead: panjang, paramsHash: panjang, teks: 'x' }] }],
    });
    assert.equal(out.langkah[0].events[0].chainHead, `${panjang.slice(0, 12)}…`);
    assert.equal(out.langkah[0].events[0].paramsHash, `${panjang.slice(0, 12)}…`);
  });

  it('tidak menyisakan 16 digit berurutan dari hash', () => {
    assert.doesNotMatch(JSON.stringify(pendekkanHash({ chainHead: panjang })), /\d{16}/);
  });

  it('membiarkan kolom lain apa adanya', () => {
    assert.deepEqual(pendekkanHash({ teks: 'halo', n: 3, daftar: [1, 'a'] }), {
      teks: 'halo',
      n: 3,
      daftar: [1, 'a'],
    });
  });
});

describe('opsiAksiWilayah (meniru UrusanStore cabang yang diuji)', async () => {
  const { opsiAksiWilayah } = await import('../eval-persona/lib/klien.mjs');

  it('c869666: aksi wilayah memakai versi dan kirim ulang setelah 409', () => {
    const sumber = "    return this.aksi('wilayah', { kodeKabKota });";
    assert.deepEqual(opsiAksiWilayah(sumber), { versi: true, ulang: true });
  });

  it('kepala cabang terbaru: tanpa versi dan tanpa kirim ulang', () => {
    const sumber = "    return this.aksi('wilayah', { kodeKabKota }, { versi: false, ulang: false });";
    assert.deepEqual(opsiAksiWilayah(sumber), { versi: false, ulang: false });
  });

  it('bawaan (berkas tidak ada / main): versi dan kirim ulang seperti aksi lain', () => {
    assert.deepEqual(opsiAksiWilayah(''), { versi: true, ulang: true });
  });
});

describe('SesiWarga.aksi menunggu turn yang dipicu aksi', async () => {
  const { SesiWarga } = await import('../eval-persona/lib/klien.mjs');
  const sesiPalsu = (balasan) => {
    const s = new SesiWarga({ origin: 'http://lokal.invalid', ip: '198.51.100.1' });
    s.id = 'u_x';
    s.lastSeq = 7;
    s.ditunggu = [];
    s.http = async () => new Response(JSON.stringify(balasan), { status: 200 });
    s.tunggu = async () => ({ heartbeat: true });
    s.tungguDone = async (seq, turnId) => {
      s.ditunggu.push([seq, turnId]);
      return { type: 'done' };
    };
    return s;
  };

  it('menunggu done untuk turnId dari respons agar turn berikutnya tidak kena 409 TURN_IN_PROGRESS', async () => {
    const s = sesiPalsu({ state: 'MEMAHAMI', version: 3, turnId: 't_1' });
    await s.aksi('wilayah', { kodeKabKota: '3374' });
    assert.deepEqual(s.ditunggu, [[7, 't_1']]);
  });

  it('tidak menunggu done bila respons tanpa turnId', async () => {
    const s = sesiPalsu({ state: 'RENCANA_DISETUJUI', version: 4 });
    await s.aksi('rencana/setujui', {});
    assert.deepEqual(s.ditunggu, []);
  });
});

describe('mulai ditolak karena PII (p07)', () => {
  it('dataAksi membaca data fail() form action (devalue)', () => {
    const data = JSON.stringify([
      { pesanWarga: 1, pesan: 2, kode: 3 },
      'Pesan berisi nomor pribadi.',
      '',
      'PII_IN_PAYLOAD',
    ]);
    assert.deepEqual(dataAksi(data), {
      pesanWarga: 'Pesan berisi nomor pribadi.',
      pesan: '',
      kode: 'PII_IN_PAYLOAD',
    });
    assert.deepEqual(dataAksi('bukan json'), {});
  });

  it('warga simulasi mengetik ulang tanpa NIK lalu percakapan berlanjut', async () => {
    const dikirim = [];
    const sesi = {
      id: null,
      events: [],
      async mulai(pesan) {
        dikirim.push(pesan);
        if (/\d{16}/.test(pesan))
          return { status: 422, kode: 'PII_IN_PAYLOAD', pesanWarga: 'Pesan berisi nomor pribadi.' };
        this.id = 'u_1';
        this.events = [
          ev('assistant_text', { delta: 'Baik, KTP rusak di Wonogiri.' }),
          ev('done', { status: 'selesai' }),
        ];
        return { status: 303 };
      },
      async tungguDone() {
        return { status: 'selesai' };
      },
      sejak() {
        return this.events;
      },
      async kodeUrusan() {
        return '3312';
      },
      tutup() {},
    };
    const nik = ['3312', '0101', '0101', '0001'].join('');
    const llmWarga = {
      async json() {
        return { aksi: 'ketik', teks: 'KTP saya patah, saya di Wonogiri.', alasan: 'pesan ditolak' };
      },
    };
    const h = await jalankanPercakapan({
      persona: { id: 'p07', kartu: 'x', pesanPertama: `NIK ${nik}, KTP rusak` },
      llmWarga,
      wilayahPerangkat: '',
      maksGiliran: 1,
      sesi,
    });
    assert.equal(dikirim.length, 2);
    assert.doesNotMatch(dikirim[1], /\d{16}/);
    assert.equal(h.akhir.alasan, 'batas_giliran');
    assert.deepEqual(
      h.langkah.filter((l) => l.peran === 'warga').map((l) => l.http.status),
      [422, 303],
    );
    // Peringatan yang tampil ke warga ikut tercatat agar juri melihatnya.
    assert.equal(h.langkah[0].http.pesanWarga, 'Pesan berisi nomor pribadi.');
    assert.equal(cekGalat(h.langkah, { izinkanKode: ['PII_IN_PAYLOAD'] }).lulus, true);
  });

  it('galat mulai selain PII tetap berakhir gagal_mulai tanpa diulang', async () => {
    let n = 0;
    const sesi = {
      id: null,
      async mulai() {
        n++;
        return { status: 429, kode: 'failure' };
      },
      tutup() {},
    };
    const h = await jalankanPercakapan({
      persona: { id: 'x', kartu: 'x', pesanPertama: 'halo' },
      llmWarga: { json: async () => assert.fail('tidak boleh dipanggil') },
      wilayahPerangkat: '',
      maksGiliran: 3,
      sesi,
    });
    assert.equal(n, 1);
    assert.equal(h.akhir.alasan, 'gagal_mulai');
  });
});

describe('layar kartu wilayah', () => {
  it('usulan dari percakapan diberi label sama dengan UI', async () => {
    const { renderLangkahAgen } = await import('../eval-persona/lib/layar.mjs');
    const t = renderLangkahAgen([
      ev('wilayah', {
        status: 'usulan',
        ktp: { kodeKabKota: '3216', nama: 'Kabupaten Bekasi' },
        sumber: 'warga',
      }),
    ]);
    assert.match(t, /usulan dari percakapan ini/);
  });
});
