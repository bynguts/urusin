import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  jenisSandboxRenderer,
  daftarEdge,
  periksaTanpaRute,
  ruteBawaan,
  type ProsesInfo,
} from './isolasi.js';
import { isiCocok, periksaTanda } from './tanda.js';

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
    const body = Buffer.from(String(put.init.body));
    const tanda = {
      waktu: h['x-urusin-waktu'],
      nonce: h['x-urusin-nonce'],
      tanda: h['x-urusin-tanda'],
      isi: h['x-urusin-isi-sha256'],
      panjang: String(body.byteLength),
    };
    expect(periksaTanda(EDGE.token, tanda, 'PUT', path)).toBe(true);
    expect(isiCocok(tanda, body)).toBe(true);
    expect(periksaTanda('x'.repeat(40), tanda, 'PUT', path)).toBe(false);
    // Persetujuan host aset pemda tepat waktu: POST bertanda ke /sesi/<user>/aset (status selain 201 = false).
    expect(await pe.setujuiAset('cdn.a.go.id')).toBe(false);
    const post = calls[1]!;
    const jalurAset = `${path}/aset`;
    expect(post.url).toBe(`http://pendamping-edge:3129${jalurAset}`);
    expect(JSON.parse(String(post.init.body))).toEqual({ host: 'cdn.a.go.id' });
    const ha = post.init.headers as Record<string, string>;
    const tandaAset = {
      waktu: ha['x-urusin-waktu'],
      nonce: ha['x-urusin-nonce'],
      tanda: ha['x-urusin-tanda'],
      isi: ha['x-urusin-isi-sha256'],
      panjang: String(Buffer.byteLength(String(post.init.body))),
    };
    expect(periksaTanda(EDGE.token, tandaAset, 'POST', jalurAset)).toBe(true);
    calls.splice(1);
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
  it('sandbox: renderer userns lain ATAU PID ns baru (setuid), DENGAN filter seccomp tambahan', () => {
    const proses = (m: Record<string, ProsesInfo>) => (pid: string) => m[pid];
    const aku = { userns: 'user:[1]', pidns: 1, filter: 2 };
    const j = (pids: number[], m: Record<string, ProsesInfo>) =>
      jenisSandboxRenderer(pids, proses({ self: aku, ...m }));
    // Sandbox namespace (userns tersedia).
    expect(
      j([10, 11], {
        '10': { userns: 'user:[1]', pidns: 1, filter: 2 },
        '11': { userns: 'user:[9]', pidns: 2, filter: 3 },
      }),
    ).toBe('userns');
    // Sandbox setuid (userns dimatikan): tautan ns tak terbaca, NSpid bersarang (diukur: "NSpid: 140 14").
    expect(j([10], { '10': { userns: undefined, pidns: 2, filter: 3 } })).toBe('setuid');
    expect(j([10], { '10': { userns: 'user:[1]', pidns: 2, filter: 3 } })).toBe('setuid');
    // --no-sandbox: userns dan PID ns sama.
    expect(j([10], { '10': { userns: 'user:[1]', pidns: 1, filter: 3 } })).toBeNull();
    expect(j([10], { '10': { userns: undefined, pidns: 1, filter: 3 } })).toBeNull();
    // Zygote di namespace lain tetapi tanpa seccomp-bpf Chromium.
    expect(j([10], { '10': { userns: 'user:[9]', pidns: 2, filter: 2 } })).toBeNull();
    expect(j([10], { '10': { userns: undefined, pidns: 2, filter: 2 } })).toBeNull();
    expect(j([], {})).toBeNull();
    expect(jenisSandboxRenderer([10], proses({}))).toBeNull();
    // Tautan userns proses sendiri tak terbaca: tidak bisa dibandingkan -> gagal tertutup.
    expect(
      jenisSandboxRenderer(
        [10],
        proses({ self: { pidns: 1, filter: 2 }, '10': { userns: 'user:[9]', pidns: 2, filter: 3 } }),
      ),
    ).toBeNull();
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
