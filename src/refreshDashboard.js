import { generateDashboard } from './index.js';
import { readDashboardSnapshot, writeDashboardSnapshot } from './cache/dashboardSnapshot.js';

/** Regenerates the bundle and stores it as the durable snapshot (Vercel). */
export async function refreshDashboard({ onProgress } = {}) {
  const bundle = await generateDashboard({ writeOutput: false, onProgress });
  await writeDashboardSnapshot(bundle);
  return bundle;
}

/** The last stored snapshot, generating one if none exists yet. */
export async function getLatestDashboard() {
  const cachedBundle = await readDashboardSnapshot();
  return cachedBundle ?? refreshDashboard();
}
