import { isHttpError, isRedirect } from '@sveltejs/kit';
import { DemoProvider, wilayahUrusan } from '@urusin/harness';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions as beranda, load as muatLanding } from '../../routes/+page.server';
import { load as muatJejak } from '../../routes/jejak/[id]/+page.server';
import { load as muatPeristiwa } from '../../routes/peristiwa/[slug]/+page.server';
import { load as muatUrusan } from '../../routes/urusan/[id]/+page.server';
import LayarPendamping, {
  instruksiGiliran,
  labelKerjaAi,
} from '../components/pendamping/LayarPendamping.svelte';
import Chip from '../components/ui/Chip.svelte';
import KartuRencana from '../components/urusan/KartuRencana.svelte';
import KartuUrusanku from '../components/urusan/KartuUrusanku.svelte';
import { dataAwal, type DataPendamping, type GiliranAnda } from '../pendamping/sesi.svelte';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { LANDING_COOKIE } from '../ke-landing';
import { SID_COOKIE, TERAKHIR_COOKIE } from './sesi';

const SID = 'a'.repeat(32);

/** Permintaan landing dari luar situs (tanpa Referer) atau dengan Referer tertentu. */
const minta = (referer?: string) => ({
  request: new Request('http://localhost:3000/', referer ? { headers: { referer } } : {}),
  url: new URL('http://localhost:3000/'),
});

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

const kirimForm = (isi: Record<string, string>, locals: App.Locals = {}) =>
  ({
    request: new Request('http://localhost:3000/?/mulai', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: new URLSearchParams(isi),
    }),
    url: new URL('http://localhost:3000/?/mulai'),
    params: {},
    locals,
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
  /** Wajib akun: formulir mulai hanya untuk warga yang masuk. */
  const warga = async (): Promise<App.Locals> => ({
    akun: (
      await rt.akun.daftar(
        { email: 'warga@example.com', sandi: 'kuda-lari-cepat-9' },
        { ip: '127.0.0.1', userAgent: null },
      )
    ).akun,
  });

  it('tanpa sesi akun: 303 ke /daftar lalu kembali ke rencana peristiwa (wilayah ikut); tidak ada urusan dibuat', async () => {
    const r = await tangkap(beranda.mulai(kirimForm({ peristiwa: 'kelahiran', kodeKabKota: '3312' })));
    expect(r).toMatchObject({
      status: 303,
      location: `/daftar?next=${encodeURIComponent('/peristiwa/kelahiran?kodeKabKota=3312')}`,
    });
    const tanpaKode = await tangkap(beranda.mulai(kirimForm({ peristiwa: 'kematian', kodeKabKota: 'x' })));
    expect(tanpaKode).toMatchObject({
      location: `/daftar?next=${encodeURIComponent('/peristiwa/kematian')}`,
    });
    // Cerita bebas atau "lainnya": kembali ke Beranda (kotak cerita).
    for (const isi of [{ pesan: 'Mau urus akta' }, { peristiwa: 'lainnya' }] as Record<string, string>[])
      expect(await tangkap(beranda.mulai(kirimForm(isi)))).toMatchObject({
        status: 303,
        location: `/daftar?next=${encodeURIComponent('/beranda')}`,
      });
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM urusan').get()).toEqual({ n: 0 });
  });

  it('pesan kosong → 422 dengan pesan warga', async () => {
    const r = (await beranda.mulai(kirimForm({ pesan: '  ' }, await warga()))) as {
      status: number;
      data: { pesanWarga: string };
    };
    expect(r.status).toBe(422);
    expect(r.data.pesanWarga).toMatch(/Tulis dulu/);
  });

  it('dari kartu peristiwa → urusan dibuat dengan jenis + usulan kab/kota, lalu 303 ke layar urusan', async () => {
    const r = await tangkap(
      beranda.mulai(kirimForm({ peristiwa: 'kelahiran', kodeKabKota: '3312' }, await warga())),
    );
    expect(isRedirect(r)).toBe(true);
    const lokasi = (r as { location: string }).location;
    expect(lokasi).toMatch(/^\/urusan\/u_[0-9a-f]{32}$/);
    const u = rt.store.getUrusan(lokasi.split('/').at(-1)!);
    // Pilihan di perangkat hanya usulan: wilayah KTP urusan belum ditetapkan sampai warga mengonfirmasi.
    expect(u).toMatchObject({ jenis: 'kelahiran', kodeKabKota: null });
    expect(wilayahUrusan(rt.store, u!)).toMatchObject({
      ktp: null,
      usulan: { ktp: { kodeKabKota: '3312' }, sumber: 'pilihan' },
    });
  });
});

