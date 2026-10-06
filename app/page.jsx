'use client';

import { useEffect, useState } from 'react';
import config from '../dashboard.config.json';
import { parseSessions } from '../lib/zellij.mjs';

function Row({ level = 'warning', children }) {
  return <li className="row"><span className={`dot ${level}`} aria-label={level} /><div className="min-w-0 break-words">{children}</div></li>;
}

function Checks({ items }) {
  return <ul>{items.map((item, i) => <Row key={`${item.name}-${i}`} level={item.level}>
    <div className="check-line"><span className="strong">{item.name}</span><span className="dim whitespace-pre-wrap">{item.detail}</span></div>
  </Row>)}</ul>;
}

function Sessions({ item }) {
  if (item.level !== 'ok') return <Checks items={[item]} />;
  return <ul>{parseSessions(item.detail).map((session, i) => <Row key={i} level={session.state === 'exited' || session.state === 'unknown' ? 'warning' : 'ok'}>
    <div className="session"><span className="strong">{session.name}</span>
      <span className="dim session-age">{session.age && `${session.age} ago`}</span>
      <span className={`session-state tag ${session.state === 'current' ? 'current' : session.state === 'active' ? 'ok' : 'warning'}`} title={session.state === 'exited' ? 'Attach to resurrect this session' : undefined}>{session.state}</span>
    </div>
  </Row>)}</ul>;
}

function Host({ name, inference, data }) {
  return <fieldset><legend>{name}</legend>
    <div className="flex justify-between gap-2 mb-2 text-xs"><span className="dim">{data?.local ? 'local' : 'tailscale / ssh'}</span><span className={`tag ${data ? data.online ? 'ok' : 'error' : 'warning'}`}>{data ? data.online ? 'connected' : 'unreachable' : 'connecting'}</span></div>
    {!data || !data.online ? <ul><Row level={data ? 'error' : 'warning'}>{data?.error || 'Waiting for the first host check…'}</Row></ul> : <>
      <section className="section"><h2>Projects</h2><Checks items={data.projects} /></section>
      <section className="section"><h2>Zellij sessions</h2><Sessions item={data.zellij} /></section>
      <section className="section"><h2>Configuration repos</h2><Checks items={data.configRepos} /></section>
      {inference && <section className="section"><h2>llama-cpp / GPU</h2><Checks items={[data.llama || { name: 'llama-cpp', level: 'error', detail: 'Collector did not return service status.' }]} />
        <ul>{data.gpus.length ? data.gpus.map((gpu, i) => <Row key={i} level={gpu.usedGiB / gpu.totalGiB >= .9 ? 'warning' : 'ok'}>
          <div className="check-line"><span className="strong">{gpu.name}</span><span className="dim">{gpu.usedGiB.toFixed(2)} / {gpu.totalGiB.toFixed(2)} GiB VRAM</span></div>
          <progress aria-label={`${gpu.name} VRAM usage`} value={gpu.usedGiB} max={gpu.totalGiB} />
        </Row>) : <Row level="warning">{data.gpuError || 'No GPU reported.'}</Row>}</ul>
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
  const alerts = [];
  let warnings = 0;
  for (const host of data?.hosts || []) {
    const inference = config.hosts.find(entry => entry.name === host.host)?.inference;
    if (!host.online) { alerts.push(`${host.host}: ${host.error}`); continue; }
    for (const item of [...host.projects, ...host.configRepos, host.zellij, ...(inference && host.llama ? [host.llama] : [])]) {
      if (item.level === 'error') alerts.push(`${host.host} / ${item.name}: ${item.detail}`);
      if (item.level === 'warning') warnings++;
    }
    if (inference) warnings += host.gpus.length ? host.gpus.filter(g => g.usedGiB / g.totalGiB >= .9).length : 1;
  }
  return <main aria-label="Host dashboard" className="p-2 sm:p-3">
    <fieldset className="mb-2"><legend>Summary</legend>
      <div role="status" aria-live="polite"><ul>
        {!connected && <Row level={data ? 'error' : 'warning'}>{data ? 'Live connection lost. Displayed host data is stale; reconnecting…' : 'Connecting to hosts…'}</Row>}
        {data && (alerts.length ? alerts.map((alert, i) => <Row key={i} level="error"><span className="error">{alert}</span></Row>) : <Row level="ok">Both hosts reachable. No critical alerts.</Row>)}
        {!!warnings && <Row level="warning">{warnings} {warnings === 1 ? 'warning' : 'warnings'} — review host details below.</Row>}
      </ul></div>
      <div className="flex flex-wrap justify-between gap-2 mt-1 pt-1 border-t border-dashed border-[var(--muted)] text-xs dim"><span>refresh / 2s · last check / {data ? new Date(data.updatedAt).toLocaleTimeString() : '—'}</span><button onClick={() => { setConnected(false); setAttempt(n => n + 1); }}>reconnect [↵]</button></div>
    </fieldset>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">{config.hosts.map(host => <Host key={host.name} {...host} data={data?.hosts.find(entry => entry.host === host.name)} />)}</div>
  </main>;
}
