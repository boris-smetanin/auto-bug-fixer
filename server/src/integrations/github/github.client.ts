import type { Space } from '@abf/shared';

const GITHUB_API = process.env.GITHUB_API_BASE ?? 'https://api.github.com';

export class GithubApiError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
    this.body = body;
  }
}

export async function remoteBranchExists(
  space: Space,
  branchName: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const url = `${GITHUB_API}/repos/${space.githubOwner}/${space.githubRepo}/branches/${encodeURIComponent(branchName)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${space.githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'auto-bug-fixer',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal,
  });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  const body = await res.text().catch(() => '');
  throw new GithubApiError(
    `GitHub ${res.status} checking branch ${branchName}`,
    res.status,
    body.slice(0, 500),
  );
}

export function fixBranchName(sentryIssueId: string): string {
  return `auto-fix/sentry-${sentryIssueId}`;
}

export type PullRequestCreated = {
  number: number;
  htmlUrl: string;
};

/**
 * Open a PR, or reuse one if it already exists for this head+base. Idempotent
 * so retrying a Fix Attempt — which force-pushes a new commit onto the same
 * fix branch — doesn't 422 with "PR already exists" when there's an open PR
 * from the previous run on the same branch.
 *
 * Happy path: POST /pulls succeeds, return the new PR.
 * Conflict path: POST returns 422, fall back to GET /pulls?head=...&base=...
 *   - exactly 1 open match → return it (the existing PR now has our fresh
 *     force-pushed commits)
 *   - 0 or 2+ matches → surface the original 422 (ambiguity isn't safe to
 *     resolve automatically)
 */
export async function createPullRequest(
  space: Space,
  args: { title: string; body: string; head: string; base: string },
  signal?: AbortSignal,
): Promise<PullRequestCreated> {
  const url = `${GITHUB_API}/repos/${space.githubOwner}/${space.githubRepo}/pulls`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${space.githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'auto-bug-fixer',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
      maintainer_can_modify: true,
    }),
    signal,
  });

  if (res.ok) {
    const data = (await res.json()) as { number: number; html_url: string };
    return { number: data.number, htmlUrl: data.html_url };
  }

  const body = await res.text().catch(() => '');

  // GitHub returns 422 with a "A pull request already exists ..." message
  // when an open PR exists for this head+base. Reuse it.
  if (res.status === 422) {
    const existing = await findOpenPullRequest(space, args.head, args.base, signal);
    if (existing) return existing;
  }

  throw new GithubApiError(
    `GitHub ${res.status} creating PR`,
    res.status,
    body.slice(0, 500),
  );
}

async function findOpenPullRequest(
  space: Space,
  headBranch: string,
  base: string,
  signal?: AbortSignal,
): Promise<PullRequestCreated | undefined> {
  const url = new URL(
    `${GITHUB_API}/repos/${space.githubOwner}/${space.githubRepo}/pulls`,
  );
  url.searchParams.set('head', `${space.githubOwner}:${headBranch}`);
  url.searchParams.set('base', base);
  url.searchParams.set('state', 'open');
  url.searchParams.set('per_page', '10');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${space.githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'auto-bug-fixer',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal,
  });
  if (!res.ok) return undefined;

  const rows = (await res.json().catch(() => undefined)) as
    | Array<{ number: number; html_url: string }>
    | undefined;
  if (!rows || rows.length !== 1) return undefined;
  const only = rows[0]!;
  return { number: only.number, htmlUrl: only.html_url };
}

export type IssueCreated = {
  number: number;
  htmlUrl: string;
};

/**
 * Open a GitHub Issue on the Space's repo. Used by the drain to file an
 * escalation when the agent concludes the bug's root cause is outside this
 * repo (the agent writes .abf/escalation.md; the drain reads it and calls
 * this).
 */
export async function createIssue(
  space: Space,
  args: { title: string; body: string; labels?: string[] },
  signal?: AbortSignal,
): Promise<IssueCreated> {
  const url = `${GITHUB_API}/repos/${space.githubOwner}/${space.githubRepo}/issues`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${space.githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'auto-bug-fixer',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      labels: args.labels,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GithubApiError(
      `GitHub ${res.status} creating issue`,
      res.status,
      body.slice(0, 500),
    );
  }
  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, htmlUrl: data.html_url };
}
