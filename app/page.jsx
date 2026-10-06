'use client';

import { useEffect, useState } from 'react';
import config from '../dashboard.config.json';
import { parseSessions } from '../lib/zellij.mjs';
import { age, shortenPath, summarize } from '../lib/dashboard.mjs';

function Row({ level = 'warning', children }) {
  return <li className="row"><span className={`dot ${level}`} aria-label={level} /><div className="min-w-0 break-words">{children}</div></li>;
}

function Checks({ items }) {
  return <ul>{items.map((item, i) => <Row key={`${item.name}-${i}`} level={item.level}>
    <div className="check-line"><span className="strong">{item.name}</span><span className="dim whitespace-pre-wrap">{item.detail}</span></div>
  </Row>)}</ul>;
}

function Repositories({ items }) {
  return <ul>{items.map((repo, i) => <Row key={i} level={repo.level}>
    <div className="check-line"><span className="strong">{repo.name}</span><span>{repo.detail}</span>{repo.stale && <span className="warning tag">quiet</span>}</div>
    {repo.lastCommit && <div className="dim text-xs"><span className="strong">{repo.lastCommit.hash}</span> · {repo.lastCommit.subject} · {age(repo.lastCommit.ageSeconds)}</div>}
    {repo.changes?.length > 0 && <details className="text-xs"><summary>{repo.unstaged} unstaged · {repo.staged} staged · {repo.untracked} untracked</summary>
      <ul className="subrows">{repo.changes.map((file, j) => <li key={j}><span className="warning change-code">{file.status}</span> {file.path}</li>)}</ul>
    </details>}
    {!!repo.worktrees?.length && <ul className="subrows">{repo.worktrees.map((tree, j) => <Row key={j} level={tree.level}>
      <div className="check-line text-xs"><span title={tree.path} className="strong">{shortenPath(tree.path)}</span><span>{tree.detail}</span></div>
      {tree.lastCommit && <div className="text-xs dim">{tree.lastCommit.hash} · {tree.lastCommit.subject} · {age(tree.lastCommit.ageSeconds)}</div>}
      {tree.changes?.length > 0 && <details className="text-xs"><summary>{tree.unstaged} unstaged · {tree.staged} staged · {tree.untracked} untracked</summary><ul className="subrows">{tree.changes.map((file, k) => <li key={k}><span className="warning change-code">{file.status}</span> {file.path}</li>)}</ul></details>}
    </Row>)}</ul>}
    {repo.worktreeError && <p className="warning text-xs">Worktrees unavailable: {repo.worktreeError}</p>}
  </Row>)}</ul>;
}

function Sessions({ item }) {
  if (item.level !== 'ok') return <Checks items={[item]} />;
  return <ul>{parseSessions(item.detail).map((session, i) => <Row key={i} level={session.state === 'exited' || session.state === 'unknown' ? 'warning' : 'ok'}>
    <div className="session"><span className="strong">{session.name}</span>
      <span className="dim session-age">{session.age && `${session.age} ago`}</span>
      <span className={`session-state tag ${session.state === 'current' ? 'current' : session.state === 'active' ? 'ok' : 'warning'}`} title={session.state === 'exited' ? 'Attach to resurrect this session' : undefined}>{session.state}</span>
    </div>
    <div className="text-xs dim session-paths">{item.directories?.[session.name]?.paths.length ? item.directories[session.name].paths.map(path => <span key={path} title={path}>{shortenPath(path)} </span>) : <span title={item.directories?.[session.name]?.error}>cwd unavailable</span>}{item.directories?.[session.name]?.saved && <span className="tag">saved layout</span>}</div>
  </Row>)}</ul>;
}

