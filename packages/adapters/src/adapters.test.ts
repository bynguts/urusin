import {
  byName,
  byRole,
  css,
  egressAllowedHosts,
  fill,
  gate,
  nav,
  urlIncludes,
  type Step,
} from '@urusin/core';
import { describe, expect, it } from 'vitest';
import {
  ADAPTERS,
  FLOW_SIMULASI,
  alurSimulasiUntuk,
  buildProgram,
  finalGateIndex,
  hostsSesi,
  requiredData,
  type Adapter,
  type Params,
} from './adapters.js';
import { humanOnlyTargets } from '@urusin/executor';

describe('adapter bawaan', () => {
  it('Telunjuk Sakti ajukan: origin resmi, nilai pribadi bertoken, final hanya lewat gate.human', () => {
    const r = buildProgram('telunjuk-sakti-wonogiri', 'ajukan', { layanan_id: 2, berkas: 'ktp, kk' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { origin, steps } = r.program;
    expect(origin).toBe('https://telunjuksakti.wonogirikab.go.id');
    expect(steps.filter((s) => s.op === 'upload')).toHaveLength(2);
    expect(steps.some((s) => 'effect' in s && s.effect === 'final' && s.op !== 'gate.human')).toBe(false);
    expect(requiredData(steps)).toEqual({ placeholder: ['{{PEMOHON.HP}}'], berkas: ['ktp', 'kk'] });
    expect(steps[finalGateIndex(steps)]).toMatchObject({
      op: 'gate.human',
      until: { value: expect.stringContaining('/welcome/permohonan') },
    });
    // Giliran masuk: replika publik hanya HP + CAPTCHA (tanpa sandi); teks sandi hanya bila kolomnya ada.
    expect(steps.find((s) => s.op === 'gate.human')).toMatchObject({
      message: 'Giliran Anda: ketik kode CAPTCHA, lalu tekan Masuk.',
      messageIf: {
        check: {
          kind: 'elementExists',
          target: [css('input[type="password"]'), { by: 'name', value: 'password' }],
        },
        message: 'Giliran Anda: ketik kata sandi dan kode CAPTCHA, lalu tekan Login.',
      },
    });
    // Portal asli (peta 2026-11-12, pohon aksesibilitas): tombol `input[name=loginSubmit]` tanpa id bernama "Login";
    // sorotan dan perlindungan khusus-warga harus mengenainya, bukan hanya `#loginSubmit`/"Masuk" milik replika.
    const login = steps.find((s) => s.op === 'gate.human');
    expect(login?.op === 'gate.human' && login.highlight).toEqual(
      expect.arrayContaining([byName('loginSubmit'), byRole('button', 'Login')]),
    );
    expect(humanOnlyTargets(steps)[0]).toEqual(expect.arrayContaining([byRole('button', 'Login')]));
    // Verifikasi unggah: penanda replika dulu, lalu cadangan untuk DOM portal asli yang belum teramati.
    const unggah = steps.find((s) => s.op === 'click' && s.effect === 'write');
    expect(unggah?.op === 'click' && unggah.verify).toEqual({
      kind: 'countIncreased',
      target: [css('.uploaded-item'), css('table tbody tr'), css('img[src*="upload" i]')],
    });
    // Giliran kirim menyebut tombol yang ada di halaman ("Selesai"); tanpa tombol itu teksnya netral.
    expect(steps[finalGateIndex(steps)]).toMatchObject({
      message: 'Semua berkas terunggah. Periksa, lalu tekan sendiri tombol kirim yang disorot.',
      messageIf: {
        check: {
          kind: 'elementExists',
          target: [
            { by: 'role', value: 'link', name: 'Selesai' },
            { by: 'role', value: 'button', name: 'Selesai' },
          ],
        },
        message: 'Semua berkas terunggah. Periksa, lalu tekan Selesai sendiri untuk mengirim.',
      },
    });
    // Tombol Masuk dan Selesai adalah elemen khusus warga.
    expect(humanOnlyTargets(steps).map((t) => t[0])).toEqual([css('#loginSubmit'), css('#btnSelesai')]);
    expect(JSON.stringify(steps)).not.toMatch(/\d{10,}/);
  });

  it('default satu berkas; param tidak sah ditolak', () => {
    const r = buildProgram('telunjuk-sakti-wonogiri', 'ajukan', { layanan_id: 1 });
    expect(r.ok && requiredData(r.program.steps).berkas).toEqual(['berkas1']);
    for (const params of <Params[]>[
      { layanan_id: 0 },
      { layanan_id: 'x' },
      { layanan_id: 1, berkas: '../etc' },
      { layanan_id: 1, berkas: ' , ' },
      { layanan_id: 1, berkas: Array.from({ length: 11 }, (_, i) => `b${i}`).join(',') },
    ]) {
      expect(buildProgram('telunjuk-sakti-wonogiri', 'ajukan', params)).toMatchObject({
        ok: false,
        code: 'PARAM_TIDAK_SAH',
      });
    }
  });

  it('adapter/flow tak dikenal, termasuk kunci prototipe', () => {
    for (const [a, f] of [
      ['x', 'ajukan'],
      ['telunjuk-sakti-wonogiri', 'hapus'],
      ['__proto__', 'ajukan'],
      ['telunjuk-sakti-wonogiri', 'toString'],
    ] as const) {
      expect(buildProgram(a, f, {})).toMatchObject({ ok: false, code: 'ADAPTER_TIDAK_ADA' });
    }
  });

  it('requiredData menelusuri forEach/branch/select; finalGateIndex -1 tanpa gate', () => {
    const steps: Step[] = [
      nav('/a'),
      { op: 'forEach', over: 'x', steps: [fill(css('#a'), 'Nama {{PEMOHON.NAMA}}')] },
      {
        op: 'branch',
        when: urlIncludes('/b'),
        then: [{ op: 'select', target: [css('#s')], value: '{{PEMOHON.JK}}', effect: 'input' }],
        else: [{ op: 'upload', target: [css('#f')], file: '{{FILE:foto}}', effect: 'input' }],
      },
      { op: 'branch', when: urlIncludes('/c'), then: [nav('/c')] },
    ];
    expect(requiredData(steps)).toEqual({
      placeholder: ['{{PEMOHON.NAMA}}', '{{PEMOHON.JK}}'],
      berkas: ['foto'],
    });
    expect(finalGateIndex(steps)).toBe(-1);
    expect(finalGateIndex([...steps, gate.human('g', { until: urlIncludes('/z') })])).toBe(4);
  });

  it('alur baca-saja situs nyata: origin resmi, nilai warga lewat placeholder vault, AI tidak menekan tombol warga', () => {
    const kasus: [string, string, string[]][] = [
      ['samsat-dki', 'cek_pkb', ['{{KENDARAAN.NOPOL_ANGKA}}', '{{KENDARAAN.NOPOL_HURUF}}']],
      ['oss-nib', 'cari_nib', ['{{USAHA.NIB}}']],
      ['klampid-surabaya', 'cek_status', ['{{URUSAN.KITIR}}']],
      ['sidnok-semarang', 'cek_status', ['{{URUSAN.KODE_PELAYANAN}}']],
      ['telunjuk-sakti-wonogiri', 'cek_status', []],
    ];
    for (const [a, f, ph] of kasus) {
      const r = buildProgram(a, f, {});
      expect(r, `${a}/${f}`).toMatchObject({ ok: true, program: { bacaSaja: true } });
      if (!r.ok) continue;
      expect(r.program.origin).toBe(ADAPTERS[a]!.origin);
      expect(requiredData(r.program.steps).placeholder).toEqual(ph);
      // Baca saja: tidak ada klik write/final oleh AI.
      expect(r.program.steps.some((s) => s.op === 'click' && s.effect !== 'read')).toBe(false);
    }
    // Captcha matematika: tombol Cari/Cek Status khusus warga.
    const smg = buildProgram('sidnok-semarang', 'cek_status', {});
    expect(smg.ok && humanOnlyTargets(smg.program.steps)[0]).toEqual([
      byRole('button', 'Cek Status'),
      css('#cek-form button'),
    ]);
  });

  it('probe masuk akun dan bukti dideklarasikan adapter (Telunjuk Sakti), bukan ditulis model', () => {
    const r = buildProgram('telunjuk-sakti-wonogiri', 'ajukan', { layanan_id: 1 });
    expect(r.ok && r.program.masuk).toEqual({
      keluar: { kind: 'elementExists', target: [css('#loginSubmit'), byName('loginSubmit')] },
      halaman: '/telunjuksakti/index.php/users/login',
    });
    expect(r.ok && r.program.bukti?.nomor).toEqual([
      css('#tblPermohonan tbody tr:last-child td.no-registrasi'),
    ]);
    expect(r.ok && r.program.bacaSaja).toBeUndefined();
    const samsat = buildProgram('samsat-dki', 'cek_pkb', {});
    expect(samsat.ok && samsat.program.masuk).toBeUndefined();
  });

  it('alur berkamera (swafoto) ditolak: prasyarat di perangkat warga, urusan dipandu', () => {
    const uji: Record<string, Adapter> = {
      x: {
        origin: 'https://telunjuksakti.wonogirikab.go.id',
        hosts: [],
        flows: { swafoto: { langkah: () => [nav('/a')], kamera: true } },
      },
      luar: { origin: 'https://contoh.example', hosts: [], flows: { a: { langkah: () => [nav('/a')] } } },
    };
    expect(buildProgram('x', 'swafoto', {}, uji)).toMatchObject({ ok: false, code: 'PERLU_PERANGKAT_WARGA' });
    expect(buildProgram('luar', 'a', {}, uji)).toMatchObject({
      ok: false,
      code: 'ADAPTER_ORIGIN_NOT_OFFICIAL',
    });
  });

  it('host egress per adapter: hanya yang dibutuhkan situs itu, semuanya terdaftar di registry', () => {
    const union = new Set(egressAllowedHosts());
    for (const [id, a] of Object.entries(ADAPTERS)) {
      for (const h of a.hosts) expect(union.has(h), `${id}: ${h}`).toBe(true);
      const flow = Object.keys(a.flows)[0]!;
      const r = buildProgram(id, flow, { layanan_id: 1 });
      expect(r.ok, id).toBe(true);
      if (r.ok) expect(hostsSesi(r.program)).toEqual([new URL(a.origin).hostname, ...a.hosts]);
    }
    // Iframe Turnstile (challenges.cloudflare.com) hanya untuk situs yang memang memakainya (diamati dari
    // server produksi 2026-11-10: interstitial Telunjuk Sakti, widget di halaman Samsat); Si D'nOK/Klampid tidak.
    const pakaiTurnstile = Object.entries(ADAPTERS)
      .filter(([, a]) => a.hosts.includes('challenges.cloudflare.com'))
      .map(([id]) => id);
    expect(pakaiTurnstile).toEqual(['telunjuk-sakti-wonogiri', 'samsat-dki', 'oss-nib']);
    // CDN umum tidak ikut ke sesi yang tidak memakainya.
    const smg = buildProgram('sidnok-semarang', 'cek_status', {});
    expect(smg.ok && hostsSesi(smg.program)).toEqual(['sidnok.semarangkota.go.id']);
    expect(hostsSesi({ origin: 'https://OSS.go.id', hosts: ['oss.go.id', 'gw.oss.go.id'] })).toEqual([
      'oss.go.id',
      'gw.oss.go.id',
    ]);
    const asing: Record<string, Adapter> = {
      x: {
        origin: 'https://oss.go.id',
        hosts: ['evil.example'],
        flows: { a: { langkah: () => [nav('/a')] } },
      },
    };
    expect(buildProgram('x', 'a', {}, asing)).toMatchObject({
      ok: false,
      code: 'ADAPTER_HOST_TIDAK_TERDAFTAR',
    });
  });
});

describe('alur simulasi (hanya replika uji)', () => {
  const ORIGIN = {
    'telunjuk-sakti-wonogiri': 'https://telunjuksakti.wonogirikab.go.id',
    'klampid-surabaya': 'https://wargaklampid-dispendukcapil.surabaya.go.id',
    'sidnok-semarang': 'https://sidnok.semarangkota.go.id',
  } as const;

  it.each(Object.entries(ORIGIN))(
    '%s: program bertanda hanyaUji, mengisi data pemohon, final lewat gate.human',
    (id, o) => {
      expect(alurSimulasiUntuk(o)).toEqual({ adapterId: id, flowId: FLOW_SIMULASI });
      const r = buildProgram(id, FLOW_SIMULASI, {});
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.program.hanyaUji).toBe(true);
      const { steps } = r.program;
      expect(steps[0]).toMatchObject({ op: 'nav' });
      expect(steps.filter((s) => s.op === 'fill')).toHaveLength(6);
      expect(requiredData(steps).placeholder).toContain('{{PEMOHON.NAMA}}');
      // Tanpa dinding login: satu-satunya gate.human adalah gerbang kirim akhir.
      expect(steps.filter((s) => s.op === 'gate.human')).toHaveLength(1);
      expect(steps[finalGateIndex(steps)]).toMatchObject({
        op: 'gate.human',
        until: { value: expect.stringContaining('/simulasi/terkirim') },
      });
    },
  );

  it('alur biasa tidak bertanda hanyaUji; origin tanpa formulir replika tidak punya alur simulasi', () => {
    const r = buildProgram('telunjuk-sakti-wonogiri', 'ajukan', { layanan_id: 1 });
    expect(r.ok && r.program.hanyaUji).toBeFalsy();
    expect(alurSimulasiUntuk('https://samsat-pkb2.jakarta.go.id')).toBeUndefined();
    expect(alurSimulasiUntuk('https://oss.go.id')).toBeUndefined();
    expect(alurSimulasiUntuk('https://contoh.go.id')).toBeUndefined();
  });
});
