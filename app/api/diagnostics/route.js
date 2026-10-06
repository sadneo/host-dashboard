import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { collectionCommand } from '../../../lib/status.mjs';
import config from '../../../dashboard.config.json' with { type: 'json' };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const host = new URL(request.url).searchParams.get('host') || 'waka';
  if (!config.hosts.some(h => h.name === host)) return new Response('Unknown host', { status: 400 });
  const script = await readFile(/* turbopackIgnore: true */ new URL('../../../scripts/diagnose-network.mjs', import.meta.url), 'utf8');
  let child;
  const stream = new ReadableStream({
    start(controller) {
      const send = data => { try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {} };
      const { command, args } = collectionCommand(host);
      child = execFile(command, args, { timeout: 180000, maxBuffer: 2 * 1024 * 1024 }, error => {
        if (error && !request.signal.aborted) send({ type: 'error', error: error.message });
        try { controller.close(); } catch {}
      });
      let buffer = '';
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try { send(JSON.parse(line)); } catch { send({ type: 'error', error: `Invalid diagnostic output: ${line}` }); }
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(`process.env.DASHBOARD_CONFIG_JSON = ${JSON.stringify(JSON.stringify(config))};\n${script}`);
      request.signal.addEventListener('abort', () => child.kill(), { once: true });
      if (request.signal.aborted) child.kill();
    },
    cancel() { child?.kill(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}