describe('load layar', () => {
  const ke = (params: Record<string, string>, url = 'http://localhost:3000/x', sid = SID) => {
    const cookies = kue();
    cookies.set(SID_COOKIE, sid);
    return { params, url: new URL(url), setHeaders: () => {}, cookies, locals: {} } as never;
  };

  it('tamu dengan riwayat urusan tetap melihat landing, lalu dapat membuka aplikasi secara eksplisit', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    rt.akun.catatPemilikUrusan(u.id, { sid: SID });
    const cookies = kue();
    cookies.set(SID_COOKIE, SID);
    cookies.set(TERAKHIR_COOKIE, u.id);
    expect(await muatLanding({ cookies, locals: {}, ...minta() } as never)).toEqual({
      jumlahDaerahPendamping: 8,
    });
    expect(cookies.get(TERAKHIR_COOKIE)).toBe(u.id);
    expect(rt.store.getUrusan(u.id)).not.toBeNull();
  });

  it('akun yang masuk dengan urusan miliknya dilanjutkan ke beranda', async () => {
    const { akun } = rt.akun.buatDemo({ ip: '127.0.0.1' });
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    rt.akun.catatPemilikUrusan(u.id, { akun });
    const cookies = kue();
    cookies.set(TERAKHIR_COOKIE, u.id);
    const result = await tangkap(muatLanding({ cookies, locals: { akun }, ...minta() } as never));
    expect(isRedirect(result)).toBe(true);
    expect(result).toMatchObject({ status: 303, location: '/beranda' });
  });

  it('logo aplikasi (penanda singkat) atau tautan dari situs sendiri tetap membuka landing', async () => {
    const { akun } = rt.akun.buatDemo({ ip: '127.0.0.1' });
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    rt.akun.catatPemilikUrusan(u.id, { akun });
    const cookies = kue();
    cookies.set(TERAKHIR_COOKIE, u.id);
    cookies.set(LANDING_COOKIE, '1');
    expect(await muatLanding({ cookies, locals: { akun }, ...minta() } as never)).toEqual({
      jumlahDaerahPendamping: 8,
    });
    expect(cookies.get(LANDING_COOKIE)).toBeUndefined();
    const dariSitus = minta('http://localhost:3000/beranda');
    expect(await muatLanding({ cookies, locals: { akun }, ...dariSitus } as never)).toEqual({
      jumlahDaerahPendamping: 8,
    });
    const luar = minta('https://contoh.test/');
    expect(isRedirect(await tangkap(muatLanding({ cookies, locals: { akun }, ...luar } as never)))).toBe(
      true,
    );
  });

  it('akun dengan cookie urusan milik orang lain atau yang sudah tidak ada tetap mendapat landing', async () => {
    const { akun } = rt.akun.buatDemo({ ip: '127.0.0.1' });
    const asing = rt.store.createUrusan({ jenis: 'kelahiran' });
    rt.akun.catatPemilikUrusan(asing.id, { sid: SID });
    for (const id of [asing.id, `u_${'0'.repeat(32)}`]) {
      const cookies = kue();
      cookies.set(SID_COOKIE, 'b'.repeat(32));
      cookies.set(TERAKHIR_COOKIE, id);
      expect(await muatLanding({ cookies, locals: { akun }, ...minta() } as never)).toEqual({
        jumlahDaerahPendamping: 8,
      });
    }
  });

  it('urusan dan jejak: id tidak valid atau tidak ada → 404', async () => {
    for (const load of [muatUrusan, muatJejak]) {
      expect(isHttpError(await tangkap(load(ke({ id: 'salah' }))), 404)).toBe(true);
      expect(isHttpError(await tangkap(load(ke({ id: `u_${'0'.repeat(32)}` }))), 404)).toBe(true);
    }
  });

  it('urusan dan jejak: hanya pemilik; cookie sesi lain dan urusan tanpa pemilik → 404 yang sama', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    const lama = rt.store.createUrusan({ jenis: 'kelahiran' }); // urusan lama tanpa catatan pemilik
    rt.akun.catatPemilikUrusan(u.id, { sid: SID });
    for (const load of [muatUrusan, muatJejak]) {
      expect(isHttpError(await tangkap(load(ke({ id: u.id }))))).toBe(false);
      expect(isHttpError(await tangkap(load(ke({ id: u.id }, undefined, 'b'.repeat(32)))), 404)).toBe(true);
      expect(isHttpError(await tangkap(load(ke({ id: lama.id }))), 404)).toBe(true);
    }
  });

  it('jejak memuat rantai hash yang utuh untuk urusan baru', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    rt.akun.catatPemilikUrusan(u.id, { sid: SID });
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
    expect(body).toContain('Kelahiran');
  });

  it('kartu Urusanku tanpa jenis tidak menebak lencana kategori', () => {
    const id = `u_${'e'.repeat(32)}`;
    const { body } = render(KartuUrusanku, {
      props: {
        urusan: {
          id,
          judul: 'Kehilangan barang',
          peristiwa: null,
          dibuatPada: '2026-11-01T00:00:00.000Z',
          ringkasan: {
            id,
            state: 'BARU',
            dibuatPada: '2026-11-01T00:00:00.000Z',
            diubahPada: '2026-11-01T00:00:00.000Z',
          } as never,
        },
      },
    });
    expect(body).toContain('Kehilangan barang');
    expect(body).not.toContain('KTP &amp; dokumen');
    expect(body).not.toContain('Urusan lain');
  });

  it('kartu Urusanku: pengajuan terkirim menampilkan nomor permohonan dan langkah 5', () => {
    const id = `u_${'d'.repeat(32)}`;
    const { body } = render(KartuUrusanku, {
      props: {
        urusan: {
          id,
          judul: 'Akta kelahiran',
          peristiwa: 'kelahiran',
          dibuatPada: '2026-11-01T00:00:00.000Z',
          ringkasan: {
            id,
            state: 'TERKIRIM',
            dibuatPada: '2026-11-01T00:00:00.000Z',
            diubahPada: '2026-11-03T00:00:00.000Z',
            nomorPermohonan: 'FX-REG-0002',
          } as never,
        },
      },
    });
    expect(body).toContain('Nomor permohonan FX-REG-0002');
    expect(body).toContain('Langkah 5 dari 5');
  });

  it('giliran kirim menyebut tombol yang dibaca dari halaman; tanpa itu tidak mengarang nama tombol', () => {
    const giliran = (tombol?: string): DataPendamping => ({
      ...dataAwal(),
      keadaan: 'giliran',
      mode: 'takeover',
      giliran: {
        jenis: 'giliran_anda',
        alasan: 'final',
        pesan: 'Semua berkas terunggah. Periksa, lalu tekan Selesai sendiri untuk mengirim.',
        ...(tombol ? { tombol } : {}),
      },
    });
    const props = (data: DataPendamping) => ({
      data,
      situs: 'https://telunjuksakti.wonogirikab.go.id',
      onambilalih: () => {},
      onkembalikan: () => {},
      onhentikan: () => {},
      onmulailagi: () => {},
      onpanduan: () => {},
      ontutup: () => {},
    });
    const dari = render(LayarPendamping, { props: props(giliran('Selesai')) }).body;
    expect(dari).toContain('Periksa isian, lalu tekan Selesai');
    expect(dari).toContain('AI dikunci agar tidak bisa menekan Selesai.');
    expect(dari).not.toContain('Kirim pengajuan');
    const tanpa = render(LayarPendamping, { props: props(giliran()) }).body;
    expect(tanpa).toContain('Periksa isian, lalu kirim sendiri');
    expect(tanpa).not.toContain('Kirim pengajuan');
  });

  it('giliran masuk akun/CAPTCHA: tombol cadangan "Sudah, lanjutkan"; giliran kirim tanpa tombol itu', () => {
    const noop = () => {};
    const layar = (alasan: 'login' | 'masuk_akun' | 'final' | 'verifikasi_situs') =>
      render(LayarPendamping, {
        props: {
          data: {
            ...dataAwal(),
            keadaan: 'giliran',
            mode: 'takeover',
            giliran: { jenis: 'giliran_anda', alasan, pesan: 'Giliran Anda.' },
          },
          situs: 'https://contoh-layanan.go.id',
          onambilalih: noop,
          onkembalikan: noop,
          onhentikan: noop,
          ontutup: noop,
          onmulailagi: noop,
          onpanduan: noop,
        },
      }).body;
    const tombol = /<button[^>]*data-sudah-lanjut[^>]*>[\s\S]*?Sudah, lanjutkan\s*<\/button>/;
    for (const alasan of ['login', 'masuk_akun'] as const) {
      const body = layar(alasan);
      expect(body, alasan).toMatch(tombol);
      expect(body, alasan).toContain('Masuk akun di situs resmi');
    }
    // Kirim akhir dan verifikasi situs: tidak ada jalan pintas "lanjutkan" (warga sendiri yang mengirim/mencentang).
    for (const alasan of ['final', 'verifikasi_situs'] as const)
      expect(layar(alasan), alasan).not.toMatch(tombol);
  });

  it('giliran ketuk_tautan: judul netral, tombol Buka ber-host+jalur dan Lanjutkan; berhenti tanpa Lanjutkan', () => {
    const noop = () => {};
    const tautan = {
      ref: 'e4',
      nama: 'Daftar <b>Akta</b>',
      host: 'contoh-layanan.go.id',
      jalur: '/akta/baru',
    };
    const layar = (alasan: 'ketuk_tautan' | 'final' | 'berhenti', denganTautan = true) => {
      const data: DataPendamping = {
        ...dataAwal(),
        keadaan: 'giliran',
        mode: 'takeover',
        giliran: {
          jenis: 'giliran_anda',
          alasan,
          pesan:
            alasan === 'berhenti'
              ? 'AI berhenti di sini. Lanjutkan sendiri dari layar ini.'
              : 'Ketuk tautan yang disorot, lalu tekan Lanjutkan.',
          ...(alasan === 'ketuk_tautan' && denganTautan ? { tautan } : {}),
        },
      };
      return render(LayarPendamping, {
        props: {
          data,
          situs: 'https://contoh-layanan.go.id',
          onambilalih: noop,
          onkembalikan: noop,
          onhentikan: noop,
          ontutup: noop,
          onmulailagi: noop,
          onpanduan: noop,
        },
      }).body;
    };
    const body = layar('ketuk_tautan');
    // Judul netral: tautan pembuka belum tentu formulir.
    expect(body).toContain('Buka tautan di situs');
    expect(body).not.toContain('Buka formulir');
    expect(body).toContain('AI tidak mengetuk tautan ini; Anda yang membukanya.');
    // Worker membuka tautan lalu AI lanjut: hanya tombol Buka, tanpa Lanjutkan.
    expect(body).not.toMatch(/<button[^>]*>[\s\S]*?Lanjutkan\s*<\/button>/);
    // Tombol Buka: nama tautan dari situs sebagai teks (di-escape), plus host + jalur tujuan.
    expect(body).toMatch(/data-buka-tautan[^>]*>[\s\S]*?Buka “Daftar &lt;b>Akta&lt;\/b>”/);
    expect(body).toContain('(contoh-layanan.go.id/akta/baru)');
    expect(body).not.toContain('<b>Akta</b>');
    // Worker lama tanpa `tautan`: tanpa tombol Buka, Lanjutkan tetap ada.
    expect(layar('ketuk_tautan', false)).not.toContain('data-buka-tautan');
    expect(layar('ketuk_tautan', false)).toMatch(/<button[^>]*>[\s\S]*?Lanjutkan\s*<\/button>/);
    // Pembanding: giliran kirim akhir tetap tanpa Lanjutkan (tombol Kirim di situs milik warga).
    expect(layar('final')).not.toContain('Buka tautan di situs');
    expect(layar('final')).not.toContain('data-buka-tautan');
    // N2: serah akhir: "AI berhenti", tanpa janji coba lagi dan tanpa Lanjutkan.
    const henti = layar('berhenti');
    expect(henti).toContain('AI berhenti');
    expect(henti).not.toMatch(/mencoba lagi/);
    expect(henti).not.toMatch(/<button[^>]*>[\s\S]*?Lanjutkan\s*<\/button>/);
    // Warga mengirim sendiri lalu melapor: "Saya sudah mengirim" hanya di serah akhir, bukan giliran lain.
    expect(henti).toMatch(/data-sudah-kirim[^>]*>Saya sudah mengirim<\/button>/);
    expect(layar('final')).not.toContain('data-sudah-kirim');
    expect(layar('ketuk_tautan')).not.toContain('data-sudah-kirim');
  });

  it('halaman urusan memuat nomor permohonan yang tersimpan (kartu Terkirim setelah sesi ditutup)', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran' });
    rt.store.catatNomorPermohonan(u.id, 'FX-REG-0002');
    rt.akun.catatPemilikUrusan(u.id, { sid: SID });
    const cookies = kue();
    cookies.set(SID_COOKIE, SID);
    const d = (await muatUrusan({
      params: { id: u.id },
      url: new URL(`http://localhost:3000/urusan/${u.id}`),
      setHeaders: () => {},
      cookies,
      locals: {},
    } as never)) as { urusan: { nomorPermohonan: string | null } };
    expect(d.urusan.nomorPermohonan).toBe('FX-REG-0002');
  });

  it('kartu rencana menampilkan dokumen persyaratan dan keterangan tiap langkah', () => {
    const { body } = render(KartuRencana, {
      props: {
        rencana: {
          type: 'plan_card',
          ringkasan: 'Akta kelahiran · Banyumas',
          langkah: [
            {
              id: 'ajukan',
              jenis: 'online-manual',
              judul: 'Ajukan akta kelahiran',
              bawa: [],
              dokumen: ['Kartu Keluarga', 'KTP-el orang tua'],
              keterangan: 'Persyaratan nasional (Perpres 96/2018).',
              sumber: [],
            },
          ],
        } as never,
        kelayakan: null,
        bisaSetujui: false,
        onsetujui: () => {},
        onubah: () => {},
      },
    });
    expect(body).toContain('KTP-el orang tua');
    expect(body).toContain('Persyaratan nasional (Perpres 96/2018).');
  });
});

