import { css, fill, gate, nav, urlIncludes, type Step } from '@urusin/core';
import { describe, expect, it } from 'vitest';
import { buildProgram, finalGateIndex, requiredData, type Params } from './adapters.js';
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
});
