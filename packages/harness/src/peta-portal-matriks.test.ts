import { PlanCardEventSchema, type EventPayload, type UrusanState } from '@urusin/contracts';
import { ketersediaanLayanan } from '@urusin/core';
import { DAERAH_PENDAMPING_AKTIF } from '@urusin/registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openHarnessDb } from './db.js';
import { aturJaringanId, rutePendamping, setujuiRencana, type RutePendamping } from './rencana.js';
import { HarnessStore } from './store.js';
import {
  ID_LANGKAH_AKUN,
  ID_LANGKAH_OFFLINE,
  buatUrusanTerwilayah,
  kartuRencana,
  refWilayah,
  usulkanRencanaOtomatis,
  type WilayahUrusan,
} from './wilayah.js';

/**
 * Matriks 10 daerah Browser Pendamping aktif × 5 layanan (ADR 0033, peta portal ADR 0034): setiap sel menghasilkan
 * rute yang diharapkan (Pendamping generik/adapter dengan jalur awal sesi yang benar, atau dipandu karena layanan
 * tidak online di portal itu) beserta langkah prasyarat akun yang dikerjakan warga sendiri.
 */

const JENIS = ['kelahiran', 'kk', 'pindah', 'kia', 'ktp'] as const;
type Jenis = (typeof JENIS)[number];

type Harap =
  { rute: 'generik'; jalur: string } | { rute: 'adapter' } | { rute: 'offline'; alternatif: RegExp };

const g = (jalur: string): Harap => ({ rute: 'generik', jalur });
const semua = (h: Harap): Record<Jenis, Harap> => ({ kelahiran: h, kk: h, pindah: h, kia: h, ktp: h });

const MATRIKS: Readonly<Record<string, Record<Jenis, Harap>>> = {
  // Si D'nOK: tidak ada menu KTP-el (TPDK kecamatan); layanan lain lewat halaman masuk.
  '3374': { ...semua(g('/pelapor/login')), ktp: { rute: 'offline', alternatif: /TPDK/ } },
  // SIAPEL: langsung ke formulir create (Laravel mengalihkan ke /login); pindah tidak ada.
  '3573': {
    kelahiran: g('/backoffice/masyarakat_kelahiran/create'),
    kk: g('/backoffice/masyarakat_kk/create'),
    pindah: { rute: 'offline', alternatif: /Dispendukcapil Kota Malang/ },
    kia: g('/backoffice/masyarakat_identitasanak/create'),
    ktp: g('/backoffice/masyarakat_ktp/create'),
  },
  // SIRANCAK: KTP-el online hanya varian hilang (tanpa varian = offline); KIA pemula online.
  '1371': { ...semua(g('/masuk')), ktp: { rute: 'offline', alternatif: /Khatib Sulaiman/ } },
  // Permen Manis 2.0 (bukan COKELAT).
  '1871': semua(g('/pelayanan/auth')),
  // Silondo Maju: tautan langsung 404, mulai dari beranda.
  '3276': semua(g('/')),
  // Sobat Dukcapil: mulai dari beranda (pilih layanan dulu, lalu masuk).
  '3671': semua(g('/')),
  // Belum dipetakan: perilaku registry sebelumnya (peta menyusul).
  '3578': semua(g('/app')),
  '1271': semua(g('/')),
  '6371': semua(g('/')),
  '3312': { ...semua(g('/')), kelahiran: { rute: 'adapter' } },
};

/** Prasyarat akun yang dikerjakan warga sendiri (langkah pertama kartu, sebelum Pendamping). */
const AKUN: Readonly<Record<string, readonly RegExp[]>> = {
  '3374': [/sandi yang dikirim lewat WhatsApp atau email/, /lengkapi/],
  '3573': [/tautan aktivasi/, /EMAIL, bukan NIK/],
  '1371': [
    /@gmail\.com/,
    /kirim pesan "OTP"/,
    /swafoto memegang KTP langsung dengan kamera/,
    /diverifikasi admin/,
  ],
  '1871': [/Kirim OTP melalui Email/],
  '3276': [/silondomaju\.depok\.go\.id\/register/],
  '3671': [/aplikasi Tangerang LIVE/],
};

const TUJUAN_PINDAH: Readonly<Record<string, string>> = { '3374': '3578' };

function wilayah(kode: string, jenis: Jenis): WilayahUrusan {
  return {
    ktp: refWilayah(kode),
    domisili: null,
    tujuan: jenis === 'pindah' ? refWilayah(TUJUAN_PINDAH[kode] ?? '3374') : null,
    usulan: null,
  };
}

