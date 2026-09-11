import { get, put } from '@vercel/blob';

const SNAPSHOT_PATH = 'dev-metrics-dashboard/dashboard-bundle.json';

function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set. Connect a private Vercel Blob store to this project.');
  }
}

export async function readDashboardSnapshot() {
  assertBlobConfigured();
  const result = await get(SNAPSHOT_PATH, { access: 'private', useCache: false });
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text());
}

export async function writeDashboardSnapshot(bundle) {
  assertBlobConfigured();
  await put(SNAPSHOT_PATH, JSON.stringify(bundle), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8',
  });
}
