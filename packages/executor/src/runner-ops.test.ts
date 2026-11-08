import { afterEach, describe, expect, it } from 'vitest';
import { byLabel, byName, byRole, byText, css, type Check, type Step } from '@urusin/core';
import { evalCheck, resolveAll, resolveTarget, runOp, setNativeValue } from './runner-ops.js';

const body = (htmlText: string) => {
  document.body.innerHTML = htmlText;
};
afterEach(() => {
  document.body.innerHTML = '';
});

const step = (s: Step) => runOp({ kind: 'step', step: s });

describe('resolusi selector', () => {
  it('label, role+name, name, text, css', () => {
    body(`
      <label for="hp">Nomor HP</label><input id="hp" name="hp" />
      <label>Nama <input name="nama" /></label>
      <button id="b1">Kirim</button><button id="b2">Batal</button>
      <a href="/x">Lihat status</a>`);
    expect(resolveTarget(document, [byLabel('nomor hp')])?.id).toBe('hp');
    expect((resolveTarget(document, [byLabel('Nama')]) as HTMLInputElement).name).toBe('nama');
    expect(resolveTarget(document, [byRole('button', 'batal')])?.id).toBe('b2');
    expect(resolveTarget(document, [byName('hp')])?.id).toBe('hp');
    expect(resolveTarget(document, [byText('Lihat status')])?.tagName).toBe('A');
    expect(resolveTarget(document, [css('#b1')])?.textContent).toBe('Kirim');
  });

  it('rantai selector: fallback ke selector berikutnya; kosong bila semua gagal; css rusak tidak melempar', () => {
    body('<button id="ok">Ya</button>');
    expect(resolveTarget(document, [css('#tidak-ada'), css('#ok')])?.id).toBe('ok');
    expect(resolveTarget(document, [css('#tidak-ada'), byText('zzz')])).toBeNull();
    expect(resolveAll(document, [css('div[')])).toEqual([]);
  });
});

describe('evalCheck', () => {
  it('textIncludes, elementExists, countIncreased', () => {
    body('<ul><li class="i">a</li><li class="i">b</li></ul><p>Daftar Permohonan</p>');
    expect(evalCheck(document, { kind: 'textIncludes', value: 'daftar  permohonan' })).toBe(true);
    expect(evalCheck(document, { kind: 'elementExists', target: [css('.nope')] })).toBe(false);
    expect(evalCheck(document, { kind: 'countIncreased', target: [css('.i')] }, 1)).toBe(true);
    expect(evalCheck(document, { kind: 'countIncreased', target: [css('.i')] }, 2)).toBe(false);
  });
});

describe('fill React-safe', () => {
  it('memakai setter native sehingga pelacak nilai instance (React) tidak ikut terupdate, dan event bubble', async () => {
    body('<div id="root"><input name="hp" /></div>');
    const input = document.querySelector('input')!;
    // Meniru "value tracker" React: instance memasang property sendiri yang mencatat nilai terakhir.
    let tracked = '';
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => nativeSetter.get!.call(input),
      set: (v: string) => {
        tracked = v;
        nativeSetter.set!.call(input, v);
      },
    });
    const seen: string[] = [];
    document
      .getElementById('root')!
      .addEventListener('input', (e) => seen.push((e.target as HTMLInputElement).value));
    const changes: string[] = [];
    document
      .getElementById('root')!
      .addEventListener('change', (e) => changes.push((e.target as HTMLInputElement).value));

    const r = await step({ op: 'fill', target: [byName('hp')], value: '0800', effect: 'input' });
    expect(r).toEqual({ ok: true });
    expect(input.value).toBe('0800');
    expect(tracked).toBe(''); // setter instance dilewati: React melihat perubahan dan memicu onChange
    expect(seen).toEqual(['0800']);
    expect(changes).toEqual(['0800']);
  });

  it('textarea, select, dan elemen non-field', () => {
    body(
      '<textarea name="t"></textarea><select name="s"><option value="a">A</option><option value="b">B</option></select><p id="p">x</p>',
    );
    expect(setNativeValue(document.querySelector('textarea')!, 'isi')).toBe(true);
    expect(document.querySelector('textarea')!.value).toBe('isi');
    expect(setNativeValue(document.querySelector('select')!, 'b')).toBe(true);
    expect(document.querySelector('select')!.value).toBe('b');
    expect(setNativeValue(document.getElementById('p')!, 'x')).toBe(false);
  });

  it('target tidak ada -> ADAPTER_DRIFT', async () => {
    body('<p>kosong</p>');
    expect(await step({ op: 'fill', target: [byName('hp')], value: 'x', effect: 'input' })).toMatchObject({
      ok: false,
      code: 'ADAPTER_DRIFT',
    });
  });
});

