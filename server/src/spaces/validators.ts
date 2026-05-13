import type { SpaceInput, ValidationErrors } from '@abf/shared';

const GITHUB_API = process.env.GITHUB_API_BASE ?? 'https://api.github.com';

type AbortableInit = RequestInit & { signal?: AbortSignal };

async function ghFetch(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'auto-bug-fixer',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal,
  } satisfies AbortableInit);
}

async function sentryFetch(
  baseUrl: string,
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${baseUrl}/api/0${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'auto-bug-fixer',
    },
    signal,
  } satisfies AbortableInit);
}

export async function validateCredentials(
  input: SpaceInput,
  signal?: AbortSignal,
): Promise<ValidationErrors | null> {
  const baseBranch = input.baseBranch ?? 'main';
  const sentryBaseUrl = input.sentryBaseUrl ?? 'https://sentry.io';

  // 1. GitHub repo accessible + parse permissions object to verify Contents:Write
  const repoRes = await ghFetch(
    `/repos/${input.githubOwner}/${input.githubRepo}`,
    input.githubToken,
    signal,
  );
  if (repoRes.status === 401 || repoRes.status === 403) {
    return { githubToken: 'GitHub token rejected — check value and repository access' };
  }
  if (repoRes.status === 404) {
    return { githubRepo: `Repo ${input.githubOwner}/${input.githubRepo} not found or token lacks access` };
  }
  if (!repoRes.ok) {
    return { githubRepo: `GitHub returned ${repoRes.status} when checking repo` };
  }

  const repoData = (await repoRes.json()) as {
    permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  };

  // Token must have push (Contents: Write) for the Fix Attempt to push the fix branch.
  // GitHub returns a `permissions` object on /repos/{owner}/{repo} reflecting the
  // authenticating token's capabilities.
  if (repoData.permissions && repoData.permissions.push !== true) {
    return {
      githubToken:
        'GitHub token missing `Contents: Read and write` permission for this repo. ' +
        'Edit the token at github.com/settings/tokens?type=beta and grant Contents R/W.',
    };
  }

  // 2. Token has Contents: Read — list branches as a proxy (catches the case where
  // permissions object isn't returned, e.g. classic PATs)
  const branchesRes = await ghFetch(
    `/repos/${input.githubOwner}/${input.githubRepo}/branches?per_page=1`,
    input.githubToken,
    signal,
  );
  if (branchesRes.status === 403) {
    return { githubToken: 'GitHub token missing `Contents: Read` permission for this repo' };
  }
  if (!branchesRes.ok) {
    return { githubToken: `GitHub returned ${branchesRes.status} when listing branches` };
  }

  // 3. Base branch exists
  const branchRes = await ghFetch(
    `/repos/${input.githubOwner}/${input.githubRepo}/branches/${encodeURIComponent(baseBranch)}`,
    input.githubToken,
    signal,
  );
  if (branchRes.status === 404) {
    return { baseBranch: `Branch \`${baseBranch}\` does not exist in ${input.githubOwner}/${input.githubRepo}` };
  }
  if (!branchRes.ok) {
    return { baseBranch: `GitHub returned ${branchRes.status} when checking branch \`${baseBranch}\`` };
  }

  // 4. Sentry token can read issues for this org/project.
  //    This single check covers "org exists", "project exists", and "token has event:read scope".
  //    We don't validate /projects/{org}/{project}/ separately because that requires project:read,
  //    which the Fix Loop never actually needs.
  const issuesRes = await sentryFetch(
    sentryBaseUrl,
    `/projects/${input.sentryOrgSlug}/${input.sentryProjectSlug}/issues/?limit=1`,
    input.sentryAuthToken,
    signal,
  );
  if (issuesRes.status === 401 || issuesRes.status === 403) {
    return { sentryAuthToken: 'Sentry token rejected — needs `event:read` scope' };
  }
  if (issuesRes.status === 404) {
    return {
      sentryProjectSlug: `Sentry org or project not found at ${sentryBaseUrl}/${input.sentryOrgSlug}/${input.sentryProjectSlug}`,
    };
  }
  if (!issuesRes.ok) {
    return { sentryAuthToken: `Sentry returned ${issuesRes.status} when reading issues` };
  }

  return null;
}
