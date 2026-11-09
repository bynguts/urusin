import { bacaSkenarioSse, daftarFixture } from '@urusin/contracts/fixtures-node';
import { describe, expect, it, vi } from 'vitest';
import { CapabilitiesStore } from './capabilities.svelte';
import { ConnectivityStore } from './connectivity.svelte';
import { PREFS_AWAL, PrefsStore, bersihkanPrefs } from './prefs.svelte';
import { keadaanAwal, terapkanEvent } from './reduksi';
import { TtsStore, adaSuaraIndonesia } from './tts.svelte';
import { UrusanStore, type SumberEvent } from './urusan.svelte';

const skenario = (nama: string) => bacaSkenarioSse(nama)!;
const jalankan = (nama: string) => skenario(nama).reduce(terapkanEvent, keadaanAwal());

describe('reduksi: event SSE → state turunan', () => {
  it('jawaban bersumber: progres hilang, jawaban terisi, turn selesai', () => {
    const s = jalankan('urusan/jawaban-bersumber');
    expect(s.jawaban?.klaim.length).toBeGreaterThan(0);
    expect(s.handoff).toBeNull();
    expect(s.sedangBerjalan).toBe(false);
    expect(s.progres).toBeNull();
    expect(s.state).toBe('MEMAHAMI');
    expect(s.lastSeq).toBe(skenario('urusan/jawaban-bersumber').length);
  });

  it('done membawa versi terbaru sehingga pesan lanjutan memakai expectedVersion yang segar', () => {
    const s = jalankan('urusan/jawaban-bersumber');
    const done = {
      type: 'done',
      seq: s.lastSeq + 1,
      chainHead: 'x',
      turnId: 't1',
      status: 'selesai',
      lanjutkan: false,
      degraded: false,
      version: s.version + 5,
    } as unknown as Parameters<typeof terapkanEvent>[1];
    expect(terapkanEvent(s, done).version).toBe(s.version + 5);
  });
  it('streaming (belum done): sedangBerjalan dan progres terakhir', () => {
    const s = jalankan('urusan/streaming');
    expect(s.sedangBerjalan).toBe(true);
    expect(s.progres).toContain('sumber');
  });

  it('handoff menggantikan jawaban; error dan timeout dicatat', () => {
    expect(jalankan('urusan/handoff').handoff?.kanal.length).toBeGreaterThan(0);
    expect(jalankan('urusan/error').galat?.bisaUlang).toBe(true);
    expect(jalankan('urusan/timeout').waktuHabis).toBe(true);
  });

  it('gate, eksekusi, rencana, degraded, checklist, kelayakan', () => {
    expect(jalankan('konfirmasi/menunggu-warga').gate?.jenis).toBe('konfirmasi');
    expect(jalankan('konfirmasi/menunggu-warga').permintaanEksekusi?.adapterId).toBeTruthy();
    expect(jalankan('urusan/rencana').rencana?.langkah.length).toBe(3);
    expect(jalankan('urusan/rencana').kelayakan?.mungkin.length).toBeGreaterThan(0);
    expect(jalankan('urusan/degraded-tanpa-ai').degraded?.mode).toBe('tanpa_ai');
    expect(jalankan('berkas/status-campuran').checklist?.item.map((i) => i.status)).toEqual([
      'ok',
      'perlu',
      'kurang',
    ]);
    expect(jalankan('urusan/degraded-lanjut').perluLanjut).toBe(true);
  });

  it('obrolan ringan: delta digabung', () => {
    expect(jalankan('urusan/obrolan-ringan').teksAsisten).toContain('Halo!');
  });

  it('event dengan seq lama diabaikan (resume tidak menggandakan) dan heartbeat tidak mengubah apa pun', () => {
    const events = skenario('urusan/jawaban-bersumber');
    const s1 = events.reduce(terapkanEvent, keadaanAwal());
    const s2 = events.reduce(terapkanEvent, s1);
    expect(s2.events.length).toBe(s1.events.length);
    const hb = { type: 'heartbeat', seq: 99, at: '2026-11-09T00:00:00.000Z', chainHead: 'x' } as const;
    expect(terapkanEvent(s1, hb)).toBe(s1);
  });

  it('SEMUA skenario SSE di fixtures dapat diterapkan tanpa galat', () => {
    const semua = daftarFixture()
      .map((f) => bacaSkenarioSse(f.nama))
      .filter((e) => e !== null);
    expect(semua.length).toBeGreaterThanOrEqual(15);
    for (const events of semua) expect(() => events!.reduce(terapkanEvent, keadaanAwal())).not.toThrow();
  });
});

