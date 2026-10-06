import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateStatus, collectionCommand } from '../lib/status.mjs';
import config from '../dashboard.config.json' with { type: 'json' };

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
    await writeFile(config, JSON.stringify({
      hosts: [{ name: hostname().split('.')[0], inference: false }],
      projects: [{ name: 'test', path: join(directory, '.git') }],
      configRepos: [{ name: 'missing', path: join(directory, 'absent') },
        { name: 'dotfiles', path: join(directory, '.git'), workTree: directory }],
      llamaService: 'llama-cpp.service', llamaUserService: false, gpuSysfsPath: '/sys/class/drm',
    }));
    const collect = () => validateStatus(JSON.parse(execFileSync(process.execPath, ['scripts/collect-status.mjs'], {
      encoding: 'utf8', env: { ...process.env, DASHBOARD_CONFIG_JSON: '', DASHBOARD_CONFIG: config },
    })));
    let result = collect();
    assert.equal(result.projects[0].level, 'ok');
    assert.equal(result.configRepos[0].level, 'error');
    assert.equal(result.configRepos[1].level, 'ok');
    await writeFile(join(directory, 'file'), 'main\n');
    assert.equal(collect().projects[0].level, 'warning');
    git('add', 'file'); git('commit', '-m', 'main');
    assert.match(collect().projects[0].detail, /1 ahead/);
    git('checkout', 'upstream');
    await writeFile(join(directory, 'file'), 'upstream\n');
    git('add', 'file'); git('commit', '-m', 'upstream'); git('checkout', 'main');
    assert.throws(() => git('merge', 'upstream'));
    assert.equal(collect().projects[0].level, 'error');
    assert.equal(collect().configRepos[1].level, 'error');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('each configured host uses Node locally and SSH only for its peer', () => {
  for (const local of config.hosts) {
    for (const target of config.hosts) {
      const result = collectionCommand(target.name, `${local.name}.example`);
      assert.equal(result.command, target.name === local.name ? process.execPath : 'ssh');
      if (result.command === 'ssh') assert.equal(result.args.at(-2), target.name);
    }
  }
  assert.throws(() => collectionCommand('-oProxyCommand=bad'), /Invalid configured hostname/);
});

test('AMD sysfs counters convert bytes to GiB and ignore other vendors and connectors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-gpu-'));
  try {
    const device = join(directory, 'card0/device');
    await mkdir(device, { recursive: true });
    await mkdir(join(directory, 'card1/device'), { recursive: true });
    await mkdir(join(directory, 'card0-DP-1'));
    await writeFile(join(directory, 'card1/device/vendor'), '0x8086\n');
    await writeFile(join(device, 'vendor'), '0x1002\n');
    await writeFile(join(device, 'product_name'), 'Radeon Test\n');
    await writeFile(join(device, 'mem_info_vram_used'), `${2 ** 31}\n`);
    await writeFile(join(device, 'mem_info_vram_total'), `${8 * 2 ** 30}\n`);
    const collect = () => validateStatus(JSON.parse(execFileSync(process.execPath, ['scripts/collect-status.mjs'], {
      encoding: 'utf8', env: { ...process.env, DASHBOARD_CONFIG_JSON: JSON.stringify({ ...config,
        hosts: [{ name: hostname().split('.')[0], inference: true }], projects: [], configRepos: [], gpuSysfsPath: directory,
      }) },
    })));
    assert.deepEqual(collect().gpus, [{ name: 'Radeon Test (card0)', usedGiB: 2, totalGiB: 8 }]);
    await writeFile(join(device, 'mem_info_vram_total'), 'invalid\n');
    const invalid = collect();
    assert.deepEqual(invalid.gpus, []);
    assert.match(invalid.gpuError, /Invalid AMD VRAM/);
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
