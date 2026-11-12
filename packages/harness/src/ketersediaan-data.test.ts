import type { RingkasanDataKeluarga } from '@urusin/contracts';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { runTurn } from './agent.js';
import {
  bacaIngatan,
  blokIngatan,
  ingatanKosong,
  kalimatKetersediaan,
  type Ingatan,
  type PenyimpanIngatan,
} from './ingatan.js';
import { DATAMARK } from './spotlight.js';
import { makeEnv } from './testing.js';

const RINGKAS: RingkasanDataKeluarga = {
  dataDiri: true,
  ayah: false,
  ibu: true,
  pasangan: true,
  anak: 2,
  lainnya: 0,
};

function penyimpan(ketersediaanData?: (p: string) => RingkasanDataKeluarga): PenyimpanIngatan {
  const isi = new Map<string, Ingatan>();
  return {
    pemilik: () => 'akun_1',
    muat: (pm) => isi.get(pm) ?? ingatanKosong(),
    simpan: (pm, i) => void isi.set(pm, bacaIngatan(JSON.parse(JSON.stringify(i)))),
    jenisDokumen: () => [],
    urusanMilik: () => [],
    ...(ketersediaanData ? { ketersediaanData } : {}),
  };
}

const sp = (s: string) => s.replaceAll(' ', DATAMARK);

describe('ringkasan ketersediaan data keluarga (tanpa nilai)', () => {
  it('kalimat ada/belum per anggota; tidak diketahui = null', () => {
    expect(kalimatKetersediaan(undefined)).toBeNull();
    expect(kalimatKetersediaan(RINGKAS)).toBe(
      'Data di brankas warga (ada/belum saja, tanpa isi): data diri: ada; pasangan: ada; anak: 2 orang; ayah: belum; ibu: ada.',
    );
    expect(kalimatKetersediaan({ ...RINGKAS, anak: 0, lainnya: 1 })).toContain(
      'anak: belum; ayah: belum; ibu: ada; anggota lain: 1 orang',
    );
  });

  it('masuk blok ingatan walau ingatan kosong, sebagai DATA ber-spotlight', () => {
    const b = blokIngatan(
      { ingatan: ingatanKosong(), dokumen: [], urusanLain: [], dataTersedia: RINGKAS },
      'n',
    )!;
    expect(b).toContain('halaman Data diri');
    expect(b).toContain(sp('ayah: belum; ibu: ada'));
    expect(b).toContain(sp('anak: 2 orang'));
  });

  it('agen melihat ringkasan (tanpa nilai) di prompt turn', async () => {
    const provider = new FakeProvider();
    const env = makeEnv({ provider, ingatan: penyimpan(() => RINGKAS) });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    provider.enqueue(fakeCompletion({ content: 'Baik.' }));
    await runTurn(env.deps, { urusanId: u.id, userText: 'mau urus akta kelahiran anak' });
    const c = provider.calls[0]!;
    if (c.kind !== 'create') throw new Error('bukan create');
    const semua = JSON.stringify(c.params.messages);
    expect(semua).toContain(sp('ayah: belum'));
    expect(semua).toContain(sp('ibu: ada'));
    expect(semua).toContain('jangan minta NIK, nama, atau tanggal lahir diketik di chat');
  });

  it('brankas gagal dibuka: turn tetap jalan tanpa ringkasan', async () => {
    const provider = new FakeProvider();
    const env = makeEnv({
      provider,
      ingatan: penyimpan(() => {
        throw new Error('vault rusak');
      }),
    });
    const u = env.store.createUrusan({ jenis: 'kelahiran' });
    provider.enqueue(fakeCompletion({ content: 'Baik.' }));
    await runTurn(env.deps, { urusanId: u.id, userText: 'halo' });
    const c = provider.calls[0]!;
    if (c.kind !== 'create') throw new Error('bukan create');
    expect(JSON.stringify(c.params.messages)).not.toContain('Data di brankas');
  });
});
