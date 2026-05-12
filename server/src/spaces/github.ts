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
