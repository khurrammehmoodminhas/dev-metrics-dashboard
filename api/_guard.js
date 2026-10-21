import { ConfigError } from '../src/config/index.js';
import { HttpError } from '../src/http/body.js';
import { sendJson } from '../src/http/respond.js';
import { warn } from '../src/utils/logger.js';

/**
 * Wraps a Vercel handler so a configuration error becomes a readable 503
 * instead of an opaque function crash, a request error (HttpError) its own
 * status, and any other unexpected error a 500.
 */
export function guarded(handler) {
  return async function wrapped(req, res) {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ConfigError) {
        warn(error.message);
        sendJson(res, 503, { ok: false, error: error.message });
        return;
      }
      if (error instanceof HttpError) {
        if (!res.headersSent) sendJson(res, error.status, { ok: false, error: error.message });
        return;
      }
      warn(error.stack ?? error.message);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
      else res.end();
    }
  };
}