describe('click', () => {
  it('read/write mengklik; final DITOLAK walau elemen ada', async () => {
    body('<button id="b">Go</button>');
    let clicks = 0;
    document.getElementById('b')!.addEventListener('click', () => clicks++);
    const target = [css('#b')];
    expect(await step({ op: 'click', target, effect: 'read' })).toEqual({ ok: true });
    expect(clicks).toBe(1);
    const final = await step({ op: 'click', target, effect: 'final' });
    expect(final).toMatchObject({ ok: false, code: 'FINAL_NOT_AUTOMATABLE' });
    expect(clicks).toBe(1);
  });

  it('target hilang -> ADAPTER_DRIFT', async () => {
    body('');
    expect(await step({ op: 'click', target: [css('#x')], effect: 'read' })).toMatchObject({
      code: 'ADAPTER_DRIFT',
    });
  });
});

describe('extract', () => {
  it('tabel dengan thead dan tbody', async () => {
    body(`<table id="t"><thead><tr><th>No</th><th>Status</th></tr></thead>
      <tbody><tr><td>1</td><td> Diproses </td></tr><tr><td>2</td><td>Selesai</td></tr></tbody></table>`);
    const r = await step({ op: 'extract', mode: 'table', target: [css('#t')], into: 'x', effect: 'read' });
    expect(r).toEqual({
      ok: true,
      value: {
        headers: ['No', 'Status'],
        rows: [
          ['1', 'Diproses'],
          ['2', 'Selesai'],
        ],
      },
    });
  });

  it('mode text; bukan tabel -> drift', async () => {
    body('<p id="p"> halo   dunia </p>');
    expect(
      await step({ op: 'extract', mode: 'text', target: [css('#p')], into: 'x', effect: 'read' }),
    ).toEqual({
      ok: true,
      value: 'halo dunia',
    });
    expect(
      await step({ op: 'extract', mode: 'table', target: [css('#p')], into: 'x', effect: 'read' }),
    ).toMatchObject({
      code: 'ADAPTER_DRIFT',
    });
  });
});

describe('waitFor', () => {
  it('terpenuhi segera, setelah mutasi DOM, dan timeout', async () => {
    body('<div id="root"></div>');
    const check: Check = { kind: 'elementExists', target: [css('#late')] };
    expect(await runOp({ kind: 'wait', check, timeoutMs: 50 })).toMatchObject({
      ok: false,
      code: 'WAIT_TIMEOUT',
    });

    const pending = runOp({ kind: 'wait', check, timeoutMs: 2000 });
    setTimeout(
      () => document.getElementById('root')!.insertAdjacentHTML('beforeend', '<i id="late"></i>'),
      20,
    );
    expect(await pending).toEqual({ ok: true });
    expect(await runOp({ kind: 'wait', check, timeoutMs: 50 })).toEqual({ ok: true });
  });
});

describe('op lain', () => {
  it('count dan op yang bukan urusan runner', async () => {
    body('<i class="a"></i><i class="a"></i>');
    expect(await runOp({ kind: 'count', target: [css('.a')] })).toEqual({ ok: true, value: 2 });
    expect(await step({ op: 'nav', path: '/x', effect: 'read' })).toMatchObject({ code: 'UNSUPPORTED_OP' });
  });
});