class SumberPalsu implements SumberEvent {
  static semua: SumberPalsu[] = [];
  readyState = 1;
  onerror: ((e: unknown) => void) | null = null;
  tutup = false;
  private readonly pendengar = new Map<string, (e: { data: string }) => void>();
  constructor(readonly url: string) {
    SumberPalsu.semua.push(this);
  }
  addEventListener(t: string, fn: (e: { data: string }) => void) {
    this.pendengar.set(t, fn);
  }
  close() {
    this.tutup = true;
  }
  kirim(e: { type: string }) {
    this.pendengar.get(e.type)?.({ data: JSON.stringify(e) });
  }
}

describe('UrusanStore: sambung, resume, kirim', () => {
  const buat = () => {
    SumberPalsu.semua = [];
    return new UrusanStore((u) => new SumberPalsu(u), vi.fn() as never);
  };

  it('menerapkan event dari stream dan menyambung ulang dengan lastEventId terakhir', () => {
    vi.useFakeTimers();
    const store = buat();
    store.sambung('u_abc');
    const a = SumberPalsu.semua[0]!;
    expect(a.url).toBe('/api/urusan/u_abc/stream?lastEventId=0');
    for (const e of skenario('urusan/streaming').slice(0, 2)) a.kirim(e);
    expect(store.keadaan.status).toBe('tersambung');
    expect(store.keadaan.lastSeq).toBe(2);
    // server menutup koneksi → sambung ulang manual dengan backoff, lanjut dari seq 2
    a.readyState = 2;
    a.onerror?.({});
    expect(store.keadaan.status).toBe('terputus');
    vi.advanceTimersByTime(1000);
    const b = SumberPalsu.semua[1]!;
    expect(b.url).toBe('/api/urusan/u_abc/stream?lastEventId=2');
    vi.useRealTimers();
  });

  it('putus menutup sumber dan tidak menyambung ulang', () => {
    vi.useFakeTimers();
    const store = buat();
    store.sambung('u_abc');
    const a = SumberPalsu.semua[0]!;
    store.putus();
    expect(a.tutup).toBe(true);
    a.readyState = 2;
    a.onerror?.({});
    vi.advanceTimersByTime(20_000);
    expect(SumberPalsu.semua.length).toBe(1);
    expect(store.keadaan.status).toBe('diam');
    vi.useRealTimers();
  });

  it('kirim: 409 → konflik tanpa mengubah state; sukses mengosongkan hasil turn lama', async () => {
    const ambil = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(new Response('{"turnId":"t","diterima":true}', { status: 202 }));
    SumberPalsu.semua = [];
    const store = new UrusanStore((u) => new SumberPalsu(u), ambil as never);
    store.sambung('u_abc');
    for (const e of skenario('urusan/jawaban-bersumber')) SumberPalsu.semua[0]!.kirim(e);
    expect(store.keadaan.jawaban).not.toBeNull();
    expect(await store.kirim('lagi')).toBe('konflik');
    expect(store.keadaan.jawaban).not.toBeNull();
    expect(await store.kirim('lagi')).toBe('ok');
    expect(store.keadaan.jawaban).toBeNull();
    expect(store.keadaan.sedangBerjalan).toBe(true);
    const body = JSON.parse((ambil.mock.calls[1]![1] as { body: string }).body);
    expect(body).toEqual({ teks: 'lagi', expectedVersion: store.keadaan.version });
  });

  it('reset mengembalikan keadaan awal', () => {
    const store = buat();
    store.sambung('u_abc');
    store.terapkan(skenario('urusan/streaming')[0]!);
    store.reset();
    expect(store.keadaan).toEqual(keadaanAwal());
  });
});

