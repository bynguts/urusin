import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCommitMessage,
  hasAiAttribution,
  isBannedSubject,
  stripGitComments,
} from '../lib/commit-rules.mjs';
import { auditCommits, parseLog } from '../audit-history.mjs';

describe('checkCommitMessage', () => {
  it('meloloskan header konvensional yang bermakna', () => {
    assert.deepEqual(checkCommitMessage('feat(core): add step dsl validator'), []);
    assert.deepEqual(checkCommitMessage('chore: init pnpm workspace with turborepo'), []);
  });
  it('menolak header non-konvensional', () => {
    assert.equal(checkCommitMessage('add stuff').length, 1);
    assert.equal(checkCommitMessage('feature: add x').length, 1);
    assert.equal(checkCommitMessage('feat(Core) add x').length, 1);
    assert.deepEqual(checkCommitMessage('feat(web)!: drop next.js'), []);
  });
  it('menolak subjek tidak bermakna', () => {
    for (const s of ['update', 'test', 'final', 'wip', 'WIP', 'update.']) {
      assert.equal(checkCommitMessage(`chore: ${s}`).length, 1, s);
    }
    assert.equal(isBannedSubject('update readme sections'), false);
  });
  it('menolak trailer co-author dan atribusi AI', () => {
    const msg = ['feat: add x', '', 'Co-Authored-By: Someone <x>'].join('\n');
    assert.equal(checkCommitMessage(msg).length, 1);
    assert.equal(hasAiAttribution('co-authored-by: a'), true);
    assert.equal(hasAiAttribution('Generated with [Claude Code](https://x)'), true);
  });
});

describe('stripGitComments', () => {
  it('membuang komentar dan diff verbose', () => {
    const raw =
      'feat: x\n# komentar\nbody\n# ------------------------ >8 ------------------------\nCo-Authored-By: diff';
    assert.equal(stripGitComments(raw), 'feat: x\nbody');
  });
});

describe('audit-history', () => {
  const FS = '\x1f';
  const RS = '\x1e';
  const rec = (h, e, m) => `${h}${FS}${e}${FS}nama${FS}${m}${RS}\n`;

  it('mengurai log git', () => {
    const commits = parseLog(
      rec('a1', 'A@EXAMPLE.COM', 'feat: add a\n') + rec('b2', 'b@example.com', 'docs: add readme'),
    );
    assert.equal(commits.length, 2);
    assert.equal(commits[0]?.email, 'a@example.com');
    assert.equal(commits[1]?.message, 'docs: add readme');
  });
  it('melaporkan author asing, prefix salah, dan trailer', () => {
    const commits = parseLog(
      rec('a1', 'a@example.com', 'feat: add a') +
        rec('b2', 'bot@example.com', 'chore: bump deps') +
        rec('c3', 'a@example.com', 'final') +
        rec('d4', 'a@example.com', 'fix: y\n\nCo-Authored-By: z'),
    );
    const v = auditCommits(commits, ['a@example.com']);
    assert.deepEqual(
      v.map((x) => x.hash),
      ['b2', 'c3', 'd4'],
    );
  });
});
