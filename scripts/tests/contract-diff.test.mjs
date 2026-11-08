import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffContracts, diffSchemas } from '../lib/contract-diff.mjs';

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const msgs = (a, b) => diffSchemas(a, b).map((v) => v.message);

describe('diffSchemas: perubahan aditif lolos', () => {
  it('properti baru (optional) dan tipe yang melebar', () => {
    const a = obj({ x: { type: 'string' } });
    assert.deepEqual(diffSchemas(a, obj({ x: { type: 'string' }, y: { type: 'number' } }, ['x'])), []);
    assert.deepEqual(diffSchemas({ type: 'string' }, { anyOf: [{ type: 'string' }, { type: 'null' }] }), []);
  });
  it('enum bertambah dan batas melonggar', () => {
    assert.deepEqual(diffSchemas({ enum: ['a'] }, { enum: ['a', 'b'] }), []);
    assert.deepEqual(diffSchemas({ type: 'string', maxLength: 5 }, { type: 'string', maxLength: 9 }), []);
  });
});

describe('diffSchemas: perubahan merusak gagal', () => {
  it('properti dihapus atau diganti nama', () => {
    const a = obj({ nama: { type: 'string' } });
    assert.equal(msgs(a, obj({ judul: { type: 'string' } })).length, 1);
    assert.equal(msgs(a, obj({})).length, 1);
  });
  it('tipe menyempit', () => {
    assert.equal(msgs({ type: 'string' }, { type: 'number' }).length, 1);
    assert.ok(msgs({ anyOf: [{ type: 'string' }, { type: 'null' }] }, { type: 'string' }).length >= 1);
  });
  it('nilai enum dihapus', () => {
    assert.ok(msgs({ enum: ['a', 'b'] }, { enum: ['a'] }).length >= 1);
  });
  it('optional menjadi required dan batas diperketat', () => {
    const a = obj({ x: { type: 'string' } }, []);
    assert.equal(msgs(a, obj({ x: { type: 'string' } }, ['x'])).length, 1);
    assert.equal(msgs({ type: 'string', maxLength: 9 }, { type: 'string', maxLength: 5 }).length, 1);
    assert.equal(msgs({ type: 'string' }, { type: 'string', minLength: 1 }).length, 1);
  });
  it('cabang anyOf dihapus', () => {
    const a = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    assert.ok(msgs(a, { anyOf: [{ type: 'string' }] }).length >= 1);
  });
});

describe('diffContracts', () => {
  it('ekspor yang hilang dilaporkan dengan nama', () => {
    const v = diffContracts({ A: { type: 'string' }, B: { type: 'string' } }, { A: { type: 'string' } });
    assert.deepEqual(
      v.map((x) => x.path),
      ['B'],
    );
  });
  it('menyertakan nama ekspor pada path', () => {
    const v = diffContracts({ A: obj({ x: { type: 'string' } }) }, { A: obj({}) });
    assert.equal(v[0].path, '.x'.replace('.x', 'A.x'));
  });
});
