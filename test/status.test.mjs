import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
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
    assert.equal(result.projects[0].lastCommit.subject, 'base');
    const originalConfig = JSON.parse(await readFile(config, 'utf8'));
    await writeFile(config, JSON.stringify({ ...originalConfig, staleRepoDays: 0 }));
    assert.equal(collect().projects[0].stale, true);
    await writeFile(config, JSON.stringify(originalConfig));
    const linked = join(directory, 'linked');
    git('worktree', 'add', '-b', 'feature', linked);
    await writeFile(join(linked, 'file'), 'linked change\n');
    const linkedResult = collect().projects[0].worktrees;
    assert.equal(linkedResult[0].branch, 'feature');
    assert.equal(linkedResult[0].unstaged, 1);
    assert.equal(collect().configRepos[1].worktrees.length, 1);
    git('worktree', 'remove', '--force', linked);
    await writeFile(join(directory, 'file'), 'main\n');
    const changed = collect().projects[0];
    assert.equal(changed.level, 'warning');
    assert.equal(changed.unstaged, 1);
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

test('health failures, session cwd, loaded models, and deduplicated AMD process memory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-health-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/health' ? { status: 'ok' } : { data: [
      { id: 'loaded.gguf', status: { value: 'loaded' } }, { id: 'unloaded.gguf', status: { value: 'unloaded' } },
    ] }));
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const bin = join(directory, 'bin');
    const proc = join(directory, 'proc');
    await mkdir(bin); await mkdir(join(proc, '123/fdinfo'), { recursive: true });
    await writeFile(join(proc, 'meminfo'), 'MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\n');
    await writeFile(join(proc, '123/cmdline'), '/bin/llama-server\0-m\0requested.gguf\0');
    await writeFile(join(proc, '123/comm'), 'llama-server\n');
    for (const fd of ['3', '4']) await writeFile(join(proc, `123/fdinfo/${fd}`), 'drm-driver: amdgpu\ndrm-client-id: 10\ndrm-memory-vram: 1048576 KiB\n');
    for (const [name, source] of [
      ['systemctl', `console.log(process.argv.includes('--failed') ? (process.argv.includes('--user') ? '' : 'broken.service loaded failed failed Broken') : 'LoadState=loaded\\nActiveState=active\\nSubState=running');`],
      ['zellij', `console.log(process.argv.includes('dump-layout') ? 'layout { cwd "/home/test/Projects/project" }' : 'test [Created 1h ago]');`],
    ]) {
      const path = join(bin, name);
      await writeFile(path, `#!${process.execPath}\n${source}\n`); await chmod(path, 0o755);
    }
    const { stdout } = await promisify(execFile)(process.execPath, ['scripts/collect-status.mjs'], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DASHBOARD_CONFIG_JSON: JSON.stringify({ ...config,
        hosts: [{ name: hostname().split('.')[0], inference: true }], projects: [], configRepos: [], procPath: proc,
        diskPaths: [directory], llamaUrl: `http://127.0.0.1:${server.address().port}`,
      }) },
    });
    const result = validateStatus(JSON.parse(stdout));
    assert.deepEqual(result.health.failedUnits, ['broken.service']);
    assert.equal(result.health.checks.find(check => check.name === 'RAM').detail, '4.0 / 8.0 GiB used');
    assert.deepEqual(result.zellij.directories.test.paths, ['/home/test/Projects/project']);
    assert.deepEqual(result.ai.models, ['loaded.gguf']);
    assert.equal(result.ai.processes[0].model, 'requested.gguf');
    assert.equal(result.ai.gpuProcesses[0].vramGiB, 1);
  } finally { server.close(); await rm(directory, { recursive: true, force: true }); }
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
    await writeFile(join(device, 'gpu_busy_percent'), '75\n');
    await mkdir(join(device, 'hwmon/hwmon0'), { recursive: true });
    await writeFile(join(device, 'hwmon/hwmon0/temp1_input'), '65000\n');
    const collect = () => validateStatus(JSON.parse(execFileSync(process.execPath, ['scripts/collect-status.mjs'], {
      encoding: 'utf8', env: { ...process.env, DASHBOARD_CONFIG_JSON: JSON.stringify({ ...config,
        hosts: [{ name: hostname().split('.')[0], inference: true }], projects: [], configRepos: [], gpuSysfsPath: directory,
      }) },
    })));
    assert.deepEqual(collect().gpus, [{ name: 'Radeon Test (card0)', usedGiB: 2, totalGiB: 8, utilization: 75, temperature: 65 }]);
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
    { ...value, gpus: [{ name: 'GPU', usedGiB: 1, totalGiB: 0 }] }, { ...value, gpus: [null] },
    { ...value, projects: [{ ...check, worktrees: [check] }] },
    { ...value, ai: { models: [], processes: [null], gpuProcesses: [] } }]) {
    assert.throws(() => validateStatus(invalid), /Invalid collector JSON/);
  }
});
