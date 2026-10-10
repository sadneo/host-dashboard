import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, readlink, statfs, lstat } from 'node:fs/promises';
import { homedir, hostname, uptime, loadavg, cpus } from 'node:os';
import { join, basename, dirname, isAbsolute, resolve } from 'node:path';
import { createConnection } from 'node:net';

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
  timeout: 2500, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1', GIT_OPTIONAL_LOCKS: '0' },
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
config = { procPath: '/proc', diskPaths: ['/'], staleRepoDays: 30, zellijCachePath: '~/.cache/zellij', ...config, ...currentHost };
const validUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
if (!Array.isArray(config.diskPaths) || !config.diskPaths.every(p => typeof p === 'string') ||
    !Number.isFinite(config.staleRepoDays) || config.staleRepoDays < 0 || typeof config.procPath !== 'string' ||
    typeof config.zellijCachePath !== 'string' || (config.llamaUrl != null && !validUrl(config.llamaUrl)) ||
    (config.services != null && (!Array.isArray(config.services) || !config.services.every(s => s && typeof s.name === 'string' && typeof s.unit === 'string' &&
      (s.url ? validUrl(s.url) : Number.isInteger(s.port) && s.port > 0 && s.port <= 65535))))) {
  console.error('Invalid health/AI settings in dashboard.config.json.'); process.exit(1);
}
const optionalRead = async path => { try { return (await readFile(path, 'utf8')).trim(); } catch { return null; } };
const displayPath = path => path === home ? '~' : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;