describe('/privasi', () => {
  it('menyebut setiap pemroses data pihak lain dan retensi cadangan, tanpa worker laptop yang sudah dicabut', async () => {
    // LandingNav membaca `page.data.akun` (CTA tamu vs akun); di luar SvelteKit konteks `page` tidak ada.
    vi.doMock('$app/state', () => ({ page: { data: { akun: null } } }));
    const { default: Privasi } = await import('../../routes/privasi/+page.svelte');
    vi.doUnmock('$app/state');
    const { body } = render(Privasi);
    for (const pihak of [
      'Oracle Cloud',
      'Singapura',
      'OpenAI',
      'Google',
      'mesin pencari sumber resmi',
      'disimpan 3 hari',
    ])
      expect(body, pihak).toContain(pihak);
    // Hanya pihak yang benar-benar memproses data di produksi (email mode log, Turnstile nonaktif, embedding
    // berjalan di server sendiri): yang tidak aktif tidak boleh tercantum.
    for (const tidakAktif of ['Resend', 'Cloudflare Turnstile', 'Jina AI'])
      expect(body, tidakAktif).not.toContain(tidakAktif);
    // Worker laptop dicabut dari produksi: tidak boleh lagi tercantum sebagai pemroses.
    expect(body).not.toContain('Laptop tim Urusin');
    expect(body).not.toContain('Tailscale');
  });
});

