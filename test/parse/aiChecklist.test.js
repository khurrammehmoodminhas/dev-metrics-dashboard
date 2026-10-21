import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiChecklist, combineAiSignals } from '../../src/parse/aiChecklist.js';

const FULL_CHECKLIST_BODY = `
[ACME-4846](https://acme.atlassian.net/browse/ACME-4846)

#### Summary of changes
- Did the thing

#### AI Contribution Checklist

| Activity | Weight | AI Assisted (%) | Score (Weight × AI%) |
| --- | --- | --- | --- |
| Requirement Analysis | 10 | 80 | 8 |
| Technical Planning | 15 | 70 | 10.5 |
| Architecture Decisions | 15 | | |
| Code Generation | 25 | 90 | 22.5 |
| Refactoring | 10 | | |
| Documentation | 5 | 100 | 5 |
| Debugging | 10 | 60 | 6 |
| Code Review Assistance | 10 | | |
| **Total** | **100** | | |

**AI Contribution Score:** 74%

**Planned SP:** 5
**Actual SP:** 5
`;

const UNFILLED_TEMPLATE_BODY = `
[ACME-xyz](https://acme.atlassian.net/browse/ACME-xyz)

#### Summary of changes

Please include a brief description of what was changed

#### AI Contribution Checklist

| Activity | Weight | AI Assisted (%) | Score (Weight × AI%) |
| --- | --- | --- | --- |
| Requirement Analysis | 10 | | |
| Technical Planning | 15 | | |
| Architecture Decisions | 15 | | |
| Code Generation | 25 | | |
| Refactoring | 10 | | |
| Documentation | 5 | | |
| Debugging | 10 | | |
| Code Review Assistance | 10 | | |
| **Total** | **100** | | |

**AI Contribution Score:** \\_%

**Planned SP:** _Story points estimated in Jira_
**Actual SP:** _Story points representing time actually spent (incl. AI-assisted), fill in manually_
`;

const NO_CHECKLIST_BODY = `
[ACME-1000](https://acme.atlassian.net/browse/ACME-1000)

#### Summary of changes
- Legacy PR from before the AI Contribution Checklist existed
`;

const NO_STATED_LINE_BODY = `
#### AI Contribution Checklist

| Activity | Weight | AI Assisted (%) | Score (Weight × AI%) |
| --- | --- | --- | --- |
| Requirement Analysis | 10 | 50 | 5 |
| Code Generation | 25 | 100 | 25 |
| **Total** | **100** | | |
`;

test('parses a fully filled checklist and trusts the stated score line, even when it does not reconcile with the table', () => {
  const result = parseAiChecklist(FULL_CHECKLIST_BODY);

  assert.equal(result.available, true);
  assert.equal(result.source, 'stated_line');
  // Stated line says 74%, table math (52/65*100 ~= 80%) disagrees on purpose in this fixture.
  assert.equal(result.overall_score_percent, 74);
  assert.equal(result.activities.length, 8);

  const requirementAnalysis = result.activities.find((a) => a.name === 'Requirement Analysis');
  assert.deepEqual(requirementAnalysis, {
    name: 'Requirement Analysis',
    weight: 10,
    ai_percent: 80,
    score: 8,
  });

  const architectureDecisions = result.activities.find((a) => a.name === 'Architecture Decisions');
  assert.equal(architectureDecisions.ai_percent, null);
  assert.equal(architectureDecisions.score, null);
});

test('treats an unfilled template (blank rows, placeholder score/SP text) as unavailable, never as 0', () => {
  const result = parseAiChecklist(UNFILLED_TEMPLATE_BODY);

  assert.equal(result.available, false);
  assert.equal(result.source, 'unavailable');
  assert.equal(result.overall_score_percent, null);
  assert.ok(result.activities.every((a) => a.ai_percent === null));
});

test('marks a PR with no AI Contribution Checklist section at all as unavailable without throwing', () => {
  const result = parseAiChecklist(NO_CHECKLIST_BODY);

  assert.equal(result.available, false);
  assert.equal(result.source, 'unavailable');
  assert.equal(result.activities.length, 0);
});

test('falls back to computing the score from the table when the stated line is missing', () => {
  const result = parseAiChecklist(NO_STATED_LINE_BODY);

  assert.equal(result.available, true);
  assert.equal(result.source, 'computed_fallback');
  // (5 + 25) / (10 + 25) * 100
  assert.equal(result.overall_score_percent, (30 / 35) * 100);
});

test('handles a missing/empty body without throwing', () => {
  const result = parseAiChecklist(undefined);
  assert.equal(result.available, false);
  assert.equal(result.activities.length, 0);
});

test('combineAiSignals averages checklist and commit signals when both are present', () => {
  const checklist = parseAiChecklist(FULL_CHECKLIST_BODY); // stated score 74%
  const combined = combineAiSignals(checklist, 100);
  assert.equal(combined.available, true);
  assert.equal(combined.source, 'blended');
  assert.equal(combined.overall_score_percent, (74 + 100) / 2);
  assert.equal(combined.checklist_score_percent, 74);
  assert.equal(combined.commit_ai_percent, 100);
});

test('combineAiSignals falls back to the commit signal when the PR body has no checklist', () => {
  const checklist = parseAiChecklist(NO_CHECKLIST_BODY);
  const combined = combineAiSignals(checklist, 60);
  assert.equal(combined.available, true);
  assert.equal(combined.source, 'commit_trailers');
  assert.equal(combined.overall_score_percent, 60);
  assert.equal(combined.checklist_score_percent, null);
});

test('combineAiSignals keeps the checklist result as-is when there are no commits to check', () => {
  const checklist = parseAiChecklist(FULL_CHECKLIST_BODY);
  const combined = combineAiSignals(checklist, null);
  assert.equal(combined.overall_score_percent, 74);
  assert.equal(combined.source, 'stated_line');
  assert.equal(combined.commit_ai_percent, null);
});

test('combineAiSignals stays unavailable when neither signal is present', () => {
  const checklist = parseAiChecklist(NO_CHECKLIST_BODY);
  const combined = combineAiSignals(checklist, null);
  assert.equal(combined.available, false);
});

test('the checklist heading is configurable and tolerates other heading levels', () => {
  const body = FULL_CHECKLIST_BODY.replace('#### AI Contribution Checklist', '## AI Usage Report');
  assert.equal(parseAiChecklist(body).activities.length, 0);
  const result = parseAiChecklist(body, { heading: 'AI Usage Report' });
  assert.ok(result.activities.length > 0);
});
