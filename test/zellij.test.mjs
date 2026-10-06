import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessions } from '../lib/zellij.mjs';

test('Zellij output becomes named rows with compact ages and distinct states', () => {
  assert.deepEqual(parseSessions('\x1b[32mcomfy\x1b[0m [Created 1month 2days 26m 48s ago] (EXITED - attach to resurrect)\npebble [Created 1day 10h 48m 8s ago] (current)\nfuse [Created 10h 57m 38s ago]\n\n'), [
    { name: 'comfy', age: '1mo 2d 26m 48s', state: 'exited' },
    { name: 'pebble', age: '1d 10h 48m 8s', state: 'current' },
    { name: 'fuse', age: '10h 57m 38s', state: 'active' },
  ]);
  assert.deepEqual(parseSessions('Unexpected output'), [{ name: 'Unexpected output', age: '', state: 'unknown' }]);
  assert.deepEqual(parseSessions(''), []);
});
