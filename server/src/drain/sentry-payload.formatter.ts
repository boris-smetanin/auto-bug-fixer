import type { SentryEvent, SentryIssue } from '../integrations/sentry/sentry.client.js';

const REDACTED_HEADERS = new Set(['cookie', 'authorization', 'x-api-key']);
const PII_TAGS = new Set(['user', 'user.id', 'user.email', 'user.ip', 'user.username']);
const MAX_BREADCRUMBS = 30;
const MAX_BODY_BYTES = 2048;

export function formatSentryPayload(issue: SentryIssue, event: SentryEvent): string {
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
    // Sentry returns frames innermost-last; display in conventional stack order.
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

  out.push('---');
  out.push('');
  out.push(
    'Locate the root cause and make the minimal fix. Commit the change with a concise message. Do not push or open a PR — the orchestrator handles that.',
  );

  return out.join('\n');
}
