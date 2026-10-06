'use client';

import { useEffect, useState } from 'react';
import config from '../dashboard.config.json';

function Row({ level = 'warning', children }) {
  return <li className="row"><span className={`dot ${level}`} aria-label={level} /><div className="min-w-0 break-words">{children}</div></li>;
}

function Checks({ items }) {
  return <ul>{items.map((item, i) => <Row key={`${item.name}-${i}`} level={item.level}>
    <span className="strong">{item.name}</span><p className="dim text-xs whitespace-pre-wrap">{item.detail}</p>
  </Row>)}</ul>;
}

function Host({ name, inference, data }) {
  return <fieldset><legend>{name}</legend>
    <div className="flex justify-between gap-2 mb-5"><span className="dim">{data?.local ? 'local' : 'tailscale / ssh'}</span><span className={`tag ${data ? data.online ? 'ok' : 'error' : 'warning'}`}>{data ? data.online ? 'connected' : 'unreachable' : 'connecting'}</span></div>
    {!data || !data.online ? <ul><Row level={data ? 'error' : 'warning'}>{data?.error || 'Waiting for the first host check…'}</Row></ul> : <>
      <section className="section"><h2>Projects</h2><Checks items={data.projects} /></section>
      <section className="section"><h2>Zellij sessions</h2><Checks items={[data.zellij]} /></section>
      <section className="section"><h2>Configuration repos</h2><Checks items={data.configRepos} /></section>
      {inference && <section className="section"><h2>llama-cpp / GPU</h2><Checks items={[data.llama || { name: 'llama-cpp', level: 'error', detail: 'Collector did not return service status.' }]} />
        <ul>{data.gpus.length ? data.gpus.map((gpu, i) => <Row key={i} level={gpu.usedGiB / gpu.totalGiB >= .9 ? 'warning' : 'ok'}>
          <span className="strong">{gpu.name}</span><p className="dim text-xs">{gpu.usedGiB.toFixed(2)} / {gpu.totalGiB.toFixed(2)} GiB VRAM</p>
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
  return <main className="max-w-6xl mx-auto px-4 py-8 sm:px-8 sm:py-12">
    <header className="flex flex-wrap justify-between items-baseline gap-3 mb-7"><h1 className="strong text-lg font-bold">~/ dashboard <span className="dim font-normal text-sm">/ hosts</span></h1><span className="dim text-xs">{config.hosts.map(host => host.name).join(' ← → ')}</span></header>
    <fieldset className="mb-7"><legend>Summary</legend>
      <div role="status" aria-live="polite"><ul>
        {!connected && <Row level={data ? 'error' : 'warning'}>{data ? 'Live connection lost. Displayed host data is stale; reconnecting…' : 'Connecting to hosts…'}</Row>}
        {data && (alerts.length ? alerts.map((alert, i) => <Row key={i} level="error"><span className="error">{alert}</span></Row>) : <Row level="ok">Both hosts reachable. No critical alerts.</Row>)}
        {!!warnings && <Row level="warning">{warnings} {warnings === 1 ? 'warning' : 'warnings'} — review host details below.</Row>}
      </ul></div>
      <div className="flex flex-wrap justify-between gap-2 mt-4 pt-3 border-t border-dashed border-[var(--muted)] text-xs dim"><span>refresh / 2s · last check / {data ? new Date(data.updatedAt).toLocaleTimeString() : '—'}</span><button onClick={() => { setConnected(false); setAttempt(n => n + 1); }}>reconnect [↵]</button></div>
    </fieldset>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">{config.hosts.map(host => <Host key={host.name} {...host} data={data?.hosts.find(entry => entry.host === host.name)} />)}</div>
    <footer className="mt-6 flex flex-wrap justify-between gap-2 dim text-xs"><span><span className="ok">●</span> ok <span className="warning ml-3">●</span> warning <span className="error ml-3">●</span> alert</span><span>localhost · read-only</span></footer>
  </main>;
}
