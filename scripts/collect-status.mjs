import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, basename, dirname } from 'node:path';

const exec = promisify(execFile);
const home = homedir();
const expand = async path => {
  const match = path.match(/^~([^/]*)(?:\/(.*))?$/);
  if (!match) return path;
  const userHome = match[1] ? (await readFile('/etc/passwd', 'utf8')).split('\n')
    .map(line => line.split(':')).find(fields => fields[0] === match[1])?.[5] : home;
  if (!userHome) throw new Error(`Unknown user in repository path: ${match[1]}`);
  return join(userHome, match[2] || '');
};
const run = async (command, args) => (await exec(command, args, {
  timeout: 2500, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1' },
})).stdout.trim();
const message = error => (error.stderr || error.message).trim();
let config;
try {
  config = JSON.parse(process.env.DASHBOARD_CONFIG_JSON || await readFile(
    process.env.DASHBOARD_CONFIG || new URL('../dashboard.config.json', import.meta.url), 'utf8'));
} catch (error) {
  console.error(`Invalid dashboard config: ${message(error)}`); process.exit(1);
}
const validRepo = repo => repo && typeof repo.name === 'string' && typeof repo.path === 'string' &&
  (repo.workTree == null || typeof repo.workTree === 'string');
if (!config || !Array.isArray(config.hosts) || !config.hosts.every(h => h && typeof h.name === 'string' && typeof h.inference === 'boolean') ||
    !Array.isArray(config.projects) || !config.projects.every(validRepo) ||
    !Array.isArray(config.configRepos) || !config.configRepos.every(validRepo) ||
    typeof config.llamaService !== 'string' || typeof config.llamaUserService !== 'boolean' || typeof config.gpuSysfsPath !== 'string') {
  console.error('Invalid dashboard config: check hosts, projects, configRepos, llamaService, llamaUserService, and gpuSysfsPath.'); process.exit(1);
}
const currentHost = config.hosts.find(host => host.name === hostname().split('.')[0]);
if (!currentHost) { console.error(`Hostname ${hostname()} is not in dashboard.config.json.`); process.exit(1); }

async function repo(path, name = basename(path), workTree) {
  try {
    path = await expand(path);
    if (!workTree && basename(path) === '.git') path = dirname(path);
    const location = workTree ? [`--git-dir=${path}`, `--work-tree=${await expand(workTree)}`] : ['-C', path];
    const [status, branch] = await Promise.all([
      run('git', [...location, 'status', '--porcelain=v1', '--branch']),
      run('git', [...location, 'rev-parse', '--abbrev-ref', 'HEAD']),
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
    const gpus = [];
    for (const card of (await readdir(config.gpuSysfsPath)).filter(name => /^card\d+$/.test(name)).sort()) {
      const device = join(config.gpuSysfsPath, card, 'device');
      let vendor;
      try { vendor = (await readFile(join(device, 'vendor'), 'utf8')).trim(); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (vendor !== '0x1002') continue;
      const [used, total] = await Promise.all(['mem_info_vram_used', 'mem_info_vram_total'].map(file => readFile(join(device, file), 'utf8')));
      const usedGiB = Number(used.trim()) / 2 ** 30;
      const totalGiB = Number(total.trim()) / 2 ** 30;
      if (!used.trim() || !total.trim() || !Number.isFinite(totalGiB) || totalGiB <= 0 || !Number.isFinite(usedGiB) || usedGiB < 0) throw new Error(`Invalid AMD VRAM readings for ${card}.`);
      let name = `AMD GPU (${card})`;
      try { name = `${(await readFile(join(device, 'product_name'), 'utf8')).trim()} (${card})`; } catch {}
      gpus.push({ name, usedGiB, totalGiB });
    }
    return { gpus, ...(gpus.length ? {} : { gpuError: 'No AMD GPU with VRAM counters found in sysfs.' }) };
  } catch (error) { return { gpus: [], gpuError: message(error) }; }
}

const [projectChecks, configRepos, sessions, llamaStatus, gpuStatus] = await Promise.all([
  config.projects.length ? Promise.all(config.projects.map(r => repo(r.path, r.name, r.workTree))) : [{ name: 'Projects', level: 'warning', detail: 'No project repositories configured.' }],
  Promise.all(config.configRepos.map(r => repo(r.path, r.name, r.workTree))),
  zellij(), currentHost.inference ? llama() : null, currentHost.inference ? gpu() : { gpus: [] },
]);
console.log(JSON.stringify({ projects: projectChecks, configRepos, zellij: sessions, llama: llamaStatus, ...gpuStatus }));
