import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = 'http://127.0.0.1:3000';
const quote = value => `"${value.replace(/[\\"$`]/g, '\\$&')}"`;

if (process.argv.includes('--install')) {
  const directory = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'applications');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'host-dashboard.desktop');
  await writeFile(path, `[Desktop Entry]\nType=Application\nName=Host Dashboard\nComment=Live babel and waka status\nExec=${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}\nIcon=utilities-terminal\nTerminal=false\nCategories=System;Monitor;\n`);
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
      const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1'],
        { cwd: root, detached: true, stdio: ['ignore', log, log] });
      closeSync(log);
      child.unref();
      for (let i = 0; i < 60 && !await ready(); i++) await new Promise(resolve => setTimeout(resolve, 500));
      if (!await ready()) throw new Error(`Server did not start. Check ${logPath}`);
    }
    execFileSync('firefox', ['--new-tab', url], { stdio: 'ignore' });
  } catch (error) {
    console.error(`Dashboard launch failed: ${error.message}. Run pnpm install && pnpm build first.`);
    process.exitCode = 1;
  }
}