async function repoState(location, name) {
  const [status, branch, log, history, recent, upstream] = await Promise.all([
    run('git', [...location, 'status', '--porcelain=v1', '--branch']),
    run('git', [...location, 'rev-parse', '--abbrev-ref', 'HEAD']),
    run('git', [...location, 'log', '-1', '--format=%H%x00%ct%x00%s']),
    run('git', [...location, 'rev-list', '--max-count=2000', 'HEAD']),
    run('git', [...location, 'log', '--since=7.days', '--max-count=50', '--format=%H%x00%ct%x00%s']),
    run('git', [...location, 'rev-parse', '--symbolic-full-name', '@{upstream}']).catch(() => ''),
  ]);
  const [header, ...lines] = status.split('\n');
  const changes = lines.filter(Boolean).map(line => ({ status: line.slice(0, 2), path: line.slice(3) }));
  const dirty = changes.length;
  const ahead = Number(header.match(/ahead (\d+)/)?.[1] || 0);
  const behind = Number(header.match(/behind (\d+)/)?.[1] || 0);
  const conflict = changes.some(change => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(change.status));
  const hasUpstream = header.includes('...');
  const [hash, timestamp, subject] = log.split('\0');
  const ageSeconds = Math.max(0, Date.now() / 1000 - Number(timestamp));
  const stale = !dirty && ageSeconds >= config.staleRepoDays * 86400;
  // ponytail: ancestry is capped at 2000 commits; report unknown rather than infer divergence beyond that window.
  return { name, branch, dirty, ahead, behind, hasUpstream, changes, upstream: upstream.replace(/^refs\/remotes\//, ''),
    history: history.split('\n'), recent: recent ? recent.split('\n').map(line => { const [hash, time, subject] = line.split('\0'); return { hash, subject, ageSeconds: Math.max(0, Date.now() / 1000 - Number(time)) }; }) : [],
    staged: changes.filter(c => ![' ', '?'].includes(c.status[0])).length,
    unstaged: changes.filter(c => ![' ', '?'].includes(c.status[1])).length,
    untracked: changes.filter(c => c.status === '??').length,
    lastCommit: { hash, subject, ageSeconds }, stale,
    level: conflict ? 'error' : dirty || ahead || behind || !hasUpstream || stale ? 'warning' : 'ok',
    detail: `${branch} · ${dirty ? `${dirty} changed` : 'clean'} · ${hasUpstream ? `${ahead} ahead · ${behind} behind` : 'no upstream'}${conflict ? ' · merge conflicts' : ''}` };
}

async function repo(path, name = basename(path), workTree) {
  try {
    path = await expand(path);
    if (!workTree && basename(path) === '.git') path = dirname(path);
    const location = workTree ? [`--git-dir=${path}`, `--work-tree=${await expand(workTree)}`] : ['-C', path];
    const state = await repoState(location, name);
    const root = workTree ? await expand(workTree) : await run('git', [...location, 'rev-parse', '--show-toplevel']);
    try {
      const list = await run('git', [...location, 'worktree', 'list', '--porcelain', '-z']);
      const records = list.split('\0\0').map(record => record.split('\0'));
      state.worktrees = await Promise.all(records.filter(fields => {
        const worktree = fields.find(field => field.startsWith('worktree '))?.slice(9);
        return worktree && worktree !== root && worktree !== path;
      }).map(async fields => {
        const worktree = fields.find(field => field.startsWith('worktree ')).slice(9);
        const prunable = fields.find(field => field.startsWith('prunable'));
        if (prunable) return { name: basename(worktree), path: displayPath(worktree), level: 'warning', detail: prunable, prunable: true };
        try { return { ...await repoState(['-C', worktree], basename(worktree)), path: displayPath(worktree) }; }
        catch (error) { return { name: basename(worktree), path: displayPath(worktree), level: 'error', detail: message(error) }; }
      }));
    } catch (error) { state.worktrees = []; state.worktreeError = message(error); }
    return { ...state, path: displayPath(root) };
  } catch (error) { return { name, level: 'error', detail: message(error) }; }
}

async function zellij() {
  try {
    const output = (await run('zellij', ['list-sessions', '--no-formatting'])).replace(/\x1b\[[0-9;]*m/g, '');
    const directories = {};
    await Promise.all(output.split('\n').filter(Boolean).map(async line => {
      const name = line.match(/^(.+?)\s+\[Created /)?.[1];
      if (!name) return;
      try {
        let layout;
        if (line.includes('(EXITED')) {
          const cache = await expand(config.zellijCachePath);
          for (const version of await readdir(cache)) {
            layout = await optionalRead(join(cache, version, 'session_info', name, 'session-layout.kdl'));
            if (layout) break;
          }
        } else { layout = await run('zellij', ['--session', name, 'action', 'dump-layout']); }
        // ponytail: extract only quoted cwd properties, use a KDL parser if layouts adopt raw-string paths.
        const paths = [...(layout || '').matchAll(/\bcwd(?:=|\s+)("(?:\\.|[^"\\])*")/g)].map(match => JSON.parse(match[1]));
        const base = paths.find(isAbsolute) || home;
        directories[name] = { paths: [...new Set(paths.map(path => displayPath(isAbsolute(path) ? path : resolve(base, path))))], saved: line.includes('(EXITED') };
      } catch (error) { directories[name] = { paths: [], error: message(error) }; }
    }));
    return { name: 'zellij ls', level: output ? 'ok' : 'warning', detail: output || 'No active sessions.', directories };
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

async function health() {
  const checks = [];
  const hours = Math.floor(uptime() / 3600);
  const loads = loadavg();
  checks.push({ name: 'Uptime / load', level: loads[0] > cpus().length ? 'warning' : 'ok',
    detail: `${Math.floor(hours / 24)}d ${hours % 24}h ${Math.floor(uptime() / 60) % 60}m · ${loads.map(n => n.toFixed(2)).join(' / ')} · ${cpus().length} CPUs` });
  try {
    const memory = await readFile(join(config.procPath, 'meminfo'), 'utf8');
    const total = Number(memory.match(/^MemTotal:\s+(\d+)/m)?.[1]) * 1024;
    const available = Number(memory.match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
    if (!(total > 0) || !Number.isFinite(available)) throw new Error('RAM counters unavailable.');
    checks.push({ name: 'RAM', level: (total - available) / total >= .85 ? 'warning' : 'ok',
      detail: `${((total - available) / 2 ** 30).toFixed(1)} / ${(total / 2 ** 30).toFixed(1)} GiB used` });
  } catch (error) { checks.push({ name: 'RAM', level: 'warning', detail: message(error) }); }
  await Promise.all(config.diskPaths.map(async path => {
    try {
      const stats = await statfs(await expand(path));
      const total = stats.blocks * stats.bsize;
      const used = (stats.blocks - stats.bfree) * stats.bsize;
      const available = stats.bavail * stats.bsize;
      checks.push({ name: `Disk ${path}`, level: used / (used + available) >= .85 ? 'warning' : 'ok',
        detail: `${(used / 2 ** 30).toFixed(1)} / ${(total / 2 ** 30).toFixed(1)} GiB · ${(available / 2 ** 30).toFixed(1)} GiB available` });
    } catch (error) { checks.push({ name: `Disk ${path}`, level: 'warning', detail: message(error) }); }
  }));
  const failedUnits = [];
  for (const user of [false, true]) {
    try {
      const output = await run('systemctl', [...(user ? ['--user'] : []), '--failed', '--no-legend', '--plain', '--no-pager']);
      const units = output.split('\n').filter(Boolean).map(line => `${line.trim().split(/\s+/)[0]}${user ? ' (user)' : ''}`);
      failedUnits.push(...units);
      checks.push({ name: user ? 'User units' : 'System units', level: units.length ? 'error' : 'ok', detail: units.length ? units.join(', ') : 'No failed units.' });
    } catch (error) { checks.push({ name: user ? 'User units' : 'System units', level: 'warning', detail: message(error) }); }
  }
  try {
    const profile = await readlink('/nix/var/nix/profiles/system');
    const generation = profile.match(/system-(\d+)-link/)?.[1];
    const version = await readFile('/run/current-system/nixos-version', 'utf8');
    const running = await readlink('/run/current-system');
    const ageSeconds = Math.max(0, (Date.now() - (await lstat(join('/nix/var/nix/profiles', profile))).mtimeMs) / 1000);
    const deployedRevision = await optionalRead('/run/current-system/configuration-revision');
    checks.push({ name: 'NixOS', level: 'ok', detail: `profile gen ${generation || '?'} · ${version.trim()}`, generationAgeSeconds: ageSeconds });
    const systemName = basename(running).slice(33), prefix = `nixos-system-${hostname()}-`, suffix = `-${version.trim().match(/\d{2}\.\d{2}.*$/)?.[0]}`;
    const tag = systemName === `nixos-system-${hostname()}${suffix}` ? 'default' : systemName.startsWith(prefix) && systemName.endsWith(suffix) ? systemName.slice(prefix.length, -suffix.length) : '';
    const specialization = await optionalRead('/etc/specialisation') || await optionalRead('/run/current-system/specialisation-name') || tag || (await optionalRead('/proc/cmdline'))?.match(/(?:specialisation|specialization)=([^ ]+)/)?.[1] || 'unknown';
    return { checks, failedUnits, nixos: { generation, ageSeconds, version: version.trim(), running, deployedRevision, specialization } };
  } catch (error) { checks.push({ name: 'NixOS', level: 'warning', detail: message(error) }); }
  return { checks, failedUnits };
}

async function ai() {
  const processes = [];
  const gpuProcesses = [];
  let memoryError;
  try {
    await Promise.all((await readdir(config.procPath)).filter(pid => /^\d+$/.test(pid)).map(async pid => {
      const base = join(config.procPath, pid);
      const command = await optionalRead(join(base, 'cmdline'));
      if (!command) return;
      const args = command.split('\0').filter(Boolean);
      const name = await optionalRead(join(base, 'comm')) || basename(args[0]).split(/\s+/)[0];
      const executable = basename(args[0]).split(/\s+/)[0].replace(/^\./, '').replace(/-wrapped$/, '');
      if (/^(llama-(?:server|cli|run|bench|simple)|llama\.cpp|main)$/.test(executable)) {
        const modelIndex = args.findIndex(arg => ['-m', '--model', '-hf', '--hf-repo'].includes(arg));
        const model = modelIndex >= 0 ? args[modelIndex + 1] : args.find(arg => arg.startsWith('--model='))?.slice(8);
        processes.push({ pid: Number(pid), name, model: model || null });
      }
      try {
        const clients = new Map();
        for (const fd of await readdir(join(base, 'fdinfo'))) {
          const info = await optionalRead(join(base, 'fdinfo', fd));
          if (!info || !/^drm-driver:\s*amdgpu/m.test(info)) continue;
          const id = info.match(/^drm-client-id:\s*(\d+)/m)?.[1];
          const memory = info.match(/^drm-(?:memory|total)-vram:\s*(\d+)\s*(KiB|kB|bytes|B)/m);
          if (id && memory) clients.set(id, Number(memory[1]) * (['KiB', 'kB'].includes(memory[2]) ? 1024 : 1));
        }
        if (clients.size) gpuProcesses.push({ pid: Number(pid), name, vramGiB: [...clients.values()].reduce((sum, bytes) => sum + bytes, 0) / 2 ** 30 });
      } catch (error) { if (error.code === 'EACCES' || error.code === 'EPERM') memoryError = 'Some process VRAM counters are not readable by this account.'; }
    }));
  } catch (error) { memoryError = message(error); }
  const models = [];
  let modelError = 'Set llamaUrl to query the loaded model.';
  if (config.llamaUrl) {
    try {
      const [ready, response] = await Promise.all(['health', 'v1/models'].map(path => fetch(
        new URL(path, `${config.llamaUrl.replace(/\/$/, '')}/`), { signal: AbortSignal.timeout(1000) })));
      if (!ready.ok || !response.ok) throw new Error(`llama.cpp is not ready (HTTP ${ready.status}/${response.status}).`);
      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error('Invalid llama.cpp model response.');
      for (const model of body.data) {
        const state = typeof model.status === 'string' ? model.status : model.status?.value;
        if (typeof model.id === 'string' && (!state || state === 'loaded')) models.push(model.id);
      }
      modelError = models.length ? null : 'No loaded models reported.';
    } catch (error) { modelError = message(error); }
  }
  return { processes: processes.sort((a, b) => a.pid - b.pid), models, modelError,
    gpuProcesses: gpuProcesses.sort((a, b) => b.vramGiB - a.vramGiB), memoryError: memoryError || (gpuProcesses.length ? null : 'No readable AMD process VRAM counters (ROCm/DRM).') };
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
      const busy = await optionalRead(join(device, 'gpu_busy_percent'));
      const utilization = busy != null && Number.isFinite(Number(busy)) ? Number(busy) : null;
      let temperature = null;
      try {
        const hwmon = (await readdir(join(device, 'hwmon'))).find(name => /^hwmon\d+$/.test(name));
        const input = hwmon ? await optionalRead(join(device, 'hwmon', hwmon, 'temp1_input')) : null;
        if (input != null && Number.isFinite(Number(input))) temperature = Number(input) / 1000;
      } catch {}
      gpus.push({ name, usedGiB, totalGiB, utilization, temperature });
    }
    return { gpus, ...(gpus.length ? {} : { gpuError: 'No AMD GPU with VRAM counters found in sysfs.' }) };
  } catch (error) { return { gpus: [], gpuError: message(error) }; }
}

const tcp = (host, port) => new Promise(resolve => {
  const socket = createConnection({ host, port });
  const finish = ok => { socket.destroy(); resolve(ok); };
  socket.setTimeout(1000); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
});
async function services() {
  const listeners = await run('ss', ['-ltnp']).catch(message);
  return Promise.all((config.services || []).map(async service => {
    const raw = await run('systemctl', [...(service.user ? ['--user'] : []), 'show', service.unit, '--property=LoadState,ActiveState,SubState,MainPID,NRestarts,Result,ExecMainStatus']).catch(message);
    const properties = Object.fromEntries(raw.split('\n').filter(line => line.includes('=')).map(line => line.split('=')));
    const url = service.url ? new URL(service.url) : null;
    const port = Number(url?.port || (url ? url.protocol === 'https:' ? 443 : 80 : service.port));
    const listening = await tcp(url?.hostname || '127.0.0.1', port);
    let http = null, httpDetail = 'No HTTP endpoint configured';
    if (url) try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); http = response.ok; httpDetail = `HTTP ${response.status}`; await response.body?.cancel(); } catch (error) { http = false; httpDetail = message(error); }
    let backend = null;
    if (service.backend) try { const response = await fetch(`${config.llamaUrl}/health`, { signal: AbortSignal.timeout(1000) }); backend = response.ok; await response.body?.cancel(); } catch { backend = false; }
    const listener = listeners.split('\n').filter(line => line.match(new RegExp(`:${port}\\b`))).join('\n');
    const process = properties.ActiveState === 'active' || Number(properties.MainPID) > 0 || /pid=\d+/.test(listener) ? true : properties.LoadState === 'loaded' ? false : null;
    const state = properties.ActiveState === 'failed' ? 'failed' : !process && !listening ? 'stopped' : !listening || http === false || backend === false ? 'degraded' : 'healthy';
    const journal = await run('journalctl', [...(service.user ? ['--user'] : []), '-u', service.unit, '-n', '12', '--no-pager', '-o', 'short-iso']).catch(message);
    return { ...service, backendUrl: service.backend ? config.llamaUrl : null, properties, raw, listener, journal, listening, http, httpDetail, backend, process, state,
      diagnosis: backend === false && http ? 'SillyTavern itself is healthy; model backend is unavailable.' : process && !listening ? 'Process exists but port is not listening.' : state === 'healthy' ? 'All configured dependency checks passed.' : `${service.name} ${state}; inspect the failed stage.` };
  }));
}
const [projectChecks, configRepos, sessions, llamaStatus, gpuStatus, hostHealth, aiStatus, serviceStatus] = await Promise.all([
  config.projects.length ? Promise.all(config.projects.map(r => repo(r.path, r.name, r.workTree))) : [{ name: 'Projects', level: 'warning', detail: 'No project repositories configured.' }],
  Promise.all(config.configRepos.map(r => repo(r.path, r.name, r.workTree))),
  zellij(), currentHost.inference ? llama() : null, currentHost.inference ? gpu() : { gpus: [] },
  health(), currentHost.inference ? ai() : null,
  currentHost.name === 'babel' ? services() : [],
]);
console.log(JSON.stringify({ projects: projectChecks, configRepos, zellij: sessions, llama: llamaStatus,
  health: hostHealth, ai: aiStatus, services: serviceStatus, ...gpuStatus }));
