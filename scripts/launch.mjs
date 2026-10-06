import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, access, stat } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../dashboard.config.json' with { type: 'json' };

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = 'http://127.0.0.1:7582';
const quote = value => `"${value.replace(/[\\"$`]/g, '\\$&')}"`;

if (process.argv.includes('--install')) {
  const directory = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'applications');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'host-dashboard.desktop');
  await writeFile(path, `[Desktop Entry]\nType=Application\nName=Host Dashboard\nComment=Live ${config.hosts.map(host => host.name).join(' and ')} status\nExec=${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}\nIcon=utilities-terminal\nTerminal=false\nCategories=System;Monitor;\n`);
  console.log(`Installed ${path}`);
} else {
  try {
    const ready = async () => {
      try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; }
      catch { return false; }
    };
    if (!await ready()) {
      await access(join(root, '.next/BUILD_ID'));
      const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'host-dashboard');
      await mkdir(cache, { recursive: true });
      const logPath = join(cache, 'server.log');
      const log = openSync(logPath, 'a', 0o600);
      const standalone = await stat(join(root, 'server.js')).then(() => true, () => false);
      const args = standalone ? [join(root, 'server.js')]
        : [join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '7582'];
      if (!process.argv.includes('--no-browser')) args.unshift('--import', join(root, 'scripts/server-lifecycle.mjs'));
      const child = spawn(process.execPath, args,
        { cwd: root, env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '7582' }, detached: true, stdio: ['ignore', log, log] });
      closeSync(log);
      child.unref();
      for (let i = 0; i < 60 && !await ready(); i++) await new Promise(resolve => setTimeout(resolve, 500));
      if (!await ready()) throw new Error(`Server did not start. Check ${logPath}`);
    }
    if (!process.argv.includes('--no-browser')) {
      try { execFileSync('librewolf', ['--new-tab', url], { stdio: 'ignore' }); }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error(`LibreWolf wasn't found on your PATH. Please install it or open ${url} in your browser. The dashboard server is running`);
        throw new Error(`LibreWolf couldn't open the dashboard. You can open ${url} manually`);
      }
    }
  } catch (error) {
    console.error(`Dashboard launch failed: ${error.message}`);
    process.exitCode = 1;
  }
}
