import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findDestructive, isMigrationFile } from '../check-additive-migrations.mjs';

describe('findDestructive', () => {
  it('menolak DROP, RENAME, dan ALTER ... DROP', () => {
    assert.equal(findDestructive('DROP TABLE a;').length, 1);
    assert.equal(findDestructive('alter table a rename to b;').length, 1);
    assert.equal(findDestructive('ALTER TABLE a DROP COLUMN c;').length, 1);
  });
  it('meloloskan migrasi aditif', () => {
    assert.deepEqual(findDestructive('CREATE TABLE a (x TEXT);\nALTER TABLE a ADD COLUMN y TEXT;'), []);
    assert.deepEqual(findDestructive('CREATE INDEX idx_dropdown ON a(x);'), []);
  });
});

describe('isMigrationFile', () => {
  it('mengenali berkas di folder migrations', () => {
    assert.equal(isMigrationFile('packages/harness/migrations/0002_x.sql'), true);
    assert.equal(isMigrationFile('packages/harness/src/db.ts'), false);
  });
});