describe('PrefsStore', () => {
  it('bersihkanPrefs membuang kunci/nilai tidak sah', () => {
    expect(bersihkanPrefs({ ukuranHuruf: 9, tema: 'ungu', modeUji: 'ya', bacakanOtomatis: true })).toEqual({
      ...PREFS_AWAL,
      bacakanOtomatis: true,
    });
    expect(bersihkanPrefs(null)).toEqual(PREFS_AWAL);
  });

  it('menyimpan dan memuat ulang; penyimpanan yang melempar tidak memutus aplikasi', () => {
    const data = new Map<string, string>();
    const gudang = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const a = new PrefsStore(gudang);
    a.atur('ukuranHuruf', 1.25);
    a.atur('tema', 'gelap');
    expect(new PrefsStore(gudang).nilai).toMatchObject({ ukuranHuruf: 1.25, tema: 'gelap' });
    const rusak = {
      getItem: () => {
        throw new Error('diblokir');
      },
      setItem: () => {
        throw new Error('penuh');
      },
    };
    const b = new PrefsStore(rusak);
    expect(() => b.atur('hematData', true)).not.toThrow();
    expect(b.nilai.hematData).toBe(true);
  });
});

describe('TtsStore', () => {
  const suara = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
  class Ucapan {
    lang = '';
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }

  it('tersedia hanya bila ada suara id-ID', () => {
    expect(adaSuaraIndonesia({ getVoices: () => [suara('en-US')] })).toBe(false);
    expect(adaSuaraIndonesia({ getVoices: () => [suara('id_ID')] })).toBe(true);
    expect(adaSuaraIndonesia(undefined)).toBe(false);
  });

  it('baca memakai id-ID dan berhenti membatalkan', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    const tts = new TtsStore({ speak, cancel, getVoices: () => [suara('id-ID')] }, Ucapan as never);
    expect(tts.tersedia).toBe(true);
    tts.baca('Halo');
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0]![0] as Ucapan).lang).toBe('id-ID');
    expect(tts.membaca).toBe(true);
    tts.berhenti();
    expect(cancel).toHaveBeenCalled();
    expect(tts.membaca).toBe(false);
  });

  it('tanpa suara id-ID: baca tidak melakukan apa pun', () => {
    const speak = vi.fn();
    const tts = new TtsStore({ speak, cancel: vi.fn(), getVoices: () => [] }, Ucapan as never);
    tts.baca('Halo');
    expect(tts.tersedia).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });
});

describe('CapabilitiesStore dan ConnectivityStore', () => {
  it('capabilities membaca kapabilitas dari /api/kemampuan; gagal → default aman', async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ llm: 'llm', kapabilitas: { ai: 'hemat', vision: false, rag: 'siap' } }),
        ),
      );
    const c = new CapabilitiesStore(ok as never);
    await c.muat();
    expect(ok).toHaveBeenCalledWith('/api/kemampuan', expect.anything());
    expect(c.keadaan).toEqual({ ai: 'hemat', vision: false, rag: 'siap', dimuat: true });
    const gagal = new CapabilitiesStore(vi.fn().mockRejectedValue(new Error('offline')) as never);
    await gagal.muat();
    expect(gagal.keadaan).toMatchObject({ ai: 'normal', dimuat: false });
    const tanpaField = new CapabilitiesStore(vi.fn().mockResolvedValue(new Response('{"ok":true}')) as never);
    await tanpaField.muat();
    expect(tanpaField.keadaan).toMatchObject({ ai: 'normal', vision: true, dimuat: true });
    const memuat = new CapabilitiesStore(
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 })) as never,
    );
    await memuat.muat();
    expect(memuat.keadaan).toMatchObject({ ai: 'normal', dimuat: false });
  });

  it('connectivity: default online di SSR/tanpa window', () => {
    expect(new ConnectivityStore(undefined).keadaan).toEqual({ online: true, hemat: false });
  });
});
