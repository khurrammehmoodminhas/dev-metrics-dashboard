import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, put } from '@vercel/blob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOB_PATH = 'dev-metrics-dashboard/review-logs.json';

// Local durable path (not wiped by dashboard generation). On Vercel the
// deployment FS is read-only, so we prefer Blob when configured and fall back
// to /tmp only as a best-effort warm-instance cache.
const runtimeRoot = process.env.VERCEL
  ? path.join('/tmp', 'dev-metrics-dashboard')
  : path.join(__dirname, '..', '..', 'data');

// Resolved lazily so tests can redirect the durable local file via
// REVIEW_LOGS_FILE before calling any store function.
function getLocalPath() {
  return process.env.REVIEW_LOGS_FILE
    ? process.env.REVIEW_LOGS_FILE
    : path.join(runtimeRoot, 'cache', 'review-logs.json');
}

function emptyStore() {
  return { version: 1, updated_at: null, logs_by_issue: {} };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readLocalStore() {
  const localPath = getLocalPath();
  if (!fs.existsSync(localPath)) return emptyStore();
  const raw = fs.readFileSync(localPath, 'utf8');
  if (!raw.trim()) return emptyStore();
  try {
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      updated_at: parsed.updated_at ?? null,
      logs_by_issue: parsed.logs_by_issue && typeof parsed.logs_by_issue === 'object'
        ? parsed.logs_by_issue
        : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeLocalStore(store) {
  const localPath = getLocalPath();
  ensureDir(path.dirname(localPath));
  fs.writeFileSync(localPath, JSON.stringify(store, null, 2));
}

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobStore() {
  const result = await get(BLOB_PATH, { access: 'private', useCache: false });
  if (!result) return emptyStore();
  const parsed = JSON.parse(await new Response(result.stream).text());
  return {
    version: 1,
    updated_at: parsed.updated_at ?? null,
    logs_by_issue: parsed.logs_by_issue && typeof parsed.logs_by_issue === 'object'
      ? parsed.logs_by_issue
      : {},
  };
}

async function writeBlobStore(store) {
  await put(BLOB_PATH, JSON.stringify(store), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8',
  });
}

/**
 * Loads the durable review-log store. Prefer Vercel Blob when available so
 * logs survive across serverless instances; otherwise use the local file.
 */
export async function readReviewLogStore() {
  if (blobConfigured()) {
    try {
      return await readBlobStore();
    } catch (error) {
      // Fall through to local/tmp so a transient Blob outage doesn't block the UI.
      if (!process.env.VERCEL) throw error;
    }
  }
  return readLocalStore();
}

export async function writeReviewLogStore(store) {
  const next = {
    version: 1,
    updated_at: new Date().toISOString(),
    logs_by_issue: store.logs_by_issue ?? {},
  };
  if (blobConfigured()) {
    try {
      await writeBlobStore(next);
    } catch (error) {
      if (!process.env.VERCEL) throw error;
      // Still write local/tmp as a fallback on Vercel.
      writeLocalStore(next);
      return next;
    }
  }
  writeLocalStore(next);
  return next;
}

export function listLogsForIssue(store, issueKey) {
  const logs = store?.logs_by_issue?.[issueKey];
  return Array.isArray(logs) ? logs.slice() : [];
}

export function createReviewLogId() {
  return `rvw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
