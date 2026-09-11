import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// deliveryMath.js is deliberately plain JS (no import/export) so it can be
// inlined verbatim into the dashboard's <script> tag. This wrapper executes
// that exact same file's text to expose its function declarations to Node —
// so tests and the CSV validator call the identical code the browser runs,
// not a separate reimplementation.
//
// Uses vm.runInThisContext (not vm.createContext/runInContext): the latter
// creates a separate V8 realm with its own Array/Object globals, so arrays
// built inside it fail assert.deepStrictEqual against arrays from the calling
// realm ("same structure but not reference-equal") even when the values match.
// runInThisContext shares the actual calling realm, avoiding that entirely.
const filePath = path.join(__dirname, 'deliveryMath.js');
const source = fs.readFileSync(filePath, 'utf8');
vm.runInThisContext(source, { filename: filePath });

export const filterTicketsBySelectedReleases = globalThis.filterTicketsBySelectedReleases;
export const computeReleaseSummary = globalThis.computeReleaseSummary;
export const computeReleasePointComparison = globalThis.computeReleasePointComparison;
export const computeDeveloperDelivery = globalThis.computeDeveloperDelivery;
export const computeTicketStatusBreakdown = globalThis.computeTicketStatusBreakdown;
export const computeIssueTypeBreakdown = globalThis.computeIssueTypeBreakdown;