function Host({ name, inference, data }) {
  return <fieldset><legend>{name}</legend>
    <div className="flex justify-between gap-2 mb-2 text-xs"><span className="dim">{data?.local ? 'local' : 'tailscale / ssh'}</span><span className={`tag ${data ? data.online ? 'ok' : 'error' : 'warning'}`}>{data ? data.online ? 'online' : 'offline' : 'connecting'}</span></div>
    {!data || !data.online ? <ul><Row level={data ? 'error' : 'warning'}>{data?.error || 'Waiting for the first host check…'}</Row></ul> : <>
      <section className="section"><h2>Host health</h2><Checks items={data.health?.checks || []} />
        {data.health?.nixos && <p className="text-xs dim subrows">Generation updated {age(data.health.nixos.ageSeconds)} · deployed revision {data.health.nixos.deployedRevision || 'not recorded'}</p>}
        <ul>{data.configRepos.filter(repo => repo.name === config.configRepos.find(entry => entry.nixos)?.name && repo.lastCommit).map(repo => <Row key={repo.name} level="ok"><span className="dim text-xs">Flake HEAD {repo.lastCommit.hash} · {repo.lastCommit.subject}</span></Row>)}</ul>
      </section>
      <section className="section"><h2>Projects</h2><Repositories items={data.projects} /></section>
      <section className="section"><h2>Zellij sessions</h2><Sessions item={data.zellij} /></section>
      <section className="section"><h2>Configuration repos</h2><Repositories items={data.configRepos} /></section>
      {inference && <section className="section"><h2>llama-cpp / GPU</h2><Checks items={[data.llama || { name: 'llama-cpp', level: 'error', detail: 'Collector did not return service status.' }]} />
        <ul>{data.gpus.length ? data.gpus.map((gpu, i) => <Row key={i} level={gpu.usedGiB / gpu.totalGiB >= .9 || gpu.temperature >= 85 ? 'warning' : 'ok'}>
          <div className="check-line"><span className="strong">{gpu.name}</span><span className="dim">{gpu.usedGiB.toFixed(2)} / {gpu.totalGiB.toFixed(2)} GiB VRAM · {gpu.utilization == null ? 'util unavailable' : `${gpu.utilization}% busy`} · {gpu.temperature == null ? 'temp unavailable' : `${gpu.temperature.toFixed(0)}°C`}</span></div>
          <progress aria-label={`${gpu.name} VRAM usage`} value={gpu.usedGiB} max={gpu.totalGiB} />
        </Row>) : <Row level="warning">{data.gpuError || 'No GPU reported.'}</Row>}
          {data.ai && <>
            <Row level={data.ai.models.length ? 'ok' : 'warning'}><span className="strong">Loaded model</span> <span className="dim">{data.ai.models.join(', ') || data.ai.modelError}</span></Row>
            {data.ai.processes.length ? data.ai.processes.map(process => <Row key={process.pid} level="ok"><span className="strong">{process.name}</span> <span className="dim text-xs">PID {process.pid} · requested model {process.model || 'not in arguments'}</span></Row>) : <Row level="warning">No active llama.cpp process.</Row>}
            {data.ai.gpuProcesses.map(process => <Row key={process.pid} level="ok"><span className="strong">{process.name}</span> <span className="dim text-xs">PID {process.pid} · {process.vramGiB.toFixed(2)} GiB AMD process VRAM (ROCm/DRM)</span></Row>)}
            {data.ai.memoryError && <Row level="warning"><span className="text-xs">{data.ai.memoryError}</span></Row>}
          </>}
        </ul>
      </section>}
    </>}
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
        {!connected && <Row level={data ? 'error' : 'warning'}>{data ? 'Live connection lost. Displayed host data is stale; reconnecting…' : 'Connecting to hosts…'}</Row>}
        {data && (summary.length ? summary.map((item, i) => <Row key={i} level={item.level}><div className="check-line"><span className="strong">{item.name}</span><span className="dim">{item.detail}</span></div></Row>) : <Row level="ok">Both hosts reachable. No critical alerts.</Row>)}
      </ul></div>
      <div className="flex flex-wrap justify-between gap-2 mt-1 pt-1 border-t border-dashed border-[var(--muted)] text-xs dim"><span>refresh / 2s · last check / {data ? new Date(data.updatedAt).toLocaleTimeString() : '—'}</span><button onClick={() => { setConnected(false); setAttempt(n => n + 1); }}>reconnect [↵]</button></div>
    </fieldset>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">{config.hosts.map(host => <Host key={host.name} {...host} data={data?.hosts.find(entry => entry.host === host.name)} />)}</div>
  </main>;
}
