import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  branch,
  byName,
  byRole,
  byText,
  click,
  countIncreased,
  defineAdapter,
  elementExists,
  extract,
  fill,
  forEach,
  gate,
  nav,
  select,
  textIncludes,
  upload,
  urlIncludes,
  validateSteps,
  verify,
  waitFor,
  type Step,
} from './dsl.js';
import { ErrorCode, UrusinError } from './errors.js';

const codes = (input: unknown) => {
  const r = validateSteps(input);
  return r.ok ? [] : r.issues.map((i) => i.code);
};

describe('Step DSL: builder', () => {
  it('nav, fill, select, upload memakai effect yang benar', () => {
    expect(nav('/login')).toEqual({ op: 'nav', path: '/login', effect: 'read' });
    expect(fill(byName('hp'), '{{PEMOHON.HP}}')).toMatchObject({ op: 'fill', effect: 'input' });
    expect(select(byName('kec'), 'Wonogiri')).toMatchObject({ op: 'select', effect: 'input' });
    expect(upload(byName('uploadImage'), '{{FILE:item}}')).toMatchObject({ op: 'upload', effect: 'input' });
  });
  it('gate.human selalu final', () => {
    expect(gate.human('Klik Selesai sendiri', { until: urlIncludes('permohonan') })).toMatchObject({
      effect: 'final',
    });
  });
  it('gate.human messageIf: tervalidasi skema; pesan pengganti kosong ditolak', () => {
    const g = gate.human('Ketik CAPTCHA', {
      until: urlIncludes('/welcome'),
      messageIf: { check: elementExists(byName('password')), message: 'Ketik sandi dan CAPTCHA' },
    });
    expect(g).toMatchObject({ messageIf: { message: 'Ketik sandi dan CAPTCHA' } });
    expect(validateSteps([g]).ok).toBe(true);
    expect(validateSteps([{ ...g, messageIf: { check: urlIncludes('/x'), message: '' } }]).ok).toBe(false);
    expect(gate.human('x', { until: urlIncludes('/y') })).not.toHaveProperty('messageIf');
  });
  it('selector tunggal dibungkus menjadi rantai', () => {
    expect(click(byText('Lanjut'), { effect: 'read' })).toMatchObject({
      target: [{ by: 'text', value: 'Lanjut' }],
    });
  });
  it('byRole opsional name', () => {
    expect(byRole('button')).toEqual({ by: 'role', value: 'button' });
    expect(byRole('button', 'Kirim')).toEqual({ by: 'role', value: 'button', name: 'Kirim' });
  });
});

