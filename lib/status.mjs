import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const hosts = ['babel', 'waka'];

export function validateStatus(value) {
  const levels = ['ok', 'warning', 'error'];
  const check = (item) => item && typeof item.name === 'string' && typeof item.detail === 'string' && levels.includes(item.level);
  if (!value || !Array.isArray(value.projects) || !value.projects.every(check) ||
      !Array.isArray(value.configRepos) || !value.configRepos.every(check) || !check(value.zellij) ||
      (value.llama != null && !check(value.llama)) ||
      !Array.isArray(value.gpus) || !value.gpus.every(g => typeof g.name === 'string' &&
        Number.isFinite(g.usedGiB) && Number.isFinite(g.totalGiB) && g.usedGiB >= 0 && g.totalGiB > 0)) {
    throw new Error('Invalid collector JSON; update the host collector.');
  }
  return value;
}

export async function collectHost(host) {
  try {
    const script = await readFile(new URL('../scripts/collect-status.mjs', import.meta.url), 'utf8');
    const { stdout } = await new Promise((resolve, reject) => {
      const child = execFile('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3',
        '-o', 'ConnectionAttempts=1', host, 'node --input-type=module'],
      { timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve({ stdout });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(script);
    });
    return { host, ...validateStatus(JSON.parse(stdout)), online: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { host, online: false, error: error.message, checkedAt: new Date().toISOString() };
  }
}

export async function snapshot() {
  return { hosts: await Promise.all(hosts.map(collectHost)), updatedAt: new Date().toISOString() };
}
