import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderDashboard } from '../../src/dashboard/render.js';

const BASE_BUNDLE = {
  generated_at: '2026-09-21T10:00:00.000Z',
  project_name: 'Acme <Platform>',
  project_key: 'ACME',
  releases: [{ name: '1.2.0', released: false, state: 'active', release_date: null, start_date: null }],
  tickets: {},
  stale_pr_after_days: 14,
  default_selected_releases: [],
  warnings: ['GitHub: could not sync acme/x'],
  features: {
    github: true,
    actualPoints: true,
    aiContribution: true,
    jiraEditing: true,
    reviewLogging: true,
    assistant: true,
  },
};

function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

test('renders the project name, escapes it, and embeds only public data', () => {
  const html = renderDashboard(BASE_BUNDLE);
  assert.ok(html.includes('<title>Acme &lt;Platform&gt; · Delivery &amp; AI Insights</title>'));
  assert.ok(html.includes('id="assistant-launcher"'));
  assert.ok(html.includes('"project_key":"ACME"'));
  assert.ok(!html.includes('</script><script>alert'));
});

test('omits the assistant launcher and script when the assistant is disabled', () => {
  const html = renderDashboard({ ...BASE_BUNDLE, features: { ...BASE_BUNDLE.features, assistant: false } });
  assert.ok(!html.includes('id="assistant-launcher"'));
  assert.ok(!html.includes('assistant-form"'), 'assistant client script should not be inlined');
});

test('every inlined script parses as valid JavaScript', () => {
  for (const source of inlineScripts(renderDashboard(BASE_BUNDLE))) {
    assert.doesNotThrow(() => new vm.Script(source));
  }
});

test('neutralises </script> sequences inside ticket data', () => {
  const html = renderDashboard({
    ...BASE_BUNDLE,
    tickets: {
      'ACME-1': { key: 'ACME-1', summary: '</script><script>alert(1)</script>', fix_versions: [], linked_prs: [] },
    },
  });
  // Assert on the whole page: extracting scripts with a regex would itself
  // stop at the first </script> and hide a breakout.
  assert.ok(!html.includes('<script>alert(1)'));
  const data = inlineScripts(html)[0];
  const parsed = JSON.parse(
    data
      .trim()
      .replace(/^window\.__DASHBOARD_DATA__ = /, '')
      .replace(/;$/, ''),
  );
  assert.equal(parsed.tickets['ACME-1'].summary, '</script><script>alert(1)</script>');
});
