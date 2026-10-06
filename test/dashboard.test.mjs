import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, shortenPath, summarize } from '../lib/dashboard.mjs';

test('summary counts dirty worktrees and failed units and names ahead repos', () => {
  const hosts = [{ host: 'local', online: true, projects: [{ name: 'project', level: 'ok', dirty: 0,
    worktrees: [{ name: 'feature', level: 'warning', dirty: 1 }] }],
    configRepos: [{ name: 'nixos', level: 'warning', dirty: 1, ahead: 2, behind: 0 }],
    zellij: { level: 'ok' }, health: { checks: [], failedUnits: ['broken.service'] }, gpus: [],
  }];
  const result = summarize(hosts, { hosts: [{ name: 'local', inference: false }], staleRepoDays: 30 });
  assert(result.some(item => item.name === '2 dirty repos'));
  assert(result.some(item => item.name === '1 failed unit' && item.level === 'error'));
  assert(result.some(item => item.name === 'local / nixos' && item.detail.includes('2 ahead')));
  assert.equal(summarize([{ host: 'offline', online: false, error: 'timeout' }], { hosts: [] })[0].level, 'error');
});

test('paths shorten fish-style while preserving the final directory', () => {
  assert.equal(shortenPath('/etc/nixos', 8), '/e/nixos');
  assert.equal(shortenPath('~/Projects/comfy-room/worktrees/feature3', 18), '~/P/c/w/feature3');
  assert.equal(shortenPath('~/Projects'), '~/Projects');
  assert.equal(age(90000), '1d ago');
  assert.equal(age(10), 'just now');
});
