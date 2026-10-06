import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run with: nix develop --command node test/package-smoke.mjs /nix/store/...-host-dashboard-0.1.0
const pkg = resolve(process.argv[2]);
const url = 'http://127.0.0.1:7582';
assert.equal(await fetch(url).then(() => true, () => false), false, 'Port 7582 must be unused');
const temp = await mkdtemp(join(tmpdir(), 'host-dashboard-smoke-'));
const pidFile = join(temp, 'server.pid');
let pid;
try {
  // Capture only the server started by this check so cleanup cannot stop an existing dashboard.
  const preload = join(temp, 'capture.cjs');
  await writeFile(preload, `if (process.argv[1]?.endsWith('/server.js')) require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`);
  const browserArgs = join(temp, 'browser.json');
  await writeFile(join(temp, 'librewolf'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(browserArgs)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${temp}:${process.env.PATH}`, XDG_CACHE_HOME: temp,
    NODE_OPTIONS: `--require=${preload}` };
  execFileSync(join(pkg, 'bin/host-dashboard'), ['--no-browser'], { cwd: temp, env, timeout: 40000 });
  pid = Number(await readFile(pidFile, 'utf8'));
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]+)"/g)]
    .map(match => match[1].replaceAll('&amp;', '&')).filter(path => path.startsWith('/_next/')))];
  assert(assets.some(path => path.endsWith('.css')), 'Stylesheet missing');
  assert(assets.some(path => path.endsWith('.js')), 'Client script missing');
  for (const path of [...assets, '/fonts/aporetic-serif-regular.ttf']) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 200, path);
    assert((await response.arrayBuffer()).byteLength > 0, path);
  }
  const controller = new AbortController();
  try {
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    let data = '';
    while (!data.includes('\n\n')) data += new TextDecoder().decode((await reader.read()).value);
    const snapshot = JSON.parse(data.split('\n\n')[0].slice('data: '.length));
    assert.equal(snapshot.hosts.length, 2);
    assert(snapshot.hosts.some(host => host.online && host.local), 'Local collection failed');
    console.log('Collection:', snapshot.hosts.map(host => `${host.host}: ${host.online ? 'online' : host.error}`).join('; '));
  } finally { controller.abort(); }
  execFileSync(join(pkg, 'bin/host-dashboard'), [], { cwd: temp, env, timeout: 10000 });
  assert.deepEqual(JSON.parse(await readFile(browserArgs, 'utf8')), ['--new-tab', url]);
  assert.equal(Number(await readFile(pidFile, 'utf8')), pid, 'Second launch started another server');
  assert.throws(() => execFileSync(join(pkg, 'bin/host-dashboard'), [], {
    cwd: temp, env: { ...env, PATH: '/nonexistent' }, stdio: 'pipe', timeout: 10000,
  }), error => error.status === 1 && /LibreWolf wasn't found on your PATH/.test(error.stderr.toString()) && error.stderr.toString().includes(url));
  assert.match(await readFile(join(pkg, 'share/applications/host-dashboard.desktop'), 'utf8'), /Exec=host-dashboard/);
  const reachable = () => fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  const waitForStop = async () => {
    for (let i = 0; i < 100 && await reachable(); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await reachable(), false, 'Server did not stop');
  };
  process.kill(pid, 'SIGTERM');
  await waitForStop();
  const launch = () => {
    execFileSync(join(pkg, 'bin/host-dashboard'), [], { cwd: temp, env, timeout: 40000 });
  };
  const connect = async () => {
    const controller = new AbortController();
    const response = await fetch(`${url}/api/status`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    });
    assert.equal(response.status, 200);
    return controller;
  };
  launch();
  pid = Number(await readFile(pidFile, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert(await reachable(), 'Server stopped before its first tab connected');
  let first = await connect();
  const second = await connect();
  first.abort();
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert(await reachable(), 'Closing one tab stopped another tab');
  second.abort();
  first = await connect();
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert(await reachable(), 'Reconnecting did not cancel shutdown');
  first.abort();
  await waitForStop();
  launch();
  pid = Number(await readFile(pidFile, 'utf8'));
  const reopened = await connect();
  reopened.abort();
  await waitForStop();
  console.log(`PASS: cold launch, server reuse, LibreWolf arguments and missing-browser error, desktop entry, ${assets.length} static assets, font, live collection, startup window, multiple tabs, reconnect, shutdown, and relaunch`);
} finally {
  pid ||= await readFile(pidFile, 'utf8').then(Number, () => null);
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await rm(temp, { recursive: true, force: true });
}
