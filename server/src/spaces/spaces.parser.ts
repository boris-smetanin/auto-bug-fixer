import type { SpaceInput, ValidationErrors } from '@abf/shared';

export type ParseResult =
  | { ok: true; value: SpaceInput }
  | { ok: false; errors: ValidationErrors };

export function parseSpaceInput(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, errors: { body: 'Invalid request body' } };
  }

  const errors: ValidationErrors = {};
  const b = body as Record<string, unknown>;

  const reqStr = (field: string): string => {
    const v = b[field];
    if (typeof v !== 'string' || v.trim() === '') {
      errors[field] = 'Required';
      return '';
    }
    return v.trim();
  };

  const githubOwner = reqStr('githubOwner');
  const githubRepo = reqStr('githubRepo');
  const githubToken = reqStr('githubToken');
  const sentryOrgSlug = reqStr('sentryOrgSlug');
  const sentryProjectSlug = reqStr('sentryProjectSlug');
  const sentryAuthToken = reqStr('sentryAuthToken');

  const name =
    typeof b.name === 'string' && b.name.trim() ? b.name.trim() : undefined;
  const baseBranch =
    typeof b.baseBranch === 'string' && b.baseBranch.trim()
      ? b.baseBranch.trim()
      : undefined;
  const extraSentryQuery =
    typeof b.extraSentryQuery === 'string' ? b.extraSentryQuery : undefined;

  let sentryBaseUrl: string | undefined;
  if (typeof b.sentryBaseUrl === 'string' && b.sentryBaseUrl.trim()) {
    const trimmed = b.sentryBaseUrl.trim();
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        errors.sentryBaseUrl = 'Must start with http:// or https://';
      } else {
        sentryBaseUrl = `${u.protocol}//${u.host}`;
      }
    } catch {
      errors.sentryBaseUrl = 'Invalid URL';
    }
  }

  let tickIntervalSeconds: number | undefined;
  const raw = b.tickIntervalSeconds;
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      errors.tickIntervalSeconds = 'Must be a positive integer';
    } else {
      tickIntervalSeconds = n;
    }
  }

  // Accept either a comma-separated string (typical from the form) or a real
  // array (from API clients). Empty / missing -> undefined; the service
  // applies the default.
  let sentryEventFields: string[] | undefined;
  const rawFields = b.sentryEventFields;
  if (Array.isArray(rawFields)) {
    sentryEventFields = normalizeFieldNames(rawFields.filter((s): s is string => typeof s === 'string'));
  } else if (typeof rawFields === 'string' && rawFields.trim() !== '') {
    sentryEventFields = normalizeFieldNames(rawFields.split(','));
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      githubOwner,
      githubRepo,
      githubToken,
      baseBranch,
      sentryBaseUrl,
      sentryOrgSlug,
      sentryProjectSlug,
      sentryAuthToken,
      extraSentryQuery,
      sentryEventFields,
      tickIntervalSeconds,
    },
  };
}

function normalizeFieldNames(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
