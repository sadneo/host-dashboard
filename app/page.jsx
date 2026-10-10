'use client';

import { useEffect, useState } from 'react';
import config from '../dashboard.config.json';
import { age, projectPairs, runningConfigComparison } from '../lib/dashboard.mjs';

const tabs = ['Main', 'Projects', 'Desktop'];
const symbol = value => value == null ? '—' : value ? '✓' : '✗';
const tone = value => value == null ? 'info' : value ? 'ok' : 'error';
const short = hash => hash?.slice(0, 7) || '—';
const stateTone = state => state === 'healthy' ? 'ok' : state === 'failed' ? 'error' : state === 'degraded' ? 'warning' : 'info';
function Section({ title, children, className = '' }) { return <section className={`section ${className}`}><h2>{title}</h2>{children}</section>; }
function Check({ name, value, detail }) { return <div className={`check ${tone(value)}`}><span>{name}</span><span>{symbol(value)} {detail}</span></div>; }
function CompactRepo({ side }) {
  const r = side.repo;
  return <span className={!r?.lastCommit ? 'info' : r.dirty ? 'warning' : ''}>{!side.online ? 'host unavailable' : !r?.lastCommit ? 'repo unavailable' : `${short(r.lastCommit.hash)} ${r.dirty ? `M${r.dirty}` : 'clean'}${r.ahead ? ` ↑${r.ahead}` : ''}${r.behind ? ` ↓${r.behind}` : ''}`}<small>{r?.branch}</small></span>;
}
function HostSummary({ host, name }) {
  const n = host?.health?.nixos;
  return <div><b>{name}</b> <span className={host?.online ? 'ok' : host ? 'error' : 'info'}>● {host?.online ? 'online' : host ? 'unavailable' : 'connecting'}</span>
    {host?.online && <><p>{host.health?.checks.find(c => c.name === 'Uptime / load')?.detail || 'uptime unavailable'}</p><p><span className="info">profile</span> {n?.specialization || 'unknown'}</p>
      {host.health?.checks.filter(c => c.level !== 'ok' && /^(RAM|Disk |Uptime)/.test(c.name)).map(c => <p className="warning" key={c.name}>{c.name}: {c.detail}</p>)}</>}
    {host && !host.online && <p className="info">{host.error}</p>}</div>;
}
function Recent({ pairs }) {
  const entries = pairs.flatMap(p => p.sides.flatMap(s => (s.repo?.recent || []).map(c => ({ ...c, project: p.name, host: s.host })))).sort((a, b) => a.ageSeconds - b.ageSeconds);
  const unique = entries.filter((c, i) => entries.findIndex(other => other.hash === c.hash && other.project === c.project) === i);
  const today = [...new Set(entries.filter(c => c.ageSeconds < 86400).map(c => c.project))];
  const week = [...new Set(entries.map(c => c.project))];
  return <><p><b>24h</b> {today.join(' · ') || 'no commits observed'} <span className="info">/ 7d {week.length} projects · {unique.length} unique commits collected · showing latest {Math.min(unique.length, 3)} (collection limit: 50 commits per repository per host)</span></p>
    {unique.slice(0, 3).map(c => <p key={`${c.project}-${c.hash}`}><span className="info">{age(c.ageSeconds)}</span> · {c.project} · {short(c.hash)} {c.subject}</p>)}
    <p className="info">dirty: {pairs.filter(p => p.dirty).map(p => p.name).join(' · ') || 'none'}</p>
    {pairs.flatMap(p => p.sides.filter(s => s.sessions.length).map(s => <p key={`${p.name}-${s.host}`}>Zellij {s.host} · {p.name} · {s.sessions.join(', ')} · {s.repo.path}</p>)).slice(0, 3)}</>;
}
function Main({ hosts, pairs, inspect, open }) {
  const babel = hosts.find(h => h.host === 'babel');
  const attention = [...hosts.filter(h => !h.online).map(h => ({ text: `${h.host} unavailable`, tab: 0 })),
    ...(babel?.services || []).filter(s => ['failed', 'degraded'].includes(s.state)).map(s => ({ text: s.diagnosis, tab: 2 })),
    ...pairs.filter(p => p.state === 'diverged' || p.sides.some(s => s.repo?.behind || s.repo?.level === 'error')).map(p => ({ text: `${p.name} ${p.state === 'diverged' ? 'diverged' : p.sides.some(s => s.repo?.level === 'error') ? 'repository check failed' : 'behind upstream'}`, tab: 1 }))].slice(0, 3);
  return <div className="main-view"><Section title="Hosts"><div className="two-col">{['babel', 'waka'].map(name => <HostSummary key={name} name={name} host={hosts.find(h => h.host === name)} />)}</div><p>{runningConfigComparison(hosts)}</p></Section>
    <Section title="Projects" className="main-projects"><div className="project-row table-heading"><span>repository</span><span>babel</span><span>waka</span><span>relationship</span></div>{pairs.slice(0, 6).map(p => <button className="project-row" key={p.name} onClick={() => inspect(p.name)}><b>{p.name}</b>{p.sides.map(s => <CompactRepo side={s} key={s.host} />)}<span className={p.level}>{p.level === 'ok' ? '✓' : '›'} {p.state}</span></button>)}{pairs.length > 6 && <button onClick={() => open(1)}>+ {pairs.length - 6} more</button>}</Section>
    <div className="bottom-grid"><Section title="Recent work"><Recent pairs={pairs} /></Section><Section title="Attention">{attention.length ? attention.map((a, i) => <p key={i}><button className="warning" onClick={() => open(a.tab)}>! {a.text}</button></p>) : <p className={hosts.length ? 'ok' : 'info'}>{hosts.length ? '✓ No actionable failures observed' : 'Waiting for host evidence'}</p>}</Section></div></div>;
}
function RepoSide({ side, nixos }) {
  const r = side.repo;
  return <div><h3>{side.host} <span className="info">{r?.branch || '—'}</span></h3>{!r?.lastCommit ? <p className="info">{!side.online ? 'Host unavailable' : r?.detail || 'Repository unavailable'}</p> : <><p><b>{short(r.lastCommit.hash)}</b> · {age(r.lastCommit.ageSeconds)}</p><p className="commit-subject">{r.lastCommit.subject}</p><p><span className={r.dirty ? 'warning' : 'ok'}>{r.staged} staged · {r.unstaged} unstaged · {r.untracked} untracked</span></p><p>{r.upstream || 'no upstream'} · ↑{r.ahead} ↓{r.behind} <span className="info">(local remote-tracking refs)</span></p><p className="info">7d: {r.recent?.length || 0} commits observed · Zellij {side.sessions.join(', ') || 'none'}</p>{r.worktrees?.map(t => <p className={t.level === 'error' ? 'error' : ''} key={t.path}>↳ {t.name} · {t.lastCommit ? `${t.branch} · ${short(t.lastCommit.hash)} · ${t.dirty} changed` : t.detail}</p>)}{nixos && <p className="info">profile gen {side.nixos?.generation || '—'} · deployed {short(side.nixos?.deployedRevision)} · {side.nixos?.specialization || 'profile unknown'}</p>}</>}</div>;
}
function Projects({ pairs, inspect }) {
  const [filter, setFilter] = useState('all');
  const filtered = pairs.filter(p => filter === 'all' || (filter === 'diverged' ? p.state === 'diverged' : p[filter]));
  return <><div className="toolbar">{['all', 'active', 'dirty', 'diverged', 'config'].map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>[{f}]</button>)}</div>{[false, true].map(configuration => <Section key={String(configuration)} title={configuration ? 'Config' : 'Projects'}>{filtered.filter(p => p.config === configuration).map(p => <article className="project-detail" key={p.name}><header><button onClick={() => inspect(p.name)}>{p.name}</button><b className={p.level}>{p.state}</b></header><div className="two-col">{p.sides.map(s => <RepoSide key={s.host} side={s} nixos={p.nixos} />)}</div><footer><span className={p.level}>{p.conclusion}</span>{p.primary && <span className="info"> Likely primary workspace: {p.primary} (commits, dirty state, sessions).</span>} <button onClick={() => inspect(p.name)}>inspect files / activity ↓</button></footer></article>)}{!filtered.some(p => p.config === configuration) && <p className="info">No matching repositories.</p>}</Section>)}</>;
}
function Desktop({ babel, refresh }) {
  const [selected, setSelected] = useState('SillyTavern');
  const services = babel?.services || [], service = services.find(s => s.name === selected) || services[0];
  return <><Section title="Desktop — babel"><div className="overview">{babel?.gpus?.map(g => <p key={g.name}><b>GPU</b> {g.usedGiB.toFixed(1)}/{g.totalGiB.toFixed(1)} GiB · {g.utilization ?? '—'}% · {g.temperature ?? '—'}°C {g.usedGiB / g.totalGiB >= .9 && <span className="error">! GPU nearly exhausted</span>}</p>)}<p>loaded model: {babel?.ai?.models?.join(', ') || 'not detected'} · llama PID {babel?.ai?.processes?.map(p => p.pid).join(', ') || '—'}</p>{services.filter(s => s.url).map(s => <p key={s.name}><b>{s.name}</b> <span className={stateTone(s.state)}>{s.state}</span> · {s.url}</p>)}</div></Section><div className="desktop-grid"><Section title="Services">{services.map(s => <button className={`service-choice ${s.name === service?.name ? 'selected' : ''}`} aria-pressed={s.name === service?.name} onClick={() => setSelected(s.name)} key={s.name}><span>{s.name}</span><span className={stateTone(s.state)}>{s.state}</span></button>)}<button onClick={refresh}>[run checks]</button></Section><Section title={service ? `${service.name} — dependency chain` : 'Dependency chain'}>{service ? <><p className={`diagnosis ${stateTone(service.state)}`}>{service.diagnosis}</p><Check name="babel reachable" value={babel.online} /><Check name={`${service.name} process`} value={service.process} detail={`PID ${service.properties.MainPID || '—'}`} /><Check name="TCP listener" value={service.listening} detail={service.url || `port ${service.port}`} />{service.http != null && <Check name="HTTP endpoint" value={service.http} detail={service.httpDetail} />}{service.backend != null && <><Check name="llama.cpp backend health" value={service.backend} detail={service.backendUrl} /><Check name="loaded model endpoint" value={Boolean(babel.ai?.models?.length)} detail={babel.ai?.modelError || babel.ai?.models?.join(', ')} /><p className="info">Backend probe checks configured llama.cpp endpoint; SillyTavern's own selected backend is not inferred.</p></>}
      <p className="info">{service.unit} · restarts {service.properties.NRestarts || '—'} · last result {service.properties.Result || 'unknown'} · exit {service.properties.ExecMainStatus || '—'}</p><pre>{service.listener || 'No readable listener details'}</pre><details><summary>systemctl essentials / recent journal</summary><pre>{service.raw}</pre><pre>{service.journal || 'Journal evidence unavailable'}</pre></details>
    </> : <p className="info">{babel?.error || 'Waiting for Babel service evidence.'}</p>}<h3>GPU process memory — AMD / ROCm</h3>{babel?.ai?.gpuProcesses?.map(p => <p key={p.pid}>{p.name} · PID {p.pid} <b>{p.vramGiB.toFixed(2)} GiB</b></p>)}<p className="info">{babel?.ai?.memoryError}</p></Section></div></>;
}
function Inspector({ pair, close }) {
  if (!pair) return null;
  return <aside className="inspector" aria-label={`${pair.name} inspector`}><header><b>{pair.name} — files / recent activity</b><button onClick={close}>[close · Esc]</button></header><div className="two-col">{pair.sides.map(s => <div key={s.host}><h3>{s.host} · {s.repo?.path || 'unavailable'}</h3>{[s.repo, ...(s.repo?.worktrees || [])].filter(Boolean).map(r => <div key={r.path || r.name}><p>{r.name} · {r.detail}</p>{r.changes?.map((c, i) => <pre key={i}>{c.status} {c.path}</pre>)}{r.recent?.slice(0, 10).map(c => <p className="info" key={c.hash}>{short(c.hash)} {age(c.ageSeconds)} · {c.subject}</p>)}</div>)}</div>)}</div></aside>;
}
export default function Dashboard() {
  const [data, setData] = useState(null), [connected, setConnected] = useState(false), [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState(0), [inspected, setInspected] = useState(null);
  useEffect(() => { const source = new EventSource('/api/status'); source.onmessage = event => { setData(JSON.parse(event.data)); setConnected(true); }; source.onerror = () => setConnected(false); return () => source.close(); }, [attempt]);
  useEffect(() => { const key = event => { if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return; if (/^[1-3]$/.test(event.key)) { setTab(Number(event.key) - 1); setInspected(null); } if (event.key === 'Escape') setInspected(null); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  const hosts = data?.hosts || [], pairs = projectPairs(hosts, config);
  const open = index => { setTab(index); setInspected(null); };
  const refresh = () => { setConnected(false); setAttempt(n => n + 1); };
  return <main><header className="shell-header"><nav aria-label="Dashboard views">{tabs.map((name, i) => <button key={name} aria-current={tab === i ? 'page' : undefined} onClick={() => open(i)}>[{i + 1} {name}]</button>)}</nav><span className="info">babel / waka <span className={connected ? 'ok' : 'warning'}>● {connected ? 'live' : data ? 'stale · reconnecting' : 'connecting'}</span> · {data ? new Date(data.updatedAt).toLocaleTimeString() : '—'} <button onClick={refresh}>↻</button></span></header>
    <div className="view">{tab === 0 ? <Main hosts={hosts} pairs={pairs} inspect={setInspected} open={open} /> : tab === 1 ? <Projects pairs={pairs} inspect={setInspected} /> : <Desktop babel={hosts.find(h => h.host === 'babel')} refresh={refresh} />}</div><Inspector pair={pairs.find(p => p.name === inspected)} close={() => setInspected(null)} /><footer className="shell-footer">1–3 switch views · select project for inspector · Esc close <span>read-only evidence · no fetch / deploy / restart</span></footer></main>;
}