describe('Step DSL: validator', () => {
  const flowTelunjuk: Step[] = [
    nav('pendaftaran/syarat/{layanan_id}'),
    waitFor(textIncludes('Upload Berkas'), 10_000),
    forEach('berkas', [
      upload(byName('uploadImage'), '{{FILE:item}}'),
      click(byName('btnSubmit'), {
        effect: 'write',
        expectReload: true,
        verify: countIncreased(byName('thumb')),
      }),
    ]),
    gate.human("Periksa lalu klik 'Selesai' sendiri", {
      highlight: byText('Selesai'),
      until: urlIncludes('permohonan'),
    }),
  ];

  it('menerima flow contoh dari rencana §3.4', () => {
    expect(validateSteps(flowTelunjuk).ok).toBe(true);
  });
  it('menerima verify dan extract', () => {
    expect(validateSteps([verify(urlIncludes('/welcome')), extract('table', byName('t'), 'status')]).ok).toBe(
      true,
    );
  });
  it('menolak click ber-effect final di luar gate.human', () => {
    expect(codes([click(byText('Selesai'), { effect: 'final' })])).toEqual([ErrorCode.FINAL_OUTSIDE_GATE]);
  });
  it('menolak final tersembunyi di dalam forEach', () => {
    expect(codes([forEach('x', [click(byText('Kirim'), { effect: 'final' })])])).toEqual([
      ErrorCode.FINAL_OUTSIDE_GATE,
    ]);
  });
  it('menolak final tersembunyi di cabang else', () => {
    const steps = [branch(textIncludes('a'), [nav('/a')], [click(byText('Kirim'), { effect: 'final' })])];
    const r = validateSteps(steps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toEqual([0, 'else', 0]);
  });
  it('menolak nav/fill yang ditandai final (input mentah)', () => {
    expect(codes([{ op: 'nav', path: '/kirim', effect: 'final' }])).toEqual([ErrorCode.FINAL_OUTSIDE_GATE]);
    expect(codes([{ op: 'fill', target: [byName('a')], value: 'x', effect: 'final' }])).toEqual([
      ErrorCode.FINAL_OUTSIDE_GATE,
    ]);
  });
  it('menolak write tanpa verify', () => {
    expect(codes([click(byName('btnSubmit'), { effect: 'write' })])).toEqual([
      ErrorCode.WRITE_WITHOUT_VERIFY,
    ]);
  });
  it('menolak write pada op selain click', () => {
    expect(codes([{ op: 'fill', target: [byName('a')], value: 'x', effect: 'write' }])).toEqual([
      ErrorCode.WRITE_WITHOUT_VERIFY,
    ]);
  });
  it('menolak gate.human yang bukan final', () => {
    expect(codes([{ op: 'gate.human', message: 'm', until: urlIncludes('x'), effect: 'read' }])).toEqual([
      ErrorCode.STEP_SCHEMA_INVALID,
    ]);
  });
  it('menolak op tidak dikenal dan target kosong', () => {
    expect(codes([{ op: 'submit', target: [byName('a')], effect: 'final' }])).toContain(
      ErrorCode.STEP_SCHEMA_INVALID,
    );
    expect(codes([{ op: 'click', target: [], effect: 'read' }])).toContain(ErrorCode.STEP_SCHEMA_INVALID);
  });
  it('menolak effect tidak dikenal', () => {
    expect(codes([{ op: 'nav', path: '/', effect: 'delete' }])).toContain(ErrorCode.STEP_SCHEMA_INVALID);
  });
  it('menolak placeholder rusak pada nilai literal', () => {
    expect(codes([fill(byName('hp'), '{{PEMOHON.HP}')])).toEqual([ErrorCode.PLACEHOLDER_MALFORMED]);
  });
  it('melaporkan beberapa pelanggaran sekaligus', () => {
    expect(codes([click(byText('a'), { effect: 'final' }), click(byText('b'), { effect: 'write' })])).toEqual(
      [ErrorCode.FINAL_OUTSIDE_GATE, ErrorCode.WRITE_WITHOUT_VERIFY],
    );
  });
});

describe('defineAdapter', () => {
  it('menerima adapter dengan origin resmi dan flow valid', () => {
    const a = defineAdapter({
      id: 'dukcapil.wonogiri',
      origin: 'https://telunjuksakti.wonogirikab.go.id',
      flows: {
        masuk: {
          steps: [
            nav('/telunjuksakti/index.php/users/login'),
            fill(byName('hp'), '{{PEMOHON.HP}}'),
            gate.human('Ketik password & CAPTCHA, lalu tekan Masuk', { until: urlIncludes('/welcome') }),
          ],
        },
        ajukan: { params: z.object({ layanan_id: z.number().int() }), steps: [nav('pendaftaran')] },
      },
    });
    expect(a.id).toBe('dukcapil.wonogiri');
  });
  it('menolak origin tiruan', () => {
    expect(() =>
      defineAdapter({ id: 'x', origin: 'https://telunjuksakti.wonogirikab.go.id.evil.com', flows: {} }),
    ).toThrow(UrusinError);
  });
  it('menolak flow dengan klik final dan membawa kodenya', () => {
    try {
      defineAdapter({
        id: 'x',
        origin: 'https://www.lapor.go.id',
        flows: { kirim: { steps: [click(byText('Kirim'), { effect: 'final' })] } },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as UrusinError).code).toBe(ErrorCode.FINAL_OUTSIDE_GATE);
    }
  });
});
