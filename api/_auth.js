// Re-exported so the Vercel functions and the local server share one auth check.
export { isDashboardAuthorized, requireDashboardAuth } from '../src/http/auth.js';
