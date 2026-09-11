import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vercel functions have a read-only deployment filesystem. `/tmp` is writable
// for the lifetime of a warm function instance, so retain the local cache
// behavior there without treating it as durable storage.
const runtimeRoot = process.env.VERCEL
  ? path.join('/tmp', 'dev-metrics-dashboard')
  : path.join(__dirname, '..', '..', 'data');
const cacheRoot = path.join(runtimeRoot, 'cache');
const outputRoot = path.join(runtimeRoot, 'output');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function repoSlug(repo) {
  return repo.replace('/', '__');
}

export function githubCachePath(repo) {
  return path.join(cacheRoot, 'github', `${repoSlug(repo)}.json`);
}

export function githubWatermarkPath(repo) {
  return path.join(cacheRoot, 'github', `${repoSlug(repo)}.watermark.json`);
}

export function jiraTicketsCachePath() {
  return path.join(cacheRoot, 'jira', 'tickets.json');
}

export function jiraChangelogsCachePath() {
  return path.join(cacheRoot, 'jira', 'changelogs.json');
}

export function readGithubCache(repo) {
  return readJson(githubCachePath(repo), {});
}

export function writeGithubCache(repo, prsByNumber) {
  writeJson(githubCachePath(repo), prsByNumber);
}

export function readWatermark(repo) {
  return readJson(githubWatermarkPath(repo), { lastUpdatedAtSeen: null, lastRunAt: null });
}

export function writeWatermark(repo, watermark) {
  writeJson(githubWatermarkPath(repo), watermark);
}

export function readJiraTicketsCache() {
  return readJson(jiraTicketsCachePath(), {});
}

export function writeJiraTicketsCache(ticketsByKey) {
  writeJson(jiraTicketsCachePath(), ticketsByKey);
}

/**
 * Changelog is expensive (1 API call per ticket, unlike the cheap single-call
 * bulk fields fetch), so unlike tickets.json this is cached per-ticket rather
 * than always refetched — see src/index.js for the `updated`-timestamp-keyed
 * invalidation this cache is designed around.
 */
export function readJiraChangelogsCache() {
  return readJson(jiraChangelogsCachePath(), {});
}

export function writeJiraChangelogsCache(changelogsByKey) {
  writeJson(jiraChangelogsCachePath(), changelogsByKey);
}

export function writeOutput(name, data) {
  ensureDir(outputRoot);
  const filePath = path.join(outputRoot, name);
  if (typeof data === 'string') {
    fs.writeFileSync(filePath, data);
  } else {
    writeJson(filePath, data);
  }
  return filePath;
}
