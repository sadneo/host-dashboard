import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateStatus } from '../lib/status.mjs';

test('collector detects clean, dirty, diverged, conflicted, and missing repositories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-test-'));
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Dashboard Test');
    git('config', 'user.email', 'test@example.invalid');
    await writeFile(join(directory, 'file'), 'base\n');
    git('add', 'file'); git('commit', '-m', 'base');
    git('branch', 'upstream'); git('branch', '--set-upstream-to=upstream');
    const config = join(directory, '.git', 'dashboard-config.json');
    await writeFile(config, JSON.stringify({ projects: [directory], configRepos: [{ name: 'missing', path: join(directory, 'absent') }] }));
    const collect = () => validateStatus(JSON.parse(execFileSync(process.execPath, ['scripts/collect-status.mjs'], {
      encoding: 'utf8', env: { ...process.env, DASHBOARD_CONFIG: config },
    })));
    let result = collect();
    assert.equal(result.projects[0].level, 'ok');
    assert.equal(result.configRepos[0].level, 'error');
    await writeFile(join(directory, 'file'), 'main\n');
    assert.equal(collect().projects[0].level, 'warning');
    git('add', 'file'); git('commit', '-m', 'main');
    assert.match(collect().projects[0].detail, /1 ahead/);
    git('checkout', 'upstream');
    await writeFile(join(directory, 'file'), 'upstream\n');
    git('add', 'file'); git('commit', '-m', 'upstream'); git('checkout', 'main');
    assert.throws(() => git('merge', 'upstream'));
    assert.equal(collect().projects[0].level, 'error');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rejects malformed remote status and invalid GPU readings', () => {
  const check = { name: 'test', detail: 'clean', level: 'ok' };
  const value = { projects: [check], configRepos: [check], zellij: check, gpus: [] };
  assert.equal(validateStatus(value), value);
  for (const invalid of [null, {}, { ...value, zellij: null }, { ...value, projects: [{ ...check, level: 'fine' }] },
    { ...value, gpus: [{ name: 'GPU', usedGiB: 1, totalGiB: 0 }] }]) {
    assert.throws(() => validateStatus(invalid), /Invalid collector JSON/);
  }
});
