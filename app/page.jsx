'use client';

import { useEffect, useState } from 'react';
import config from '../dashboard.config.json';
import { parseSessions } from '../lib/zellij.mjs';
import { age, shortenPath, summarize, llamaState } from '../lib/dashboard.mjs';

function Row({ level = 'info', children }) {
  return <li className="row"><span className={`dot ${level}`} aria-label={level} /><div className="min-w-0">{children}</div></li>;
}

function Checks({ items }) {
  return <ul>{items.map((item, i) => <Row key={i} level={item.level}>
    <span className="strong">{item.name}</span>{item.detail && <span className="secondary"> · {item.detail}</span>}
  </Row>)}</ul>;
}

const marker = <span className="disclosure-marker" aria-hidden="true">›</span>;
const compactAge = seconds => age(seconds).replace(' ago', '').replace('just now', 'now');
const repoState = repo => repo.level === 'error' ? 'unavailable' : `${repo.dirty ? `${repo.dirty} changed` : 'clean'}${repo.stale ? ' · quiet' : ''}`;

function NixosDetails({ nixos, revision }) {
  return <div className="secondary">
    {nixos && <p>Generation {nixos.generation} · {nixos.version} · updated {age(nixos.ageSeconds)}</p>}
    {revision && <p>Flake HEAD {revision}</p>}
    {nixos?.deployedRevision && <p>Deployed revision {nixos.deployedRevision}</p>}
  </div>;
}

function Repositories({ items, configuration = false, nixos }) {
  return <ul>{items.map(repo => {
    return <Row key={repo.path || repo.name} level={repo.level}>
      <details className="repo-disclosure">
        <summary className={`repo-line ${configuration ? 'config-line' : ''}`}>
          <span className="primary-name truncate" title={repo.path}>{repo.name}</span>
          {!configuration && <span className="secondary truncate" title={repo.branch}>{repo.branch || '—'}</span>}
          <span className="truncate" title={repo.level === 'error' ? 'See Diagnostics' : repo.detail}>{repoState(repo)}{repo.ahead > 0 && ` ↑${repo.ahead}`}{repo.behind > 0 && ` ↓${repo.behind}`}</span>
          <span className="secondary row-age">{repo.lastCommit ? compactAge(repo.lastCommit.ageSeconds) : '—'}</span>{marker}
        </summary>
        <div className="disclosure-body">
          {repo.branch && <p className="secondary">{repo.branch} · {repo.detail.split(' · ').slice(1).join(' · ')}</p>}
          {repo.lastCommit && <p className="secondary">{repo.lastCommit.hash} · {repo.lastCommit.subject} · {age(repo.lastCommit.ageSeconds)}</p>}
          {repo.path && <p className="secondary">{repo.path}</p>}
          {configuration && repo.name === config.configRepos.find(entry => entry.nixos)?.name && <NixosDetails nixos={nixos} revision={repo.lastCommit?.hash} />}
          {repo.changes?.length > 0 && <details className="secondary"><summary>{repo.unstaged} unstaged · {repo.staged} staged · {repo.untracked} untracked</summary>
            <ul className="change-list">{repo.changes.map((file, i) => <li key={i}><span className="change-code">{file.status}</span> {file.path}</li>)}</ul>
          </details>}
          {!!repo.worktrees?.length && <div className="worktree-details"><h3>Worktrees</h3><Repositories items={repo.worktrees} /></div>}
          {repo.level === 'error' && <p className="secondary">Collection failed. See Diagnostics.</p>}
        </div>
      </details>
    </Row>;
  })}</ul>;
}

function Session({ session, item }) {
  const directories = item.directories?.[session.name];
  return <Row level={session.state === 'exited' || session.state === 'unknown' ? 'info' : 'ok'}>
    <details className="session-disclosure">
      <summary className="session-line"><span className="primary-name truncate">{session.name}</span><span className={session.state === 'exited' ? 'secondary' : 'ok'}>{session.state}</span><span className="secondary row-age">{session.age}</span>{marker}</summary>
      <div className="disclosure-body secondary">{directories?.paths.length ? directories.paths.map(path => <p key={path} title={path}>{shortenPath(path)}</p>) : <p>Directory unavailable.</p>}{directories?.saved && <p>Saved layout · attach to resurrect.</p>}</div>
    </details>
  </Row>;
}

