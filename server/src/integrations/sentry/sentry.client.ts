import type { Space } from '@abf/shared';

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  permalink: string;
  firstSeen: string;
  lastSeen: string;
  count: string;
};

export type SentryStackFrame = {
  filename?: string;
  absPath?: string;
  function?: string;
  lineno?: number;
  colno?: number;
};

export type SentryEvent = {
  id?: string;
  eventID?: string;
  dateCreated?: string;
  environment?: string | null;
  release?: string | null;
  tags?: Array<{ key: string; value: string }>;
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: { frames?: SentryStackFrame[] };
    }>;
  };
  breadcrumbs?: { values?: Array<Record<string, unknown>> };
  request?: {
    url?: string;
    method?: string;
    headers?: Array<[string, string]>;
    data?: unknown;
  };
  /**
   * Sentry's "contexts" — structured, well-known metadata grouped by source
   * (runtime, os, browser, device, app, plus any custom contexts the SDK
   * sent). Each context is a free-form object.
   */
  contexts?: Record<string, Record<string, unknown> | undefined>;
  /**
   * Sentry's "extra" — wholly user-defined key/value bag set via
   * Sentry.setExtra(). The most situation-specific data.
   */
  extra?: Record<string, unknown>;
};

export type SuspectCommit = {
  id: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
  dateCreated?: string;
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
    count?: string;
  }>;

  return data.map((d) => ({
    id: d.id,
    shortId: d.shortId,
    title: d.title,
    permalink: d.permalink,
    firstSeen: d.firstSeen,
    lastSeen: d.lastSeen,
    count: d.count ?? '1',
  }));
}

type SentryEntry = { type: string; data: unknown };
type SentryEventRaw = SentryEvent & {
  entries?: SentryEntry[];
  user?: unknown;
};

/**
 * Sentry's event detail endpoints return exception / breadcrumbs / request
 * inside an `entries[]` array keyed by `type`, not as top-level fields.
 * Lift them to the top-level keys the formatter expects, so downstream code
 * doesn't have to know about both shapes. Also strips the top-level `user`
 * field — PII we never want to surface to the agent.
 */
function normalizeEvent(raw: SentryEventRaw): SentryEvent {
  for (const entry of raw.entries ?? []) {
    if (entry.type === 'exception' && !raw.exception) {
      raw.exception = entry.data as SentryEvent['exception'];
    } else if (entry.type === 'breadcrumbs' && !raw.breadcrumbs) {
      raw.breadcrumbs = entry.data as SentryEvent['breadcrumbs'];
    } else if (entry.type === 'request' && !raw.request) {
      raw.request = entry.data as SentryEvent['request'];
    }
  }
  delete raw.entries;
  delete raw.user;
  return raw;
}

async function fetchEventByPosition(
  space: Space,
  issueId: string,
  position: 'latest' | 'oldest',
  signal?: AbortSignal,
): Promise<SentryEvent> {
  const url = `${space.sentryBaseUrl}/api/0/issues/${issueId}/events/${position}/`;
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
    throw new SentryApiError(`Sentry ${res.status} on ${url}`, res.status, body.slice(0, 500));
  }
  const raw = (await res.json()) as SentryEventRaw;
  return normalizeEvent(raw);
}

export function fetchLatestEventForIssue(
  space: Space,
  issueId: string,
  signal?: AbortSignal,
): Promise<SentryEvent> {
  return fetchEventByPosition(space, issueId, 'latest', signal);
}

export function fetchOldestEventForIssue(
  space: Space,
  issueId: string,
  signal?: AbortSignal,
): Promise<SentryEvent> {
  return fetchEventByPosition(space, issueId, 'oldest', signal);
}

/**
 * Fetch the suspect commits Sentry has correlated to this issue (via release
 * tracking + commit data). Best-effort: returns [] if Sentry has nothing or
 * the endpoint errors (e.g. no commit data uploaded for the release).
 */
export async function fetchSuspectCommitsForIssue(
  space: Space,
  issueId: string,
  signal?: AbortSignal,
): Promise<SuspectCommit[]> {
  const url = `${space.sentryBaseUrl}/api/0/issues/${issueId}/committers/`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${space.sentryAuthToken}`,
      Accept: 'application/json',
      'User-Agent': 'auto-bug-fixer',
    },
    signal,
  });
  if (!res.ok) return [];

  const data = (await res.json().catch(() => undefined)) as
    | {
        committers?: Array<{
          author?: { name?: string; email?: string };
          commits?: Array<{
            id?: string;
            message?: string;
            dateCreated?: string;
          }>;
        }>;
      }
    | undefined;

  const out: SuspectCommit[] = [];
  for (const c of data?.committers ?? []) {
    for (const commit of c.commits ?? []) {
      if (!commit.id || !commit.message) continue;
      out.push({
        id: commit.id,
        message: commit.message,
        authorName: c.author?.name,
        authorEmail: c.author?.email,
        dateCreated: commit.dateCreated,
      });
    }
  }
  return out;
}
