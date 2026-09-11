import { answerAssistantQuestion, applyAssistantUpdate } from '../src/ai/assistant.js';
import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard, refreshDashboard } from '../src/refreshDashboard.js';

export default async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }

  try {
    const body = req.body ?? {};
    const bundle = await getLatestDashboard();
    if (body.confirm) {
      const action = await applyAssistantUpdate(body.confirm, bundle, refreshDashboard);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, action }));
      return;
    }
    const result = await answerAssistantQuestion(bundle, Array.isArray(body.messages) ? body.messages : []);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}