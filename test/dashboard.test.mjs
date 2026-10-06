import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, shortenPath, summarize, llamaState } from '../lib/dashboard.mjs';

test('summary counts dirty worktrees and failed units and names ahead repos', () => {
  const hosts = [{ host: 'local', online: true, projects: [{ name: 'project', level: 'ok', dirty: 0,
    worktrees: [{ name: 'feature', level: 'warning', dirty: 1 }] }],
    configRepos: [{ name: 'nixos', level: 'warning', dirty: 1, ahead: 2, behind: 0 }],
    zellij: { level: 'ok' }, health: { checks: [], failedUnits: ['broken.service'] }, gpus: [],
  }];
  const result = summarize(hosts, { hosts: [{ name: 'local', inference: false }], configRepos: [{ name: 'nixos', nixos: true }], staleRepoDays: 30 });
  assert(result.some(item => item.name === '2 dirty repos'));
  assert(result.some(item => item.name === '1 failed unit' && item.level === 'error'));
  assert(result.some(item => item.name === 'local / nixos' && item.detail.includes('2 ahead')));
  assert(summarize([{ host: 'offline', online: false, error: 'timeout' }], { hosts: [] }).some(item => item.level === 'error' && item.detail === 'offline'));
});

test('summary ignores optional diagnostics and distinguishes an absent service from an inactive expected service', () => {
  const host = { host: 'local', online: true, projects: [], configRepos: [], gpus: [], gpuError: 'No AMD counters',
    zellij: { level: 'ok' }, ai: { models: [], processes: [], modelError: 'fetch failed', memoryError: 'permission denied' },
    health: { checks: [{ name: 'RAM', level: 'warning', detail: 'permission denied' }, { name: 'NixOS', level: 'warning', detail: 'ENOENT' }], failedUnits: [] },
    llama: { name: 'llama-cpp.service', level: 'error', detail: 'not-found · inactive / dead' },
  };
  const configuration = { hosts: [{ name: 'local', inference: true }] };
  assert.deepEqual(summarize([host], configuration), [{ name: '1 host online', detail: '', level: 'ok' }]);
  assert.equal(llamaState(host).level, 'info');
  host.llama.detail = 'loaded · inactive / dead';
  assert.equal(summarize([host], configuration)[1].detail, 'inactive');
  host.ai.processes = [{ pid: 1 }];
  assert.equal(llamaState(host).level, 'ok');
});

test('summary caps visible rows at four and retains overflow behind a disclosure', () => {
  const hosts = Array.from({ length: 8 }, (_, i) => ({ host: `host${i}`, online: false, error: 'raw debug error' }));
  const result = summarize(hosts, { hosts: [] });
  assert.equal(result.length, 4);
  assert.equal(result.at(-1).more.length, 6);
  assert(result.slice(1, 3).every(item => item.detail === 'offline'));
  assert(result.at(-1).more.every(item => item.detail === 'offline'));
});

test('dirty counts do not crowd out three actionable problems', () => {
  const host = { host: 'local', online: true,
    projects: [{ name: 'broken', level: 'error', detail: 'fatal: raw error' }, { name: 'behind', level: 'warning', dirty: 1, behind: 5 }],
    configRepos: [], health: { checks: [], failedUnits: [] }, gpus: [], zellij: { level: 'ok' },
    llama: { name: 'llama-cpp.service', level: 'error', detail: 'loaded · inactive / dead' },
  };
  const result = summarize([host], { hosts: [{ name: 'local', inference: true }] });
  assert.equal(result.length, 4);
  assert(result.some(item => item.detail === '5 commits behind'));
  assert(!result.some(item => item.more || item.name.includes('dirty')));
});

test('paths shorten fish-style while preserving the final directory', () => {
  assert.equal(shortenPath('/etc/nixos', 8), '/e/nixos');
  assert.equal(shortenPath('~/Projects/comfy-room/worktrees/feature3', 18), '~/P/c/w/feature3');
  assert.equal(shortenPath('~/Projects'), '~/Projects');
  assert.equal(age(90000), '1d ago');
  assert.equal(age(10), 'just now');
});
