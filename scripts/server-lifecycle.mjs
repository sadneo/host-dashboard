import { isMainThread } from 'node:worker_threads';

if (isMainThread) {
  let connections = 0;
  let timer = setTimeout(() => process.exit(0), 60000);
  globalThis.dashboardConnect = () => {
    connections++;
    clearTimeout(timer);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      if (--connections === 0) timer = setTimeout(() => process.exit(0), 1000);
    };
  };
}
