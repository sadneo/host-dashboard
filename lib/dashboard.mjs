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

export function llamaState(host) {
  if (host.llama?.level === 'ok' || host.ai?.processes.length || host.ai?.models.length) return { level: 'ok', detail: 'active' };
  if (host.llama?.detail.startsWith('loaded ·')) return { level: 'error', detail: host.llama.detail.includes('failed') ? 'failed' : 'inactive' };
  return { level: 'info', detail: 'not running' };
}

export function summarize(hosts, configuration) {
  if (!hosts.length) return [];
  const items = [];
  let dirty = 0, failed = 0;
  for (const host of hosts) {
    if (!host.online) { items.push({ name: host.host, level: 'error', detail: 'offline', priority: 100 }); continue; }
    const repositories = [...host.projects, ...host.configRepos];
    for (const repo of repositories) {
      for (const item of [repo, ...(repo.worktrees || [])]) {
        if (item.dirty) dirty++;
        const name = `${host.host} / ${repo.name}${item !== repo ? ` / ${item.name}` : ''}`;
        if (item.level === 'error') items.push({ name, level: 'error', detail: item.detail.includes('merge conflicts') ? 'merge conflicts' : 'collection failed', priority: 90 });
        else if (item.behind) items.push({ name, level: 'warning', detail: `${item.behind} ${item.behind === 1 ? 'commit' : 'commits'} behind`, priority: 70 });
        else if (item.ahead && configuration.configRepos?.some(entry => entry.nixos && entry.name === repo.name)) items.push({ name, level: 'warning', detail: `${item.ahead} ahead of remote`, priority: 60 });
      }
    }
    failed += host.health?.failedUnits.length || 0;
    for (const check of host.health?.checks || []) {
      if (check.level === 'warning' && (check.name === 'Uptime / load' || /^(RAM|Disk )/.test(check.name) && /^\d/.test(check.detail))) {
        items.push({ name: `${host.host} / ${check.name === 'Uptime / load' ? 'load' : check.name}`, level: 'warning', detail: check.name === 'Uptime / load' ? 'high load' : 'high usage', priority: 80 });
      }
    }
    if (host.zellij.level === 'error') items.push({ name: `${host.host} / Zellij`, level: 'error', detail: 'collection failed', priority: 85 });
    if (configuration.hosts.find(h => h.name === host.host)?.inference) {
      const service = llamaState(host);
      if (service.level === 'error' && !host.health?.failedUnits.includes(host.llama.name)) items.push({ name: `${host.host} / llama-cpp`, ...service, priority: 75 });
      for (const gpu of host.gpus) {
        if (gpu.usedGiB / gpu.totalGiB >= .9 || gpu.temperature >= 85) items.push({ name: `${host.host} / GPU`, level: 'warning', detail: gpu.temperature >= 85 ? 'high temperature' : 'VRAM nearly full', priority: 80 });
      }
    }
  }
  if (failed) items.push({ name: `${failed} failed ${failed === 1 ? 'unit' : 'units'}`, level: 'error', detail: '', priority: 95 });
  if (dirty && items.length < 3) items.push({ name: `${dirty} dirty ${dirty === 1 ? 'repo' : 'repos'}`, level: 'warning', detail: '', priority: 10 });
  items.sort((a, b) => b.priority - a.priority);
  const online = hosts.filter(host => host.online).length;
  const status = { name: `${online} ${online === 1 ? 'host' : 'hosts'} online`, detail: '', level: online === hosts.length ? 'ok' : 'info' };
  if (items.length <= 3) return [status, ...items];
  return [status, ...items.slice(0, 2), { name: `${items.length - 2} more items need attention`, detail: '', level: items[2].level, more: items.slice(2) }];
}
