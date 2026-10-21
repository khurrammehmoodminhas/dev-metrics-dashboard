const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** A client error with an HTTP status; transports send it as `{ ok: false, error }`. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * CSRF guard for the write endpoints. A cross-site HTML form can only send
 * form/text content types (JSON needs a CORS preflight this app never grants),
 * and browsers mark cross-site requests via Sec-Fetch-Site — Basic auth
 * credentials would otherwise be re-sent automatically.
 */
function assertSameOriginJson(req) {
  const headers = req.headers ?? {};
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Cross-site requests are not allowed.');
  }
  const contentType = String(headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, 'Request body must be sent as application/json.');
  }
}

/**
 * Reads and parses a JSON request body. Works for both Node's raw `http`
 * server and Vercel functions (which may have already parsed `req.body`).
 * Rejects bodies over `maxBytes` before buffering them, and anything that is
 * not a same-origin JSON request (see assertSameOriginJson).
 */
export function readJsonBody(req, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  try {
    assertSameOriginJson(req);
  } catch (error) {
    return Promise.reject(error);
  }
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string') {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new HttpError(400, 'Request body is not valid JSON.'));
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBytes) {
        reject(new HttpError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        return resolve(JSON.parse(body));
      } catch {
        return reject(new HttpError(400, 'Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** `?releases=a,b&releases=c` → ['a', 'b', 'c'] */
export function parseReleasesQuery(url) {
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams
    .getAll('releases')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}