function Sessions({ item }) {
  if (item.level !== 'ok') return <ul><Row level={item.level === 'error' ? 'error' : 'info'}>{item.level === 'error' ? 'Session collection unavailable' : 'No active sessions'}</Row></ul>;
  const sessions = parseSessions(item.detail);
  const exited = sessions.filter(session => session.state === 'exited');
  return <ul>{sessions.filter(session => session.state !== 'exited').map(session => <Session key={session.name} session={session} item={item} />)}
    {!!exited.length && <Row><details className="exited-sessions"><summary className="secondary">{exited.length} exited {exited.length === 1 ? 'session' : 'sessions'} {marker}</summary>
      <ul className="disclosure-body">{exited.map(session => <Session key={session.name} session={session} item={item} />)}</ul>
    </details></Row>}
  </ul>;
}

function HostHealth({ data }) {
  const checks = data.health?.checks || [];
  const load = checks.find(check => check.name === 'Uptime / load');
  const [up, averages, cpu] = load?.detail.split(' · ') || [];
  const ram = checks.find(check => check.name === 'RAM');
  const disks = checks.filter(check => check.name.startsWith('Disk '));
  const uniqueDisks = disks.filter((disk, i) => disks.findIndex(other => other.detail === disk.detail) === i);
  const metric = check => check && /^\d/.test(check.detail) ? check.detail.split(' · ')[0].replace(/GiB(?: used)?/g, 'G').replace(/\s*\/\s*/g, '/').replace(' G', 'G') : '—';
  const units = checks.filter(check => ['System units', 'User units'].includes(check.name));
  const failed = data.health?.failedUnits.length || 0;
  const unitsKnown = units.length === 2 && units.every(check => check.level !== 'warning');
  const nixos = data.health?.nixos;
  const flake = data.configRepos.find(repo => repo.name === config.configRepos.find(entry => entry.nixos)?.name)?.lastCommit?.hash;
  return <ul className="host-health">
    <Row level={load?.level === 'warning' ? 'warning' : 'ok'}><div className="health-line"><span className="ok">online</span>{up && <span> · up {up} · load {averages?.replaceAll(' / ', '/')} <span className="secondary">· {cpu}</span></span>}</div></Row>
    <Row level={[ram, ...disks].some(check => check?.level === 'warning' && /^\d/.test(check.detail)) ? 'warning' : 'info'}><div className="health-line">RAM {metric(ram)}{uniqueDisks.map(disk => <span key={disk.name}> · disk {disk.name.slice(5)} {metric(disk)}</span>)}</div></Row>
    <Row level={failed ? 'error' : 'info'}><details className="health-disclosure"><summary className="secondary metadata-line"><span>systemd {failed ? `${failed} failed` : unitsKnown ? '✓' : '—'}{nixos && ` · nixos gen ${nixos.generation}`}{flake && ` · flake ${flake}`}</span>{marker}</summary>
      <div className="disclosure-body"><Checks items={checks.filter(check => check.level === 'ok' || /^\d/.test(check.detail) || units.includes(check) && check.level === 'error')} /><NixosDetails nixos={nixos} revision={flake} /></div>
    </details></Row>
  </ul>;
}

function AI({ data }) {
  const service = llamaState(data);
  const hasData = data.gpus.length || data.ai?.processes.length || data.ai?.models.length || service.level !== 'info';
  if (!hasData) return null;
  return <section className="section"><h2>GPU / AI</h2><ul>
    <Row level={service.level}><details className="ai-disclosure"><summary className="metadata-line"><span><span className="primary-name">llama-cpp</span> <span className={service.level}>{service.detail}</span>{!!data.ai?.models.length && <span className="secondary"> · {data.ai.models.map(model => model.split('/').at(-1)).join(', ')}</span>}</span>{marker}</summary>
      <div className="disclosure-body secondary">{data.ai?.models.map(model => <p key={model}>Loaded model: {model}</p>)}{data.ai?.processes.map(process => <p key={process.pid}>{process.name} · PID {process.pid} · requested model {process.model || 'not specified'}</p>)}{!data.ai?.processes.length && <p>No active llama.cpp process.</p>}</div>
    </details></Row>
    {data.gpus.map(gpu => <Row key={gpu.name} level={gpu.usedGiB / gpu.totalGiB >= .9 || gpu.temperature >= 85 ? 'warning' : 'ok'}>
      <details className="gpu-disclosure"><summary className="metadata-line"><span><span className="primary-name">GPU</span> {gpu.usedGiB.toFixed(1)}/{gpu.totalGiB.toFixed(1)}G{gpu.utilization != null && ` · ${gpu.utilization}% busy`}{gpu.temperature != null && ` · ${gpu.temperature.toFixed(0)}°C`}</span>{marker}</summary>
        <div className="disclosure-body secondary"><p>{gpu.name}</p><h3>GPU processes · AMD / ROCm</h3>{data.ai?.gpuProcesses.length ? data.ai.gpuProcesses.map(process => <p className="process-line" key={process.pid}><span>{process.name} <span className="dim">· {process.pid}</span></span><span>{process.vramGiB.toFixed(2)} GiB</span></p>) : <p>No readable process memory counters.</p>}</div>
      </details>
    </Row>)}
  </ul></section>;
}