describe('Browser Pendamping setelah Kirim', () => {
  const layar = async (data: Partial<DataPendamping>) => {
    const { default: LayarPendamping } = await import('../components/pendamping/LayarPendamping.svelte');
    const noop = () => {};
    return render(LayarPendamping, {
      props: {
        data: { ...dataAwal(), ...data },
        situs: 'https://telunjuksakti.wonogirikab.go.id',
        onambilalih: noop,
        onkembalikan: noop,
        onhentikan: noop,
        ontutup: noop,
        onmulailagi: noop,
        onpanduan: noop,
      },
    }).body;
  };
  const DITUTUP = 'Browser ditutup. Login dan cookie ikut dihapus.';

  it('siaga: nomor + "masih terbuka sebentar" + Tutup sekarang, tanpa klaim ditutup', async () => {
    const b = await layar({ keadaan: 'siaga', mode: 'takeover', bukti: { nomor: 'FX-REG-0001' } });
    expect(b).toContain('FX-REG-0001');
    expect(b).toContain('Browser masih terbuka sebentar');
    expect(b).toContain('Tutup sekarang');
    expect(b).not.toContain(DITUTUP);
  });

  it('takeover tanpa giliran (dijeda): Saya sudah mengirim + pesan 409 yang jujur; AI mengisi: tidak ada', async () => {
    const b = await layar({ keadaan: 'dijeda', mode: 'takeover' });
    expect(b).toMatch(/data-sudah-kirim[^>]*>Saya sudah mengirim<\/button>/);
    expect(b).not.toContain('role="alert"');
    const belum = await layar({
      keadaan: 'dijeda',
      mode: 'takeover',
      pesanKirim: 'Belum terlihat terkirim. Periksa halaman situsnya, lalu coba lagi.',
    });
    expect(belum).toMatch(/role="alert"[^>]*>Belum terlihat terkirim\. Periksa halaman situsnya/);
    expect(await layar({ keadaan: 'dijeda', mode: 'takeover', memeriksaKirim: true })).toMatch(
      /<button[^>]*disabled[^>]*data-sudah-kirim/,
    );
    expect(await layar({ keadaan: 'ai', mode: 'ai' })).not.toContain('data-sudah-kirim');
  });

  it('teks "Browser ditutup" hanya saat sesi benar-benar ditutup (mode done)', async () => {
    expect(await layar({ keadaan: 'selesai', mode: 'done' })).toContain(DITUTUP);
    expect(await layar({ keadaan: 'selesai', mode: 'takeover' })).not.toContain(DITUTUP);
  });
});

