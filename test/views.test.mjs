import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPairs, runningConfigComparison } from '../lib/dashboard.mjs';

const configuration = { projects: [{ name: 'project' }], configRepos: [{ name: 'nixos', nixos: true }] };
test('running config comparison requires deployed revisions, not matching repository HEADs', () => {
  const data = ['babel', 'waka'].map(host => ({ host, online: true, health: { nixos: {} } }));
  assert.match(runningConfigComparison(data), /unknown.*babel and waka/);
  for (const h of data) h.health.nixos.deployedRevision = 'a'.repeat(40);
  assert.match(runningConfigComparison(data), /same source commit/);
  data[1].health.nixos.deployedRevision = 'b'.repeat(40);
  assert.match(runningConfigComparison(data), /different source commits/);
  data[1].health.nixos.deployedRevision = 'dirty';
  assert.match(runningConfigComparison(data), /unknown/);
  data[1].online = false;
  assert.match(runningConfigComparison(data), /both hosts must be online/);
});
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
