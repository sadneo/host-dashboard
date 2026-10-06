export function age(seconds) {
  for (const [unit, size] of [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]]) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return 'just now';
}

export function shortenPath(path, limit = 38) {
  if (path.length <= limit) return path;
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (!parts[i] || parts[i] === '~') continue;
    parts[i] = parts[i].startsWith('.') ? parts[i].slice(0, 2) : parts[i][0];
    if (parts.join('/').length <= limit) break;
  }
  return parts.join('/');
}

export function summarize(hosts, configuration) {
  const items = [];
  let dirty = 0, failed = 0, stale = 0;
  for (const host of hosts) {
    if (!host.online) { items.push({ name: host.host, level: 'error', detail: `offline · ${host.error}` }); continue; }
    const repositories = [...host.projects, ...host.configRepos];
    for (const repo of repositories) {
      for (const item of [repo, ...(repo.worktrees || [])]) {
        if (item.dirty) dirty++;
        if (item.stale) stale++;
        if (item.level === 'error') items.push({ name: `${host.host} / ${repo.name}${item !== repo ? ` / ${item.name}` : ''}`, level: 'error', detail: item.detail });
        if (item.ahead || item.behind) items.push({ name: `${host.host} / ${repo.name}${item !== repo ? ` / ${item.name}` : ''}`, level: 'warning', detail: `${item.ahead} ahead · ${item.behind} behind remote` });
      }
    }
    failed += host.health?.failedUnits.length || 0;
    for (const check of host.health?.checks || []) {
      if (check.level !== 'ok' && !['System units', 'User units'].includes(check.name)) items.push({ ...check, name: `${host.host} / ${check.name}` });
      if (check.level === 'warning' && ['System units', 'User units'].includes(check.name)) items.push({ ...check, name: `${host.host} / ${check.name}` });
    }
    if (host.zellij.level === 'error') items.push({ ...host.zellij, name: `${host.host} / Zellij` });
    if (configuration.hosts.find(h => h.name === host.host)?.inference) {
      if (host.llama?.level === 'error') items.push({ ...host.llama, name: `${host.host} / ${host.llama.name}` });
      for (const gpu of host.gpus) {
        if (gpu.usedGiB / gpu.totalGiB >= .9 || gpu.temperature >= 85) items.push({ name: `${host.host} / ${gpu.name}`, level: 'warning', detail: 'High VRAM usage or GPU temperature.' });
      }
      if (!host.gpus.length) items.push({ name: `${host.host} / GPU`, level: 'warning', detail: host.gpuError || 'GPU counters unavailable.' });
    }
  }
  if (dirty) items.unshift({ name: `${dirty} dirty ${dirty === 1 ? 'repo' : 'repos'}`, level: 'warning', detail: 'Including linked worktrees.' });
  if (failed) items.unshift({ name: `${failed} failed ${failed === 1 ? 'unit' : 'units'}`, level: 'error', detail: 'Review systemd units below.' });
  if (stale) items.push({ name: `${stale} quiet ${stale === 1 ? 'repo' : 'repos'}`, level: 'warning', detail: `No changes and last commit at least ${configuration.staleRepoDays} days ago.` });
  return items.sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
}