describe('Browser Pendamping: status mengikuti fase nyata dan giliran selalu jelas', () => {
  const noop = () => {};
  const layar = (data: Partial<DataPendamping>) =>
    render(LayarPendamping, {
      props: {
        data: { ...dataAwal(), ...data },
        situs: 'https://contoh-layanan.go.id',
        onambilalih: noop,
        onkembalikan: noop,
        onhentikan: noop,
        ontutup: noop,
        onmulailagi: noop,
        onpanduan: noop,
      },
    }).body;
  const giliran = (alasan: GiliranAnda['alasan'], extra: Partial<GiliranAnda> = {}): GiliranAnda => ({
    jenis: 'giliran_anda',
    alasan,
    pesan: 'Giliran Anda.',
    ...extra,
  });

  it('AI tanpa fase spesifik: "AI sedang membaca halaman…", tidak pernah "Mengisi formulir"', () => {
    expect(labelKerjaAi(null)).toBe('AI sedang membaca halaman…');
    expect(labelKerjaAi({ label: '  ' })).toBe('AI sedang membaca halaman…');
    expect(labelKerjaAi({ label: 'Mengunggah KTP' })).toBe('Mengunggah KTP');
    const b = layar({ keadaan: 'ai', mode: 'ai' });
    expect(b).toContain('AI sedang membaca halaman…');
    expect(b).not.toContain('Mengisi formulir');
    expect(b).not.toContain('AI sedang mengisi');
    expect(b).toContain('AI sedang bekerja');
  });

  it('instruksi giliran menyebut kendali sasaran bila ada, tanpa mengarang nama', () => {
    expect(instruksiGiliran(giliran('masuk_akun', { kendali: 'LOGIN' }))).toBe(
      'ketuk “LOGIN” di situs, lalu masuk akun',
    );
    expect(instruksiGiliran(giliran('masuk_akun'))).toBe('masuk akun di situs');
    expect(instruksiGiliran(giliran('final', { tombol: 'Selesai' }))).toBe(
      'periksa isian, lalu tekan “Selesai”',
    );
    expect(instruksiGiliran(giliran('periksa', { kendali: 'Tutup' }))).toMatch(/ketuk “Tutup”/);
    expect(instruksiGiliran(giliran('periksa'))).toBe('periksa halaman di situs');
    expect(instruksiGiliran(null)).toBe('isi formulir di layar ini');
  });

  it('setiap jenis giliran: bilah bawah berisi instruksi DAN tombol aksi giliran itu', () => {
    const kasus: [GiliranAnda['alasan'], RegExp][] = [
      ['masuk_akun', /data-sudah-lanjut[^>]*>[\s\S]*?Sudah, lanjutkan/],
      ['login', /data-sudah-lanjut[^>]*>[\s\S]*?Sudah, lanjutkan/],
      ['periksa', /data-sudah-lanjut[^>]*>[\s\S]*?Lanjutkan/],
      ['isi_sendiri', /<button[^>]*>[\s\S]*?Lanjutkan\s*<\/button>/],
      ['berhenti', /data-sudah-kirim[^>]*>Saya sudah mengirim/],
    ];
    for (const [alasan, tombol] of kasus) {
      const b = layar({ keadaan: 'giliran', mode: 'takeover', giliran: giliran(alasan) });
      const bilah = b.slice(b.indexOf('data-bilah-giliran'));
      expect(bilah, alasan).toContain('Giliran Anda: ');
      expect(bilah, alasan).toMatch(tombol);
      // Lengket di bawah layar HP.
      expect(b, alasan).toMatch(/data-bilah-giliran[^>]*max-lg:sticky max-lg:bottom-0/);
    }
  });

  it('dijeda: status ringkas, "Minta AI bantu mengisi" + "Saya sudah mengirim", Batalkan di menu ⋯', () => {
    const b = layar({ keadaan: 'dijeda', mode: 'takeover' });
    expect(b).toContain('Giliran Anda: isi formulir di layar ini.');
    expect(b).toMatch(/data-minta-ai[^>]*>[\s\S]*?Minta AI bantu mengisi/);
    expect(b).toMatch(/<details[\s\S]*aria-label="Pilihan lain"[\s\S]*data-batalkan[^>]*>Batalkan/);
    expect(b).not.toContain('Mau lanjut atau batalkan?');
  });

  it('sesi berakhir: alasan jujur + Buka lagi situsnya + Buka panduan', () => {
    const b = layar({ keadaan: 'berakhir', pesan: 'Koneksi ke peramban pendamping terputus.' });
    expect(b).toContain('Sesi Browser Pendamping berakhir');
    expect(b).toContain('Koneksi ke peramban pendamping terputus.');
    expect(b).toMatch(/data-buka-lagi[^>]*>[\s\S]*?Buka lagi situsnya/);
    expect(b).toMatch(/data-buka-panduan[^>]*>[\s\S]*?Buka panduan/);
  });
});
