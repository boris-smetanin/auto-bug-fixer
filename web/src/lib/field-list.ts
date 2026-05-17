/**
 * Parse a comma-separated text input into a trimmed, lowercased, deduped
 * array of field names. Used by the Add/Edit Space forms for the
 * "Additional Sentry event fields" input.
 */
export function parseFieldList(input: string): string[] {
  if (!input.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
