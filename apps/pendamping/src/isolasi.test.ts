import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaRendererTersandbox,
  daftarEdge,
  periksaTanpaRute,
  ruteBawaan,
  type ProsesInfo,
} from './isolasi.js';
import { periksaTanda } from './tanda.js';

const EDGE = { kontrol: new URL('http://pendamping-edge:3129'), proxyPort: 3128, token: 'e'.repeat(40) };

describe('kredensial proxy edge per sesi', () => {
  it('PUT bertanda HMAC berisi sandi acak + host sesi; proxy = IP edge; hapus = DELETE bertanda', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: init.method === 'PUT' ? 201 : 200 });
    };
    const pe = await daftarEdge(EDGE, ['a.go.id'], 60_000, fetcher, async () => '172.30.1.3');
    expect(pe.server).toBe('http://172.30.1.3:3128');
    expect(pe.username).toMatch(/^[0-9a-f]{24}$/);
    expect(pe.password).toMatch(/^[0-9a-f]{48}$/);
    const put = calls[0]!;
    const path = `/sesi/${pe.username}`;
    expect(put.url).toBe(`http://pendamping-edge:3129${path}`);
    expect(JSON.parse(String(put.init.body))).toEqual({
      sandi: pe.password,
      hosts: ['a.go.id'],
      ttlMs: 60_000,
    });
    const h = put.init.headers as Record<string, string>;
    const tanda = { waktu: h['x-urusin-waktu'], nonce: h['x-urusin-nonce'], tanda: h['x-urusin-tanda'] };
    expect(periksaTanda(EDGE.token, tanda, 'PUT', path, String(put.init.body))).toBe(true);
    expect(periksaTanda('x'.repeat(40), tanda, 'PUT', path, String(put.init.body))).toBe(false);
    await pe.hapus();
    expect(calls[1]).toMatchObject({ url: put.url, init: { method: 'DELETE' } });

    const lain = await daftarEdge(EDGE, [], 1, fetcher, async () => '172.30.1.3');
    expect(lain.username).not.toBe(pe.username);
    await expect(
      daftarEdge(
        EDGE,
        [],
        1,
        async () => new Response('', { status: 401 }),
        async () => '1.1.1.1',
      ),
    ).rejects.toThrow(/401/);
  });
});

describe('pemeriksaan boot gagal-tertutup', () => {
  it('sandbox: renderer di userns lain DENGAN filter seccomp tambahan; salah satu saja tidak cukup', () => {
    const proses = (m: Record<string, ProsesInfo>) => (pid: string) => m[pid];
    const aku = { userns: 'user:[1]', filter: 2 };
    expect(
      adaRendererTersandbox(
        [10, 11],
        proses({
          self: aku,
          '10': { userns: 'user:[1]', filter: 2 },
          '11': { userns: 'user:[9]', filter: 3 },
        }),
      ),
    ).toBe(true);
    // --no-sandbox: semua di userns yang sama.
    expect(adaRendererTersandbox([10], proses({ self: aku, '10': { userns: 'user:[1]', filter: 3 } }))).toBe(
      false,
    );
    // Zygote di userns lain tetapi tanpa seccomp-bpf Chromium.
    expect(adaRendererTersandbox([10], proses({ self: aku, '10': { userns: 'user:[9]', filter: 2 } }))).toBe(
      false,
    );
    expect(adaRendererTersandbox([], proses({ self: aku }))).toBe(false);
    expect(adaRendererTersandbox([10], proses({}))).toBe(false);
  });

  it('tanpa rute: rute default IPv4/IPv6 atau sambungan langsung ke internet -> menolak start', async () => {
    const proc = mkdtempSync(join(tmpdir(), 'urusin-proc-'));
    try {
      mkdirSync(join(proc, 'net'));
      const kepala = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n';
      // Hanya subnet jaringan internal (172.30.1.0/24): tidak ada rute default.
      writeFileSync(
        join(proc, 'net', 'route'),
        `${kepala}eth0\t00011EAC\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n`,
      );
      expect(ruteBawaan(proc)).toEqual([]);
      await expect(periksaTanpaRute(proc, async () => false)).resolves.toBeUndefined();
      await expect(periksaTanpaRute(proc, async (h) => h === '1.1.1.1')).rejects.toThrow(/1\.1\.1\.1/);

      writeFileSync(
        join(proc, 'net', 'route'),
        `${kepala}eth0\t00000000\t0100A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`,
      );
      expect(ruteBawaan(proc)).toEqual(['ipv4 via eth0']);
      await expect(periksaTanpaRute(proc, async () => false)).rejects.toThrow(/rute keluar/);

      writeFileSync(join(proc, 'net', 'route'), kepala);
      const nol = '0'.repeat(32);
      writeFileSync(
        join(proc, 'net', 'ipv6_route'),
        `${nol} 00 ${nol} 00 ${nol} ffffffff 00000001 00000000 00200200       lo\n` +
          `${nol} 00 ${nol} 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003     eth0\n`,
      );
      expect(ruteBawaan(proc)).toEqual(['ipv6 via eth0']);
    } finally {
      rmSync(proc, { recursive: true, force: true });
    }
  });
});
