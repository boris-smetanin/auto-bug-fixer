/**
 * Accept either a raw Sentry Issue ID (numeric, alphanumeric, or short ID like
 * "PROJ-123") or a Sentry Issue URL and extract the bare ID.
 *
 * Examples accepted:
 *   "4321"
 *   "PROJ-4321"
 *   "https://acme.sentry.io/issues/4321/"
 *   "https://acme.sentry.io/organizations/acme/issues/4321/"
 *   "https://sentryv2.ongint.com/organizations/foo/issues/4321/events/abc/"
 *
 * Returns undefined for unrecognized input.
 */
export function parseSentryIssueIdentifier(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // URL form: extract the path segment after "/issues/".
  if (/^https?:\/\//i.test(trimmed)) {
    const match = trimmed.match(/\/issues\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return undefined;
  }

  // Bare identifier — accept anything reasonable: digits, letters, dashes,
  // underscores. Reject obvious junk (whitespace, slashes).
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return undefined;
}