function Diagnostics({ data }) {
  const items = [];
  const add = (name, detail) => { if (detail) items.push({ name, detail, level: 'info' }); };
  if (!data.online) add('Collection', data.error);
  for (const repo of [...(data.projects || []), ...(data.configRepos || [])]) {
    if (repo.level === 'error') add(repo.name, repo.detail);
    add(`${repo.name} / worktrees`, repo.worktreeError);
    for (const tree of repo.worktrees || []) if (tree.level === 'error' || tree.prunable) add(`${repo.name} / ${tree.name}`, tree.detail);
  }
  for (const check of data.health?.checks || []) if (check.level !== 'ok') add(check.name, check.detail);
  if (data.zellij?.level === 'error') add('Zellij', data.zellij.detail);
  for (const [name, entry] of Object.entries(data.zellij?.directories || {})) if (!entry.paths.length) add(`Zellij / ${name}`, entry.error || 'cwd unavailable');
  if (data.llama?.level === 'error') add('llama-cpp', data.llama.detail);
  add('GPU', data.gpuError); add('Loaded model', data.ai?.modelError); add('Process memory', data.ai?.memoryError);
  if (!items.length) return null;
  return <details className="diagnostics"><summary>Diagnostics</summary><div className="disclosure-body"><Checks items={items} /></div></details>;
}

function Host({ name, inference, data }) {
  return <fieldset><legend>{name}</legend>
    {!data || !data.online ? <ul><Row level={data ? 'error' : 'info'}>{data ? 'offline · collection unavailable' : 'connecting…'}</Row></ul> : <>
      <HostHealth data={data} />
      <section className="section"><h2>Projects</h2><Repositories items={data.projects} /></section>
      <section className="section"><h2>Zellij</h2><Sessions item={data.zellij} /></section>
      <section className="section"><h2>Config</h2><Repositories items={data.configRepos} configuration nixos={data.health?.nixos} /></section>
      {inference && <AI data={data} />}
    </>}
    {data && <Diagnostics data={data} />}
  </fieldset>;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const source = new EventSource('/api/status');
    source.onmessage = event => { setData(JSON.parse(event.data)); setConnected(true); };
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [attempt]);
  const summary = summarize(data?.hosts || [], config);
  return <main aria-label="Host dashboard" className="p-2 sm:p-3">
    <fieldset className="mb-2"><legend>Summary</legend>
      <div role="status" aria-live="polite"><ul>
        {!connected && <Row level={data ? 'error' : 'info'}>{data ? 'Live connection lost · displayed data is stale · reconnecting…' : 'Connecting to hosts…'}</Row>}
        {summary.map((item, i) => <Row key={i} level={item.level}>{item.more ? <details><summary>{item.name}</summary><div className="disclosure-body"><Checks items={item.more} /></div></details> : <><span className="primary-name">{item.name}</span>{item.detail && <span> · {item.detail}</span>}</>}</Row>)}
      </ul></div>
      <div className="summary-meta secondary"><span>2s · {data ? new Date(data.updatedAt).toLocaleTimeString() : '—'}</span><button onClick={() => { setConnected(false); setAttempt(n => n + 1); }}>reconnect</button></div>
    </fieldset>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">{config.hosts.map(host => <Host key={host.name} {...host} data={data?.hosts.find(entry => entry.host === host.name)} />)}</div>
  </main>;
}
