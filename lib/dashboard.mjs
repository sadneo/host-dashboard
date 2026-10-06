export function age(seconds) {
  for (const [unit, size] of [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]]) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return 'just now';
}

export function projectPairs(hosts, configuration) {
  return [...configuration.projects, ...configuration.configRepos].map(entry => {
    const sides = ['babel', 'waka'].map(name => {
      const host = hosts.find(h => h.host === name);
      const repo = [...(host?.projects || []), ...(host?.configRepos || [])].find(r => r.name === entry.name);
      const sessions = Object.entries(host?.zellij?.directories || {}).filter(([, value]) => !value.saved && value.paths.some(path => [repo, ...(repo?.worktrees || [])].some(r => r?.path && (path === r.path || !entry.workTree && path.startsWith(`${r.path}/`))))).map(([name]) => name);
      return { host: name, repo, sessions, nixos: host?.health?.nixos, online: host?.online };
    });
    const [a, b] = sides.map(s => s.repo);
    const usable = r => r?.lastCommit && r.history;
    const work = r => Boolean(r?.dirty || r?.worktrees?.some(t => t.dirty));
    let state = 'comparison unavailable', conclusion = 'Both hosts need readable repository evidence.', level = 'info';
    if (usable(a) && usable(b)) {
      const ah = a.lastCommit.hash, bh = b.lastCommit.hash;
      if (ah === bh) {
        state = work(a) && work(b) ? 'work exists on both' : work(a) ? 'active on babel' : work(b) ? 'active on waka' : 'synced';
        conclusion = work(a) || work(b) ? `Same commits; ${work(a) && work(b) ? 'both hosts have' : work(a) ? 'babel has' : 'waka has'} local modifications.` : 'Hosts synchronized.';
        level = work(a) || work(b) ? 'warning' : 'ok';
      } else if (a.history.includes(bh) || b.history.includes(ah)) {
        const newer = a.history.includes(bh) ? 'babel' : 'waka';
        state = work(a) && work(b) ? 'work exists on both' : `active on ${newer}`;
        conclusion = `${newer} contains newer commits${work(a) && work(b) ? '; local work exists on both' : ''}.`; level = 'warning';
      } else if (a.history.some(hash => b.history.includes(hash))) {
        state = 'diverged'; conclusion = 'Both hosts contain unique commits; compare before moving work.'; level = 'warning';
      } else { state = 'different HEADs'; conclusion = 'No common ancestor in collected history; relationship unknown.'; level = 'warning'; }
    }
    const scores = sides.map(s => (s.repo?.recent?.length || 0) + (work(s.repo) ? 3 : 0) + s.sessions.length * 4);
    return { ...entry, config: configuration.configRepos.some(r => r.name === entry.name), sides, state, conclusion, level,
      primary: scores[0] === scores[1] ? null : scores[0] > scores[1] ? 'babel' : 'waka',
      active: sides.some(s => work(s.repo) || s.sessions.length || s.repo?.recent?.length), dirty: work(a) || work(b) };
  });
}

export function networkDiagnosis(results) {
  const result = id => results.find(r => r.id === id);
  const pass = id => result(id)?.status === 'passed';
  const fail = id => result(id)?.status === 'failed';
  const notes = [];
  const dns = pass('system-a');
  const conventional = results.some(r => r.id.startsWith('udp-') && r.status === 'passed' && r.stdout);
  const dotRequired = /(?:DNSOverTLS|DNS over TLS)(?:[^\n]*):\s*(?:yes|true)|\+DNSOverTLS/.test(result('resolver-config')?.stdout || '');
  if (pass('ipv4-tcp') && fail('system-a') && conventional && dotRequired && fail('configured-dot')) notes.push('DNS-over-TLS appears blocked: conventional DNS works, configured DoT fails, and the resolver requires DoT.');
  else if (pass('ipv4-tcp') && fail('system-a')) notes.push('Direct IPv4 works but system DNS resolution fails.');
  else if (fail('ipv4-tcp')) notes.push(fail('gateway') ? 'Local gateway and internet-by-IP checks failed.' : 'Internet-by-IP connectivity failed; inspect link, routes, and gateway evidence.');
  if (pass('ipv4-tcp') && fail('ipv6-tcp')) notes.push('IPv4 works; IPv6 connectivity failed.');
  for (const server of ['1.1.1.1', '8.8.8.8']) if (fail(`udp-${server}`) && pass(`tcp-${server}`)) notes.push(`DNS UDP/53 fails but TCP/53 works to ${server}.`);
  if (fail('public-dot') && !notes.some(n => n.startsWith('DNS-over-TLS'))) notes.push('Public DoT comparison failed; this alone does not establish a configured-resolver failure.');
  if (dns && fail('https')) notes.push('DNS resolves but HTTPS fails.');
  if (fail('configured-dot-query') && pass('configured-dot')) notes.push('Configured resolver TLS connects but its DoT DNS query fails.');
  if (pass('configured-dot-query') && ['1.1.1.1', '8.8.8.8'].every(server => fail(`udp-${server}`) && fail(`tcp-${server}`))) notes.push('Public DNS on UDP/TCP port 53 fails, while configured DNS-over-TLS works.');
  if (fail('tls') && pass('https')) notes.push('Direct-IP TLS/SNI failed while hostname HTTPS works; inspect certificate or path differences.');
  if (result('portal')?.status === 'passed' && !/^HTTP\/\S+ 204\b/m.test(result('portal').stdout)) notes.push('Captive portal suspected: connectivity endpoint did not return HTTP 204.');
  if (fail('babel-tail')) notes.push('Babel Tailscale reachability failed.');
  if (fail('babel-ssh')) notes.push('Babel SSH port is unreachable.');
  if (fail('mtu-probe') && pass('ipv4-ping')) notes.push('Small ICMP works but a 1500-byte no-fragment probe failed; inspect MTU/PMTU evidence.');
  if (!notes.length && pass('ipv4-tcp') && dns && pass('https')) notes.push('Network healthy: IPv4, configured hostname resolution, and HTTPS passed.');
  if (results.some(r => r.status === 'unavailable')) notes.push('Some checks are unavailable; the report identifies missing tools or context.');
  if (!notes.length) notes.push('Insufficient evidence; review failed or unavailable checks.');
  return notes;
}

export function diagnosticSummary(run) {
  return [`NETWORK DIAGNOSTICS — ${run.host || 'waka'}`, `Started: ${run.timestamp || 'unknown'} · ${run.complete ? 'complete' : 'incomplete'}`,
    ...networkDiagnosis(run.results || []).map(n => `RESULT: ${n}`), ...(run.results || []).map(r =>
      `\n[${r.phase}] ${r.command} — ${r.status.toUpperCase()} (${r.durationMs}ms)\n${r.stdout || '(no stdout)'}${r.stderr ? `\nstderr: ${r.stderr}` : ''}`), run.error ? `\nRUN ERROR: ${run.error}` : ''].join('\n');
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
