import { afterEach, describe, expect, it } from 'vitest';
import { byLabel, byName, byRole, byText, css, type Check, type Step } from '@urusin/core';
import { evalCheck, resolveAll, resolveTarget, runOp, setNativeValue } from './runner-ops';

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
