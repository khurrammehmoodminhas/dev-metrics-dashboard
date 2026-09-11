import { generateDashboard } from './index.js';
import { readDashboardSnapshot, writeDashboardSnapshot } from './cache/dashboardSnapshot.js';

export async function refreshDashboard() {
  const bundle = await generateDashboard({ writeOutput: false });
  await writeDashboardSnapshot(bundle);
  return bundle;
}

export async function getLatestDashboard() {
  const cachedBundle = await readDashboardSnapshot();
  return cachedBundle ?? refreshDashboard();
}
