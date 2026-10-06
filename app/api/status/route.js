import { snapshot } from '../../../lib/status.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  let stopped = false;
  let timer;
  let disconnect;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    disconnect?.();
  };
  const stream = new ReadableStream({
    start(controller) {
      disconnect = globalThis.dashboardConnect?.();
      request.signal.addEventListener('abort', () => {
        stop();
        try { controller.close(); } catch {}
      }, { once: true });
      if (request.signal.aborted) { stop(); controller.close(); return; }
      const tick = async () => {
        const start = Date.now();
        const data = await snapshot();
        if (stopped) return;
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { stop(); return; }
        timer = setTimeout(tick, Math.max(0, 2000 - (Date.now() - start)));
      };
      void tick();
    },
    cancel: stop,
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