function cocokRute(r: RutePendamping, h: Harap, label: string) {
  if (h.rute === 'offline') {
    expect(r, label).toMatchObject({ jalur: 'dipandu', sebab: 'offline_portal' });
    if (r.jalur === 'dipandu' && r.sebab === 'offline_portal') {
      expect(r.offline.alternatif.teks, label).toMatch(h.alternatif);
      expect(r.alasan, label).toContain(r.offline.alternatif.teks);
    }
  } else if (h.rute === 'adapter') expect(r.jalur, label).toBe('adapter');
  else {
    expect(r.jalur, label).toBe('generik');
    if (r.jalur === 'generik') expect(r.params.jalur, label).toBe(h.jalur);
  }
}

const sah = (kartu: object) =>
  PlanCardEventSchema.safeParse({
    type: 'plan_card',
    seq: 1,
    at: '2026-11-12T00:00:00.000Z',
    chainHead: 'x',
    ...kartu,
  });

beforeEach(() => aturJaringanId(() => true));
afterEach(() => aturJaringanId(() => false));

describe('Matriks 10 daerah × 5 layanan: rute dan prasyarat akun', () => {
  it('matriks mencakup tepat 10 daerah aktif', () => {
    expect(Object.keys(MATRIKS).sort()).toEqual(DAERAH_PENDAMPING_AKTIF.map((d) => d.kode).sort());
  });

  for (const { kode, nama } of DAERAH_PENDAMPING_AKTIF)
    for (const jenis of JENIS)
      it(`${nama} (${kode}) × ${jenis}`, () => {
        const harap = MATRIKS[kode]![jenis];
        const label = `${kode}/${jenis}`;
        cocokRute(rutePendamping({ jenis, kodeKabKota: kode }), harap, label);

        const kartu = kartuRencana(jenis, wilayah(kode, jenis))!;
        expect(kartu, label).toBeDefined();
        expect(sah(kartu).success, label).toBe(true);
        const ids = kartu.langkah.map((l) => l.id);
        const peta = ketersediaanLayanan(kode, jenis);

        if (harap.rute === 'offline') {
          // Tidak membuka Pendamping: dipandu dengan jalur resmi yang benar, tanpa langkah "online" palsu.
          expect(kartu.tier, label).toBe('dipandu');
          expect(kartu.pendamping, label).toBeUndefined();
          expect(ids[0], label).toBe(ID_LANGKAH_OFFLINE);
          expect(ids, label).not.toContain(ID_LANGKAH_AKUN);
          expect(
            kartu.langkah.filter((l) => l.jenis.startsWith('online')),
            label,
          ).toEqual([]);
          expect(kartu.langkah[0]!.keterangan, label).toMatch(harap.alternatif);
          expect(kartu.dipandu?.pesan, label).toMatch(harap.alternatif);
          expect(kartu.catatan, label).toMatch(/Browser Pendamping tidak dibuka/);
          return;
        }
        expect(kartu.tier, label).toBe('semi');
        expect(kartu.pendamping?.jalur, label).toBe(harap.rute);
        const akun = AKUN[kode];
        if (!akun) {
          expect(peta.dipetakan, label).toBe(false);
          expect(ids, label).not.toContain(ID_LANGKAH_AKUN);
          return;
        }
        // Prasyarat akun = langkah PERTAMA, sebelum langkah yang dikerjakan Browser Pendamping.
        expect(ids[0], label).toBe(ID_LANGKAH_AKUN);
        expect(
          ids.filter((i) => i === ID_LANGKAH_AKUN),
          label,
        ).toHaveLength(1);
        for (const re of akun) expect(kartu.langkah[0]!.keterangan, label).toMatch(re);
        expect(kartu.langkah[0]!.sumber[0]?.url, label).toMatch(/^https:\/\//);
      });
});

describe('Sel per varian (varian disebut warga)', () => {
  const KASUS: readonly [string, Jenis, string, Harap][] = [
    ['1371', 'ktp', 'hilang', g('/masuk')],
    ['1371', 'ktp', 'rusak', { rute: 'offline', alternatif: /Khatib Sulaiman/ }],
    ['1371', 'ktp', 'baru', { rute: 'offline', alternatif: /perekaman/ }],
    ['1371', 'kia', 'baru', g('/masuk')],
    ['1371', 'kia', 'hilang', { rute: 'offline', alternatif: /KIA hilang, rusak/ }],
    ['3671', 'ktp', 'baru', { rute: 'offline', alternatif: /perekaman pertama/ }],
    ['3671', 'ktp', 'rusak', g('/')],
    ['3671', 'ktp', 'hilang', g('/')],
    ['1871', 'ktp', 'baru', g('/perekaman')],
    ['3374', 'ktp', 'hilang', { rute: 'offline', alternatif: /surat kehilangan/ }],
    ['3374', 'pindah', 'datang', g('/pelapor/login')],
  ];
  for (const [kode, jenis, varian, harap] of KASUS)
    it(`${kode} × ${jenis} (${varian})`, () => {
      cocokRute(rutePendamping({ jenis, kodeKabKota: kode, varian }), harap, `${kode}/${jenis}/${varian}`);
    });

  it('antrean perekaman Bandar Lampung tanpa akun: tidak ada langkah prasyarat akun', () => {
    const kartu = kartuRencana('ktp', wilayah('1871', 'ktp'), undefined, 'baru')!;
    expect(kartu.langkah.map((l) => l.id)).not.toContain(ID_LANGKAH_AKUN);
    expect(kartu.pendamping?.jalur).toBe('generik');
  });
});

function urusan(kode: string, jenis: Jenis, pesan: string) {
  const store = new HarnessStore(openHarnessDb());
  let u = buatUrusanTerwilayah(store, { kodeKabKota: kode, jenis });
  store.claimTurn(u.id, pesan);
  u = store.getUrusanOrThrow(u.id);
  u = store.transition(u.id, u.version, 'MEMAHAMI' as UrusanState);
  const events: EventPayload[] = [];
  return { store, u, events, publish: (e: EventPayload) => void events.push(e) };
}

describe('Kartu rencana dan persetujuan memakai varian dari pesan warga', () => {
  it('Padang "KTP saya hilang": kartu semi + prasyarat akun, persetujuan membuka Pendamping ke /masuk', () => {
    const { store, u, events, publish } = urusan('1371', 'ktp', 'KTP saya hilang kemarin, mau urus');
    const cur = usulkanRencanaOtomatis(store, u, publish);
    const kartu = events.find((e) => e.type === 'plan_card');
    expect(kartu).toMatchObject({ tier: 'semi', pendamping: { jalur: 'generik' } });
    expect(kartu?.type === 'plan_card' && kartu.langkah[0]?.id).toBe(ID_LANGKAH_AKUN);
    const r = setujuiRencana(store, cur.id, publish);
    expect(r.executionId).not.toBeNull();
    expect(events.find((e) => e.type === 'execution_request')).toMatchObject({
      params: { jenis: 'ktp', kode: '1371', jalur: '/masuk' },
    });
  });

  it('Padang "bikin KTP pertama kali": kartu dipandu ke kantor, persetujuan TIDAK membuka Pendamping', () => {
    const { store, u, events, publish } = urusan(
      '1371',
      'ktp',
      'anak saya 17 tahun mau bikin KTP pertama kali',
    );
    const cur = usulkanRencanaOtomatis(store, u, publish);
    const kartu = events.find((e) => e.type === 'plan_card');
    expect(kartu).toMatchObject({ tier: 'dipandu' });
    expect(kartu?.type === 'plan_card' && kartu.pendamping).toBeFalsy();
    expect(events.filter((e) => e.type === 'state').at(-1)).toMatchObject({ tier: 'dipandu' });
    const r = setujuiRencana(store, cur.id, publish);
    expect(r.executionId).toBeNull();
    expect(r.urusan.state).toBe('RENCANA_DISETUJUI');
    expect(events.some((e) => e.type === 'execution_request' || e.type === 'gate')).toBe(false);
    const label = events.filter((e) => e.type === 'progress').at(-1);
    expect(label?.type === 'progress' && label.label).toMatch(/Khatib Sulaiman/);
  });

  it('Tangerang "KTP-el rusak": Pendamping dibuka; "KTP baru": dipandu ke perekaman', () => {
    const a = urusan('3671', 'ktp', 'KTP saya rusak, retak');
    expect(
      setujuiRencana(a.store, usulkanRencanaOtomatis(a.store, a.u, a.publish).id, a.publish).executionId,
    ).not.toBeNull();
    const b = urusan('3671', 'ktp', 'mau rekam KTP baru');
    expect(
      setujuiRencana(b.store, usulkanRencanaOtomatis(b.store, b.u, b.publish).id, b.publish).executionId,
    ).toBeNull();
  });
});
