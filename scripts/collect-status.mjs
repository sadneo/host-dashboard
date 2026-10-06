import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, basename } from 'node:path';

const exec = promisify(execFile);
const home = homedir();
const expand = path => path.startsWith('~/') ? join(home, path.slice(2)) : path;
const run = async (command, args) => (await exec(command, args, {
  timeout: 2500, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1' },
})).stdout.trim();
const message = error => (error.stderr || error.message).trim();
let config = {};
try {
  config = JSON.parse(await readFile(process.env.DASHBOARD_CONFIG || join(home, '.config/dashboard.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') { console.error(`Invalid dashboard config: ${message(error)}`); process.exit(1); }
}
if ((config.projects != null && (!Array.isArray(config.projects) || !config.projects.every(p => typeof p === 'string'))) ||
    (config.projectRoot != null && typeof config.projectRoot !== 'string') ||
    (config.configRepos != null && (!Array.isArray(config.configRepos) || !config.configRepos.every(r => r && typeof r.name === 'string' && typeof r.path === 'string'))) ||
    (config.llamaService != null && typeof config.llamaService !== 'string')) {
  console.error('Invalid dashboard config: check projects, projectRoot, configRepos, and llamaService.'); process.exit(1);
}

async function repo(path, name = basename(path)) {
  try {
    path = expand(path);
    const [status, branch] = await Promise.all([
      run('git', ['-C', path, 'status', '--porcelain=v1', '--branch']),
      run('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']),
    ]);
    const lines = status.split('\n');
    const header = lines.shift();
    const dirty = lines.filter(Boolean).length;
    const ahead = Number(header.match(/ahead (\d+)/)?.[1] || 0);
    const behind = Number(header.match(/behind (\d+)/)?.[1] || 0);
    const conflict = lines.some(line => /^(DD|AU|UD|UA|DU|AA|UU) /.test(line));
    const upstream = header.includes('...') ? `${ahead} ahead · ${behind} behind` : 'no upstream';
    return { name, level: conflict ? 'error' : dirty || ahead || behind || !header.includes('...') ? 'warning' : 'ok',
      detail: `${branch} · ${dirty ? `${dirty} changed` : 'clean'} · ${upstream}${conflict ? ' · merge conflicts' : ''}` };
  } catch (error) { return { name, level: 'error', detail: message(error) }; }
}

async function projects() {
  if (config.projects) return config.projects.length ? Promise.all(config.projects.map(p => repo(p))) : [{ name: 'Projects', level: 'warning', detail: 'No project repositories configured.' }];
  const root = expand(config.projectRoot || '~/Projects');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const paths = [];
    for (const entry of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(root, entry.name);
      try {
        const top = await run('git', ['-C', path, 'rev-parse', '--show-toplevel']);
        if (top === path) paths.push(path);
      } catch {}
    }
    return paths.length ? Promise.all(paths.map(p => repo(p))) : [{ name: 'Projects', level: 'warning', detail: `No repositories in ${root}. Set projects in ~/.config/dashboard.json.` }];
  } catch (error) { return [{ name: 'Projects', level: 'error', detail: message(error) }]; }
}

async function zellij() {
  try {
    const output = (await run('zellij', ['list-sessions', '--no-formatting'])).replace(/\x1b\[[0-9;]*m/g, '');
    return { name: 'zellij ls', level: output ? 'ok' : 'warning', detail: output || 'No active sessions.' };
  } catch (error) {
    const detail = message(error);
    return { name: 'zellij ls', level: /no (active )?sessions/i.test(detail) ? 'warning' : 'error', detail };
  }
}

async function llama() {
  const service = config.llamaService || 'llama-cpp.service';
  try {
    const output = await run('systemctl', [ ...(config.llamaUserService ? ['--user'] : []), 'show', service, '--property=LoadState,ActiveState,SubState']);
    const properties = Object.fromEntries(output.split('\n').map(line => line.split('=')));
    const active = properties.LoadState === 'loaded' && properties.ActiveState === 'active';
    return { name: service, level: active ? 'ok' : 'error', detail: `${properties.LoadState} · ${properties.ActiveState} / ${properties.SubState}` };
  } catch (error) { return { name: service, level: 'error', detail: message(error) }; }
}

async function gpu() {
  try {
    const output = await run('nvidia-smi', ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits']);
    const gpus = output.split('\n').filter(Boolean).map(line => {
      const parts = line.split(',');
      const totalGiB = Number(parts.pop().trim()) / 1024;
      const usedGiB = Number(parts.pop().trim()) / 1024;
      if (!Number.isFinite(totalGiB) || totalGiB <= 0 || !Number.isFinite(usedGiB) || usedGiB < 0) throw new Error('Invalid nvidia-smi VRAM readings.');
      return { name: parts.join(',').trim(), usedGiB, totalGiB };
    });
    return { gpus };
  } catch (error) { return { gpus: [], gpuError: message(error) }; }
}

const babel = hostname().split('.')[0] === 'babel' || config.babel === true;
const [projectChecks, configRepos, sessions, llamaStatus, gpuStatus] = await Promise.all([
  projects(),
  Promise.all((config.configRepos || [{ name: 'dot', path: '~/dot' }, { name: 'nixos', path: '~/nixos' }]).map(r => repo(r.path, r.name))),
  zellij(), babel ? llama() : null, babel ? gpu() : { gpus: [] },
]);
console.log(JSON.stringify({ projects: projectChecks, configRepos, zellij: sessions, llama: llamaStatus, ...gpuStatus }));
