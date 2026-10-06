import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { hostname, release } from 'node:os';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Resolver } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

const results = [];
const emit = value => console.log(JSON.stringify(value));
const run = (command, args) => new Promise(resolve => execFile(command, args, { timeout: 5000, maxBuffer: 128 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => resolve({ status: error?.code === 'ENOENT' ? 'unavailable' : error ? 'failed' : 'passed', stdout: stdout.trim(), stderr: (stderr || error?.message || '').trim() })));
const read = async path => { try { return await readFile(path, 'utf8'); } catch { return 'unavailable'; } };
const socketTest = (host, port, tls = false, servername) => new Promise(resolve => {
  const socket = tls ? tlsConnect({ host, port, servername, rejectUnauthorized: true }) : createConnection({ host, port });
  const finish = (status, detail) => { socket.destroy(); resolve({ status, stdout: detail, stderr: status === 'failed' ? detail : '' }); };
  socket.setTimeout(4000); socket.once(tls ? 'secureConnect' : 'connect', () => finish('passed', `${host}:${port}${tls ? ` TLS ${socket.getProtocol()}` : ' connected'}`));
  socket.once('error', error => finish('failed', error.message)); socket.once('timeout', () => finish('failed', 'Timed out'));
});
export async function queryDNS(server, type, protocol, servername, port = protocol === 'dot' ? 853 : 53) {
  if (protocol === 'udp') {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers([server]);
    try { const answers = await (type === 'AAAA' ? resolver.resolve6('example.com') : resolver.resolve4('example.com')); return { status: answers.length ? 'passed' : 'failed', stdout: answers.join('\n'), stderr: '' }; }
    catch (error) { return { status: 'failed', stdout: '', stderr: error.message }; }
  }
  // ponytail: fixed diagnostic hostname, report the DNS header and raw response rather than implement a general DNS decoder.
  const question = Buffer.from([7, ...Buffer.from('example'), 3, ...Buffer.from('com'), 0, 0, type === 'AAAA' ? 28 : 1, 0, 1]);
  const header = Buffer.from([0xda, 0x5a, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  const packet = Buffer.concat([header, question]);
  const prefix = Buffer.alloc(2); prefix.writeUInt16BE(packet.length);
  return new Promise(resolve => {
    const tls = protocol === 'dot';
    const socket = tls ? tlsConnect({ host: server, port, servername, rejectUnauthorized: true }) : createConnection({ host: server, port });
    let finished = false;
    const finish = (status, stdout, stderr = '') => { if (finished) return; finished = true; socket.destroy(); resolve({ status, stdout, stderr }); };
    let data = Buffer.alloc(0);
    socket.setTimeout(4000);
    socket.once(tls ? 'secureConnect' : 'connect', () => socket.write(Buffer.concat([prefix, packet])));
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 65537) return finish('failed', '', 'Oversized DNS response');
      if (data.length < 2 || data.length < data.readUInt16BE(0) + 2) return;
      const body = data.subarray(2, data.readUInt16BE(0) + 2);
      if (body.length < 12 || body.readUInt16BE(0) !== 0xda5a || !(body[2] & 0x80)) return finish('failed', '', 'Invalid DNS response');
      const code = body[3] & 15, answers = body.readUInt16BE(6);
      finish(code === 0 && answers > 0 ? 'passed' : 'failed', `example.com ${type}: RCODE=${code}, answers=${answers}\nresponse hex: ${body.toString('hex')}`);
    });
    socket.once('error', error => finish('failed', '', error.message));
    socket.once('timeout', () => finish('failed', '', 'DNS query timed out'));
    socket.once('end', () => finish('failed', '', 'Resolver closed before a complete DNS response'));
  });
}
async function check(phase, id, command, action) {
  emit({ type: 'running', phase, id, command });
  const start = Date.now();
  let output;
  try { output = await action(); } catch (error) { output = { status: 'failed', stdout: '', stderr: error.message }; }
  const result = { phase, id, command, ...output, durationMs: Date.now() - start };
  results.push(result); emit({ type: 'result', result }); return result;
}
const cmd = (phase, id, command, args) => check(phase, id, [command, ...args].join(' '), () => run(command, args));
async function diagnostics() {
const phases = ['Environment', 'Link', 'Addressing', 'Local network', 'Raw internet', 'DNS configuration', 'DNS functionality', 'HTTPS / TLS', 'Pathological cases', 'Your infrastructure', 'Derived diagnosis'];
const config = JSON.parse(process.env.DASHBOARD_CONFIG_JSON || '{}');
emit({ type: 'start', phases, timestamp: new Date().toISOString(), host: hostname() });
await check(0, 'environment', 'hostname / kernel / generation / specialization / timestamp', async () => {
  const cmdline = await read('/proc/cmdline');
  const profile = await readlink('/nix/var/nix/profiles/system').catch(() => 'unavailable');
  let specialization = (await read('/etc/specialisation')).trim();
  if (specialization === 'unavailable') specialization = (await read('/run/current-system/specialisation-name')).trim();
  if (specialization === 'unavailable') specialization = cmdline.match(/(?:specialisation|specialization)=([^ ]+)/)?.[1] || 'unknown';
  return { status: 'passed', stdout: `host: ${hostname()}\nkernel: ${release()}\ngeneration: ${profile}\nprofile: ${specialization}\ncmdline: ${cmdline.trim()}\ntimestamp: ${new Date().toISOString()}`, stderr: '' };
});
const routes = await run('ip', ['-j', 'route', 'show']);
let route;
try { route = JSON.parse(routes.stdout).find(r => r.dst === 'default'); } catch {}
await cmd(1, 'link', 'ip', ['-details', 'link', 'show']);
if (route?.dev) await cmd(1, 'wifi', 'iw', ['dev', route.dev, 'link']);
else await check(1, 'wifi', 'Wi-Fi association', async () => ({ status: 'unavailable', stdout: 'No default-route interface detected', stderr: '' }));
await cmd(1, 'nm-wifi', 'nmcli', ['-f', 'ACTIVE,SSID,BSSID,SIGNAL', 'dev', 'wifi', 'list', '--rescan', 'no']);
await cmd(2, 'addresses', 'ip', ['address', 'show']);
await cmd(2, 'routes', 'ip', ['-j', 'route', 'show']);
await cmd(2, 'ipv6-routes', 'ip', ['-6', 'route', 'show']);
await cmd(2, 'dhcp', 'networkctl', ['status', '--no-pager']);
await cmd(2, 'nm-addresses', 'nmcli', ['-f', 'GENERAL,IP4,IP6,DHCP4,DHCP6', 'dev', 'show']);
if (route?.gateway) await cmd(3, 'gateway', 'ping', ['-c', '1', '-W', '2', route.gateway]);
else await check(3, 'gateway', 'Gateway ping', async () => ({ status: 'failed', stdout: '', stderr: 'No default gateway detected' }));
await cmd(3, 'neighbors', 'ip', ['neigh', 'show']);
await cmd(4, 'ipv4-ping', 'ping', ['-c', '1', '-W', '2', '1.1.1.1']);
await check(4, 'ipv4-tcp', 'TCP 1.1.1.1:443 (no DNS)', () => socketTest('1.1.1.1', 443));
const v6 = await run('ip', ['-6', 'route', 'show', 'default']);
if (v6.status === 'passed' && v6.stdout) {
  await cmd(4, 'ipv6-ping', 'ping', ['-6', '-c', '1', '-W', '2', '2606:4700:4700::1111']);
  await check(4, 'ipv6-tcp', 'TCP [2606:4700:4700::1111]:443', () => socketTest('2606:4700:4700::1111', 443));
} else await check(4, 'ipv6-tcp', 'IPv6 internet', async () => ({ status: 'skipped', stdout: 'No IPv6 default route', stderr: '' }));
await check(5, 'resolv-conf', 'cat /etc/resolv.conf', async () => { const stdout = await read('/etc/resolv.conf'); return { status: stdout === 'unavailable' ? 'unavailable' : 'passed', stdout, stderr: '' }; });
const resolver = await cmd(5, 'resolver-config', 'resolvectl', ['status', '--no-pager']);
await cmd(6, 'system-a', 'getent', ['ahostsv4', 'example.com']);
await cmd(6, 'system-aaaa', 'getent', ['ahostsv6', 'example.com']);
for (const server of ['1.1.1.1', '8.8.8.8']) {
  for (const type of ['A', 'AAAA']) for (const protocol of ['udp', 'tcp']) {
    await check(6, `${protocol}-${server}${type === 'AAAA' ? '-aaaa' : ''}`, `DNS ${protocol.toUpperCase()}/53 ${server} example.com ${type}`, () => queryDNS(server, type, protocol));
  }
}
// Probe the actual configured resolver when resolvectl exposes it; the public comparison is always labelled separately.
const configured = resolver.stdout.match(/Current DNS Server:\s*([^\s]+)/)?.[1];
if (configured && /^[0-9a-fA-F:.]+(?:#[a-zA-Z0-9.-]+)?$/.test(configured)) {
  const [address, sni] = configured.split('#');
  await check(6, 'configured-dot', `TLS ${address}:853 configured resolver`, () => socketTest(address, 853, true, sni));
  await check(6, 'configured-dot-query', `DNS DoT/853 ${address} example.com A`, () => queryDNS(address, 'A', 'dot', sni));
}
await check(6, 'public-dot', 'TLS 1.1.1.1:853 SNI cloudflare-dns.com (comparison)', () => socketTest('1.1.1.1', 853, true, 'cloudflare-dns.com'));
await check(6, 'public-dot-query', 'DNS DoT/853 1.1.1.1 example.com A SNI cloudflare-dns.com', () => queryDNS('1.1.1.1', 'A', 'dot', 'cloudflare-dns.com'));
await check(7, 'tls', 'TLS 1.1.1.1:443 SNI one.one.one.one', () => socketTest('1.1.1.1', 443, true, 'one.one.one.one'));
await cmd(7, 'https', 'curl', ['--max-time', '4', '--fail', '-sS', '-D', '-', '-o', '/dev/null', 'https://example.com']);
await cmd(7, 'portal', 'curl', ['--max-time', '4', '-sS', '-D', '-', 'http://connectivitycheck.gstatic.com/generate_204']);
await cmd(8, 'pmtu', 'tracepath', ['-n', '1.1.1.1']);
await cmd(8, 'mtu-probe', 'ping', ['-c', '1', '-W', '2', '-M', 'do', '-s', '1472', '1.1.1.1']);
await cmd(9, 'tailscale', 'tailscale', ['status']);
await cmd(9, 'babel-tail', 'tailscale', ['ping', '--c', '1', '--timeout=3s', 'babel']);
await check(9, 'babel-ssh', 'TCP babel:22', () => socketTest('babel', 22));
for (const service of config.services || []) if (service.networkUrl) {
  const url = new URL(service.networkUrl);
  await cmd(9, `babel-${service.name}`, 'curl', ['--max-time', '3', '--fail', '-sS', '-o', '/dev/null', url.href]);
}
emit({ type: 'complete', results });
}
if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) await diagnostics();
