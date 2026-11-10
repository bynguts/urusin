import { isHttpError, isRedirect } from '@sveltejs/kit';
import { DemoProvider } from '@urusin/harness';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions as beranda, load as muatLanding } from '../../routes/+page.server';
import { load as muatJejak } from '../../routes/jejak/[id]/+page.server';
import { load as muatPeristiwa } from '../../routes/peristiwa/[slug]/+page.server';
import { load as muatUrusan } from '../../routes/urusan/[id]/+page.server';
import Chip from '../components/ui/Chip.svelte';
import KartuUrusanku from '../components/urusan/KartuUrusanku.svelte';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { TERAKHIR_COOKIE } from './sesi';

let rt: Runtime;
beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0 },
  });
  setRuntimeForTests(rt);
});
afterEach(() => setRuntimeForTests(undefined));

function kue() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: string) => void m.set(k, v),
    getAll: () => [...m].map(([name, value]) => ({ name, value })),
    delete: (k: string) => void m.delete(k),
    serialize: () => '',
  };
}

const kirimForm = (isi: Record<string, string>) =>
  ({
    request: new Request('http://localhost:3000/?/mulai', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: new URLSearchParams(isi),
    }),
    url: new URL('http://localhost:3000/?/mulai'),
    params: {},
    locals: {},
    cookies: kue(),
    getClientAddress: () => '127.0.0.1',
  }) as never;

async function tangkap(p: unknown): Promise<unknown> {
  try {
    return await p;
  } catch (e) {
    return e;
  }
}

describe('form action mulai urusan (tanpa JS)', () => {
  it('pesan kosong → 422 dengan pesan warga', async () => {
    const r = (await beranda.mulai(kirimForm({ pesan: '  ' }))) as {
      status: number;
      data: { pesanWarga: string };
    };
    expect(r.status).toBe(422);
    expect(r.data.pesanWarga).toMatch(/Tulis dulu/);
  });

  it('dari kartu peristiwa → urusan dibuat dengan jenis + kab/kota, lalu 303 ke layar urusan', async () => {
    const r = await tangkap(beranda.mulai(kirimForm({ peristiwa: 'kelahiran', kodeKabKota: '3312' })));
    expect(isRedirect(r)).toBe(true);
    const lokasi = (r as { location: string }).location;
    expect(lokasi).toMatch(/^\/urusan\/u_[0-9a-f]{32}$/);
    const u = rt.store.getUrusan(lokasi.split('/').at(-1)!);
    expect(u).toMatchObject({ jenis: 'kelahiran', kodeKabKota: '3312' });
  });
});

describe('load layar', () => {
  const ke = (params: Record<string, string>, url = 'http://localhost:3000/x') =>
    ({ params, url: new URL(url), setHeaders: () => {} }) as never;

  it('tamu dengan riwayat urusan tetap melihat landing, lalu dapat membuka aplikasi secara eksplisit', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    const cookies = kue();
    cookies.set(TERAKHIR_COOKIE, u.id);
    expect(await muatLanding({ cookies, locals: { akun: null } } as never)).toBeUndefined();
    expect(cookies.get(TERAKHIR_COOKIE)).toBe(u.id);
    expect(rt.store.getUrusan(u.id)).not.toBeNull();
  });

  it('akun yang masuk dengan urusan tersimpan tetap dilanjutkan ke beranda', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    const cookies = kue();
    cookies.set(TERAKHIR_COOKIE, u.id);
    const result = await tangkap(muatLanding({ cookies, locals: { akun: { jenis: 'akun' } } } as never));
    expect(isRedirect(result)).toBe(true);
    expect(result).toMatchObject({ status: 303, location: '/beranda' });
  });

  it('akun dengan cookie urusan yang sudah tidak ada tetap mendapat landing', async () => {
    const cookies = kue();
    cookies.set(TERAKHIR_COOKIE, `u_${'0'.repeat(32)}`);
    expect(await muatLanding({ cookies, locals: { akun: { jenis: 'akun' } } } as never)).toBeUndefined();
  });

  it('urusan dan jejak: id tidak valid atau tidak ada → 404', async () => {
    for (const load of [muatUrusan, muatJejak]) {
      expect(isHttpError(await tangkap(load(ke({ id: 'salah' }))), 404)).toBe(true);
      expect(isHttpError(await tangkap(load(ke({ id: `u_${'0'.repeat(32)}` }))), 404)).toBe(true);
    }
  });

  it('jejak memuat rantai hash yang utuh untuk urusan baru', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    const d = (await muatJejak(ke({ id: u.id }))) as { jenis: string; jejak: { rantai: { valid: boolean } } };
    expect(d.jenis).toBe('kelahiran');
    expect(d.jejak.rantai.valid).toBe(true);
  });

  it('peristiwa: slug dikenal memuat rencana + daftar kab/kota; kode tidak valid diabaikan', async () => {
    const d = (await muatPeristiwa(
      ke({ slug: 'kelahiran' }, 'http://localhost:3000/peristiwa/kelahiran?kodeKabKota=abc'),
    )) as { rencana: unknown; kota: { kodeKabKota: string }[]; kodeDipilih: string | null };
    expect(d.rencana).not.toBeNull();
    expect(d.kota.length).toBeGreaterThan(0);
    expect(d.kodeDipilih).toBeNull();
    expect(
      isHttpError(await tangkap(Promise.resolve().then(() => muatPeristiwa(ke({ slug: 'x' })))), 404),
    ).toBe(true);
  });
});

describe('render server komponen', () => {
  it('Chip selalu memuat teks, bukan warna saja', () => {
    const teks = createRawSnippet(() => ({ render: () => '<span>Menunggu Anda</span>' }));
    const { body } = render(Chip, { props: { nada: 'anda', ikon: 'tangan', children: teks } });
    expect(body).toContain('Menunggu Anda');
    expect(body).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('kartu Urusanku menampilkan status, langkah, dan aksi bertaut ke urusan', () => {
    const id = `u_${'c'.repeat(32)}`;
    const { body } = render(KartuUrusanku, {
      props: {
        urusan: {
          id,
          judul: 'Akta kelahiran',
          peristiwa: 'kelahiran',
          dibuatPada: '2026-11-01T00:00:00.000Z',
          ringkasan: {
            id,
            state: 'MENUNGGU_SUBMIT_WARGA',
            dibuatPada: '2026-11-01T00:00:00.000Z',
            diubahPada: '2026-11-03T00:00:00.000Z',
          } as never,
        },
        utama: true,
      },
    });
    expect(body).toContain('Akta kelahiran');
    expect(body).toContain('Langkah 4 dari 5');
    expect(body).toContain('Periksa dan kirim');
    expect(body).toContain(`/urusan/${id}`);
  });
});
