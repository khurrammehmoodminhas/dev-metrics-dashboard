import { warn } from '../utils/logger.js';

const API_BASE = 'https://api.github.com';

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is not set (see .env.example)');
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const nextPart = linkHeader.split(',').find((part) => part.includes('rel="next"'));
  if (!nextPart) return null;
  const match = /<([^>]+)>/.exec(nextPart);
  return match ? match[1] : null;
}

async function githubGet(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  return response;
}

async function githubGetJson(url) {
  const response = await githubGet(url);
  return response.json();
}

/**
 * Lists pull requests for a repo, newest-updated first, and stops paging as soon
 * as a PR's `updated_at` is at or before the watermark — this is what keeps
 * re-runs cheap. Returns only PRs strictly newer than the watermark.
 */
export async function fetchNewOrUpdatedPullRequests(repo, lastUpdatedAtSeen) {
  const [owner, name] = repo.split('/');
  const watermarkTime = lastUpdatedAtSeen ? new Date(lastUpdatedAtSeen).getTime() : null;
  const results = [];
  let url = `${API_BASE}/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=100`;

  while (url) {
    const response = await githubGet(url);
    const page = await response.json();

    for (const pr of page) {
      if (watermarkTime !== null && new Date(pr.updated_at).getTime() <= watermarkTime) {
        return results;
      }
      results.push(pr);
    }

    url = parseNextLink(response.headers.get('link'));
  }

  return results;
}

export async function fetchPullRequestCommits(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/commits?per_page=100`);
}

export async function fetchPullRequestReviews(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/reviews?per_page=100`);
}

export async function fetchPullRequestComments(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/issues/${number}/comments?per_page=100`);
}

/**
 * Fetches everything needed to derive commit-level AI co-authorship and code
 * review metrics for a single PR. Now includes:
 * - commits: for AI co-authorship analysis
 * - reviews: for code review timing and reviewer identification (formal reviews)
 * - comments: for code review comments (separate from formal reviews)
 * Callers should only invoke this for new/changed PRs (see the watermark logic
 * in fetchNewOrUpdatedPullRequests).
 */
export async function fetchPullRequestActivity(repo, number) {
  try {
    const commits = await fetchPullRequestCommits(repo, number);
    const reviews = await fetchPullRequestReviews(repo, number);
    const comments = await fetchPullRequestComments(repo, number);
    return { commits, reviews, comments };
  } catch (error) {
    warn(`Failed to fetch activity for ${repo}#${number}: ${error.message}`);
    return { commits: [], reviews: [], comments: [] };
  }
}