describe('ekstensi eksekutor: select, upload, rect, text, elemen khusus warga', () => {
  it('select: hanya ke <select>, nilai harus ada di daftar', async () => {
    body('<select id="s"><option value="a">A</option><option value="b">B</option></select><input id="i" />');
    expect(await step({ op: 'select', target: [css('#s')], value: 'b', effect: 'input' })).toEqual({
      ok: true,
    });
    expect((document.getElementById('s') as HTMLSelectElement).value).toBe('b');
    for (const [sel, value] of [
      ['#s', 'zz'],
      ['#i', 'a'],
      ['#none', 'a'],
    ] as const) {
      expect(await step({ op: 'select', target: [css(sel)], value, effect: 'input' })).toMatchObject({
        code: 'ADAPTER_DRIFT',
      });
    }
  });

  it('upload: berkas dipasang lewat DataTransfer; target salah = ADAPTER_DRIFT', async () => {
    body('<input id="f" type="file" /><input id="t" />');
    let changed = 0;
    document.getElementById('f')!.addEventListener('change', () => changed++);
    const file = { name: 'ktp.png', mime: 'image/png', base64: btoa('abc') };
    const r = await runOp({ kind: 'upload', target: [css('#f')], file });
    if (r.ok) {
      expect((document.getElementById('f') as HTMLInputElement).files?.[0]?.name).toBe('ktp.png');
      expect(changed).toBe(1);
    } else {
      // Lingkungan uji tanpa DataTransfer: tetap gagal aman, tidak melempar. Jalur nyata dicakup e2e.
      expect(r.code).toBe('RUNNER_ERROR');
    }
    expect(await runOp({ kind: 'upload', target: [css('#t')], file })).toMatchObject({
      code: 'ADAPTER_DRIFT',
    });
    expect(await runOp({ kind: 'upload', target: [css('#x')], file })).toMatchObject({
      code: 'ADAPTER_DRIFT',
    });
  });

  it('rect dan text', async () => {
    body('<button id="b">Kirim</button><p>Halo dunia</p>');
    expect(await runOp({ kind: 'rect', target: [css('#b')] })).toMatchObject({
      ok: true,
      value: { x: expect.any(Number), lebar: expect.any(Number) },
    });
    expect(await runOp({ kind: 'rect', target: [css('#none')] })).toMatchObject({ code: 'ADAPTER_DRIFT' });
    const t = await runOp({ kind: 'text', maxChars: 5 });
    expect(t.ok && typeof t.value === 'string' && t.value.length <= 5).toBe(true);
  });

  it('klik ke elemen khusus warga (highlight gate.human) ditolak walau effect read', async () => {
    let clicked = 0;
    body(
      '<form id="f"><button id="kirim" type="button"><span id="ikon">Kirim</span></button></form><a id="ok">Lanjut</a>',
    );
    document.getElementById('kirim')!.addEventListener('click', () => clicked++);
    const finalTargets = [[css('#kirim')]];
    for (const target of [[css('#kirim')], [css('#ikon')], [css('#f')], [byText('Kirim')]]) {
      expect(
        await runOp({ kind: 'step', step: { op: 'click', target, effect: 'read' }, finalTargets }),
      ).toMatchObject({ ok: false, code: 'FINAL_NOT_AUTOMATABLE' });
    }
    expect(clicked).toBe(0);
    expect(
      await runOp({
        kind: 'step',
        step: { op: 'click', target: [css('#ok')], effect: 'read' },
        finalTargets,
      }),
    ).toEqual({ ok: true });
  });

  it('consent tanpa kait = UNSUPPORTED_OP; dengan kait memakai hasilnya', async () => {
    const summary = { origin: 'https://x', fills: [], writes: 0 };
    expect(await runOp({ kind: 'consent', summary })).toMatchObject({ code: 'UNSUPPORTED_OP' });
    expect(await runOp({ kind: 'consent', summary }, document, { consent: async () => true })).toEqual({
      ok: true,
      value: true,
    });
  });
});
