import type { Space } from '@abf/shared';

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  permalink: string;
  firstSeen: string;
  lastSeen: string;
};

export class SentryApiError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'SentryApiError';
    this.status = status;
    this.body = body;
  }
}

export async function fetchUnresolvedSentryIssues(
  space: Space,
  signal?: AbortSignal,
  limit = 25,
): Promise<SentryIssue[]> {
  const queryParts = ['is:unresolved'];
  if (space.extraSentryQuery.trim()) queryParts.push(space.extraSentryQuery.trim());
  const query = queryParts.join(' ');

  const url = new URL(
    `${space.sentryBaseUrl}/api/0/projects/${space.sentryOrgSlug}/${space.sentryProjectSlug}/issues/`,
  );
  url.searchParams.set('query', query);
  url.searchParams.set('sort', 'date');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${space.sentryAuthToken}`,
      Accept: 'application/json',
      'User-Agent': 'auto-bug-fixer',
    },
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SentryApiError(
      `Sentry ${res.status} on ${url.pathname}`,
      res.status,
      body.slice(0, 500),
    );
  }

  const data = (await res.json()) as Array<{
    id: string;
    shortId: string;
    title: string;
    permalink: string;
    firstSeen: string;
    lastSeen: string;
  }>;

  return data.map((d) => ({
    id: d.id,
    shortId: d.shortId,
    title: d.title,
    permalink: d.permalink,
    firstSeen: d.firstSeen,
    lastSeen: d.lastSeen,
  }));
}
