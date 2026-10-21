import { handleRefresh } from './handlers.js';

export async function sendRefreshStream(res, refresh) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });

  let ended = false;
  const sendEvent = (event) => {
    if (!ended) res.write(`${JSON.stringify(event)}\n`);
  };
  const result = await handleRefresh({
    refresh,
    onProgress: (message) => sendEvent({ type: 'progress', message }),
  });
  sendEvent({ type: 'result', ...result.json });
  ended = true;
  res.end();
}
