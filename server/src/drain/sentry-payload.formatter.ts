import type {
  SentryEvent,
  SentryIssue,
  SuspectCommit,
} from '../integrations/sentry/sentry.client.js';

const REDACTED_HEADERS = new Set(['cookie', 'authorization', 'x-api-key']);
const PII_TAGS = new Set(['user', 'user.id', 'user.email', 'user.ip', 'user.username']);
// contexts.* keys we never render (PII / not useful to the agent).
const SKIPPED_CONTEXT_KEYS = new Set(['user']);
// Breadcrumbs tend to repeat (HTTP probes, console noise) — the most recent
// few are the load-bearing ones for diagnosis.
const MAX_BREADCRUMBS = 5;
const MAX_BODY_BYTES = 2048;
const MAX_EXTRA_VALUE_BYTES = 1024;
const MAX_CONTEXT_VALUE_BYTES = 256;

export type FormatSentryPayloadOptions = {
  /** Sentry's "first event" for this issue. Skipped if the same as latest. */
  firstEvent?: SentryEvent;
  /** Commits Sentry correlates to this issue (release suspect commits). */
  suspectCommits?: SuspectCommit[];
};

export function formatSentryPayload(
  issue: SentryIssue,
  event: SentryEvent,
  opts: FormatSentryPayloadOptions = {},
): string {
  const out: string[] = [];

  out.push(`# Sentry Issue: ${issue.title}`);
  out.push('');
  out.push(`**Issue:** [${issue.shortId}](${issue.permalink})`);
  out.push(`**Occurrences:** ${issue.count}`);
  out.push(`**First seen:** ${issue.firstSeen}`);
  out.push(`**Last seen:** ${issue.lastSeen}`);
  if (event.environment) out.push(`**Environment:** ${event.environment}`);
  if (event.release) out.push(`**Release:** ${event.release}`);
  out.push('');

  out.push('## Stack trace');
  out.push('');
  out.push('```');
  const exceptions = event.exception?.values ?? [];
  if (exceptions.length === 0) {
    out.push('(no exception data in latest event)');
  }
  for (const ex of exceptions) {
    out.push(`${ex.type ?? 'Error'}: ${ex.value ?? ''}`);
    const frames = ex.stacktrace?.frames ?? [];
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (!f) continue;
      const fn = f.function ?? '<anonymous>';
      const file = f.filename ?? f.absPath ?? '<unknown>';
      const ln = f.lineno !== undefined ? `:${f.lineno}` : '';
      const col = f.colno !== undefined ? `:${f.colno}` : '';
      out.push(`  at ${fn} (${file}${ln}${col})`);
    }
  }
  out.push('```');
  out.push('');

  if (event.request) {
    out.push('## Request');
    out.push('');
    if (event.request.url) out.push(`- URL: \`${event.request.url}\``);
    if (event.request.method) out.push(`- Method: \`${event.request.method}\``);
    const headers = event.request.headers ?? [];
    if (headers.length > 0) {
      out.push('- Headers:');
      for (const [k, v] of headers) {
        const value = REDACTED_HEADERS.has(k.toLowerCase()) ? '<redacted>' : v;
        out.push(`  - \`${k}: ${value}\``);
      }
    }
    if (event.request.data !== undefined && event.request.data !== null) {
      let body =
        typeof event.request.data === 'string'
          ? event.request.data
          : JSON.stringify(event.request.data);
      if (body.length > MAX_BODY_BYTES) {
        body = `${body.slice(0, MAX_BODY_BYTES)}… (truncated)`;
      }
      out.push('- Body:');
      out.push('```');
      out.push(body);
      out.push('```');
    }
    out.push('');
  }

  // Contexts — Sentry's structured per-source metadata (runtime, os, browser,
  // device, app, plus any custom contexts). One small block per context.
  const contexts = event.contexts ?? {};
  const contextKeys = Object.keys(contexts).filter(
    (k) => !SKIPPED_CONTEXT_KEYS.has(k.toLowerCase()),
  );
  if (contextKeys.length > 0) {
    out.push('## Contexts');
    out.push('');
    for (const key of contextKeys) {
      const ctx = contexts[key];
      if (!ctx || typeof ctx !== 'object') continue;
      out.push(`### ${key}`);
      for (const [k, v] of Object.entries(ctx)) {
        if (k === 'type') continue; // Sentry annotation, not data
        out.push(`- ${k}: ${truncateValue(v, MAX_CONTEXT_VALUE_BYTES)}`);
      }
      out.push('');
    }
  }

  // Extra — user-supplied catch-all bag. Most situation-specific signal.
  const extra = event.extra ?? {};
  const extraKeys = Object.keys(extra);
  if (extraKeys.length > 0) {
    out.push('## Extra');
    out.push('');
    for (const k of extraKeys) {
      out.push(`- **${k}**: ${truncateValue(extra[k], MAX_EXTRA_VALUE_BYTES)}`);
    }
    out.push('');
  }

  const breadcrumbs = event.breadcrumbs?.values ?? [];
  if (breadcrumbs.length > 0) {
    const tail = breadcrumbs.slice(-MAX_BREADCRUMBS);
    out.push(`## Breadcrumbs (last ${tail.length})`);
    out.push('');
    out.push('```json');
    out.push(JSON.stringify(tail, null, 2));
    out.push('```');
    out.push('');
  }

  const tags = (event.tags ?? []).filter((t) => !PII_TAGS.has(t.key.toLowerCase()));
  if (tags.length > 0) {
    out.push('## Tags');
    out.push('');
    out.push('| key | value |');
    out.push('|---|---|');
    for (const t of tags) {
      out.push(`| ${t.key} | ${t.value} |`);
    }
    out.push('');
  }

  // First event — only when materially different from the latest. Useful for
  // regressions where the first occurrence reveals when/how the bug started.
  if (
    opts.firstEvent &&
    opts.firstEvent.eventID &&
    opts.firstEvent.eventID !== event.eventID
  ) {
    out.push('## First event (different from latest)');
    out.push('');
    if (opts.firstEvent.dateCreated) {
      out.push(`**Captured at:** ${opts.firstEvent.dateCreated}`);
    }
    if (opts.firstEvent.release) {
      out.push(`**Release:** ${opts.firstEvent.release}`);
    }
    const firstEx = opts.firstEvent.exception?.values?.[0];
    if (firstEx) {
      out.push(`**Error:** \`${firstEx.type ?? 'Error'}: ${firstEx.value ?? ''}\``);
    }
    out.push('');
  }

  // Suspect commits — Sentry's release-tracking guesses about which commits
  // introduced this issue. Often very useful for regressions.
  if (opts.suspectCommits && opts.suspectCommits.length > 0) {
    out.push('## Suspect commits (Sentry release correlation)');
    out.push('');
    for (const c of opts.suspectCommits.slice(0, 10)) {
      const author = c.authorName ? ` — ${c.authorName}` : '';
      const date = c.dateCreated ? ` (${c.dateCreated})` : '';
      const message = c.message.split('\n')[0]?.slice(0, 200) ?? '';
      out.push(`- \`${c.id.slice(0, 12)}\`${author}${date}: ${message}`);
    }
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(
    'Locate the root cause and make the minimal fix. Commit the change with a concise message. Do not push or open a PR — the orchestrator handles that.',
  );

  return out.join('\n');
}

function truncateValue(v: unknown, maxBytes: number): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > maxBytes ? `${s.slice(0, maxBytes)}… (truncated)` : s;
}
