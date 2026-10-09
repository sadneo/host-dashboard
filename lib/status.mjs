import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import config from '../dashboard.config.json' with { type: 'json' };

export const hosts = config.hosts.map(host => host.name);

export function collectionCommand(host, currentHostname = hostname()) {
  if (!hosts.includes(host) || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw new Error('Invalid configured hostname.');
  return host === currentHostname.split('.')[0]
    ? { command: process.execPath, args: ['--input-type=module'] }
    : { command: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3',
      '-o', 'ConnectionAttempts=1', host, 'node --input-type=module'] };
}

export function validateStatus(value) {
  const levels = ['ok', 'warning', 'error'];
  const check = (item) => item && typeof item.name === 'string' && typeof item.detail === 'string' && levels.includes(item.level);
  const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  const repo = item => check(item) && (item.worktrees == null || Array.isArray(item.worktrees) && item.worktrees.every(tree => repo(tree) && typeof tree.path === 'string')) &&
    (item.changes == null || Array.isArray(item.changes) && item.changes.every(c => c && typeof c.path === 'string' && typeof c.status === 'string')) &&
    (item.lastCommit == null || typeof item.lastCommit.hash === 'string' && typeof item.lastCommit.subject === 'string' && Number.isFinite(item.lastCommit.ageSeconds)) &&
    ['dirty', 'ahead', 'behind', 'staged', 'unstaged', 'untracked'].every(key => item[key] == null || Number.isInteger(item[key]) && item[key] >= 0) &&
    (item.path == null || typeof item.path === 'string') &&
    (item.history == null || strings(item.history)) &&
    (item.recent == null || Array.isArray(item.recent) && item.recent.every(c => typeof c.hash === 'string' && typeof c.subject === 'string' && Number.isFinite(c.ageSeconds)));
  if (!value || !Array.isArray(value.projects) || !value.projects.every(repo) ||
      !Array.isArray(value.configRepos) || !value.configRepos.every(repo) || !check(value.zellij) ||
      (value.zellij.directories != null && (typeof value.zellij.directories !== 'object' ||
        !Object.values(value.zellij.directories).every(entry => entry && strings(entry.paths)))) ||
      (value.health != null && (!Array.isArray(value.health.checks) || !value.health.checks.every(check) || !strings(value.health.failedUnits) ||
        (value.health.nixos != null && (!Number.isFinite(value.health.nixos.ageSeconds) ||
          (value.health.nixos.deployedRevision != null && typeof value.health.nixos.deployedRevision !== 'string'))))) ||
      (value.ai != null && (!strings(value.ai.models) || !Array.isArray(value.ai.processes) ||
        !value.ai.processes.every(p => p && Number.isInteger(p.pid) && typeof p.name === 'string' && (p.model == null || typeof p.model === 'string')) ||
        !Array.isArray(value.ai.gpuProcesses) || !value.ai.gpuProcesses.every(p => p && Number.isInteger(p.pid) && typeof p.name === 'string' && Number.isFinite(p.vramGiB) && p.vramGiB >= 0) ||
        ['modelError', 'memoryError'].some(key => value.ai[key] != null && typeof value.ai[key] !== 'string'))) ||
      (value.llama != null && !check(value.llama)) ||
      (value.services != null && (!Array.isArray(value.services) || !value.services.every(s => s && typeof s.name === 'string' && typeof s.raw === 'string' &&
        s.properties && Object.values(s.properties).every(v => typeof v === 'string') && ['healthy', 'degraded', 'failed', 'stopped'].includes(s.state) &&
        ['process', 'listening', 'http', 'backend'].every(key => s[key] == null || typeof s[key] === 'boolean')))) ||
      !Array.isArray(value.gpus) || !value.gpus.every(g => g && typeof g.name === 'string' &&
        Number.isFinite(g.usedGiB) && Number.isFinite(g.totalGiB) && g.usedGiB >= 0 && g.totalGiB > 0 &&
        (g.utilization == null || Number.isFinite(g.utilization)) && (g.temperature == null || Number.isFinite(g.temperature)))) {
    throw new Error('Invalid collector JSON; update the host collector.');
  }
  return value;
}

export async function collectHost(host) {
  try {
    const script = await readFile(/* turbopackIgnore: true */ process.env.DASHBOARD_COLLECTOR || new URL('../scripts/collect-status.mjs', import.meta.url), 'utf8');
    const { command, args } = collectionCommand(host);
    const { stdout } = await new Promise((resolve, reject) => {
      const child = execFile(command, args,
      { timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve({ stdout });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(`process.env.DASHBOARD_CONFIG_JSON = ${JSON.stringify(JSON.stringify(config))};\n${script}`);
    });
    return { ...validateStatus(JSON.parse(stdout)), host, local: command === process.execPath, online: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { host, online: false, error: error.message, checkedAt: new Date().toISOString() };
  }
}

export async function snapshot() {
  return { hosts: await Promise.all(hosts.map(collectHost)), updatedAt: new Date().toISOString() };
}
