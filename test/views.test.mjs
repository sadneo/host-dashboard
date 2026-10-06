import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPairs, networkDiagnosis, diagnosticSummary } from '../lib/dashboard.mjs';
import { createServer } from 'node:net';
import { queryDNS } from '../scripts/diagnose-network.mjs';

const configuration = { projects: [{ name: 'project' }], configRepos: [{ name: 'nixos', nixos: true }] };
const repo = (hash, history, dirty = 0) => ({ name: 'project', path: '/work/project', lastCommit: { hash }, history, dirty, recent: [], worktrees: [] });
const hosts = (a, b) => [a, b].map((r, i) => ({ host: i ? 'waka' : 'babel', online: true, projects: r ? [r] : [], configRepos: [], zellij: { directories: {} } }));
test('cross-host comparisons use actual ancestry and do not guess from upstream counts', () => {
  const a = repo('a', ['a', 'base']), b = repo('b', ['b', 'base']);
  assert.equal(projectPairs(hosts(a, a), configuration)[0].state, 'synced');
  assert.equal(projectPairs(hosts(a, { ...a, dirty: 1 }), configuration)[0].state, 'active on waka');
  assert.equal(projectPairs(hosts({ ...a, history: ['a', 'b', 'base'] }, b), configuration)[0].state, 'active on babel');
  assert.equal(projectPairs(hosts(a, b), configuration)[0].state, 'diverged');
  assert.equal(projectPairs(hosts(a, repo('x', ['x'])), configuration)[0].state, 'different HEADs');
  assert.equal(projectPairs(hosts({ ...a, dirty: 1 }, { ...a, dirty: 1 }), configuration)[0].state, 'work exists on both');
  assert.equal(projectPairs(hosts(a, undefined), configuration)[0].state, 'comparison unavailable');
  assert.equal(projectPairs(hosts(a, b), configuration)[1].config, true);
});
test('workspace evidence matches cwd boundaries and excludes exited sessions', () => {
  const data = hosts(repo('a', ['a']), repo('a', ['a']));
  data[0].zellij.directories = { active: { paths: ['/work/project/src'] }, unrelated: { paths: ['/work/project-extra'] }, exited: { paths: ['/work/project'], saved: true } };
  const pair = projectPairs(data, configuration)[0];
  assert.deepEqual(pair.sides[0].sessions, ['active']);
  assert.equal(pair.primary, 'babel');
});
test('DoT diagnosis requires configured-resolver evidence; report preserves all raw failures', () => {
  const result = (id, status, stdout = '') => ({ id, status, stdout, stderr: status === 'failed' ? 'connection refused' : '', phase: 6, command: id, durationMs: 20 });
  const evidence = [result('ipv4-tcp', 'passed'), result('system-a', 'failed'), result('udp-1.1.1.1', 'passed', 'answer'), result('public-dot', 'failed')];
  assert.match(networkDiagnosis(evidence)[0], /system DNS/);
  evidence.push(result('resolver-config', 'passed', 'Protocols: +DNSOverTLS'), result('configured-dot', 'failed'));
  assert.match(networkDiagnosis(evidence)[0], /DNS-over-TLS appears blocked/);
  const report = diagnosticSummary({ host: 'waka', timestamp: 'now', complete: true, results: evidence });
  assert.match(report, /configured-dot — FAILED \(20ms\)/);
  assert.match(report, /stderr: connection refused/);
  assert.match(networkDiagnosis([result('ipv4-tcp', 'passed'), result('system-a', 'passed'), result('https', 'passed')])[0], /Network healthy/);
  assert.match(networkDiagnosis([result('portal', 'passed', 'HTTP\/1.1 302 Found')])[0], /Captive portal suspected/);
});

test('DNS TCP probe handles fragmented responses and rejects an error answer', async () => {
  let failure = false;
  const server = createServer(socket => socket.once('data', packet => {
    const response = Buffer.from(packet);
    response[4] |= 0x80;
    response[5] = failure ? 3 : 0x80;
    response.writeUInt16BE(failure ? 0 : 1, 8);
    socket.write(response.subarray(0, 1));
    setTimeout(() => socket.end(response.subarray(1)), 10);
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    assert.equal((await queryDNS('127.0.0.1', 'A', 'tcp', undefined, port)).status, 'passed');
    failure = true;
    const failed = await queryDNS('127.0.0.1', 'AAAA', 'tcp', undefined, port);
    assert.equal(failed.status, 'failed');
    assert.match(failed.stdout, /RCODE=3/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
