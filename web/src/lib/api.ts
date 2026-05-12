import type { FixAttempt, Space, SpaceInput, ValidationErrors } from '@abf/shared';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function listSpaces(): Promise<Space[]> {
  const res = await fetch(apiUrl('/api/spaces'));
  if (!res.ok) throw new Error(`GET /api/spaces failed: ${res.status}`);
  return res.json() as Promise<Space[]>;
}

export async function getSpace(id: string): Promise<Space> {
  const res = await fetch(apiUrl(`/api/spaces/${id}`));
  if (!res.ok) throw new Error(`GET /api/spaces/${id} failed: ${res.status}`);
  return res.json() as Promise<Space>;
}

export async function startFixLoop(id: string): Promise<Space> {
  const res = await fetch(apiUrl(`/api/spaces/${id}/loop/start`), { method: 'POST' });
  if (!res.ok) throw new Error(`start loop failed: ${res.status}`);
  return res.json() as Promise<Space>;
}

export async function stopFixLoop(id: string): Promise<Space> {
  const res = await fetch(apiUrl(`/api/spaces/${id}/loop/stop`), { method: 'POST' });
  if (!res.ok) throw new Error(`stop loop failed: ${res.status}`);
  return res.json() as Promise<Space>;
}

export async function listFixAttempts(spaceId: string): Promise<FixAttempt[]> {
  const res = await fetch(apiUrl(`/api/spaces/${spaceId}/fix-attempts`));
  if (!res.ok) throw new Error(`list fix attempts failed: ${res.status}`);
  return res.json() as Promise<FixAttempt[]>;
}

export type CreateSpaceResult =
  | { ok: true; space: Space }
  | { ok: false; errors: ValidationErrors };

export async function createSpace(
  input: SpaceInput,
  signal?: AbortSignal,
): Promise<CreateSpaceResult> {
  const res = await fetch(apiUrl('/api/spaces'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (res.status === 201) {
    return { ok: true, space: (await res.json()) as Space };
  }
  if (res.status === 400) {
    const body = (await res.json()) as { errors: ValidationErrors };
    return { ok: false, errors: body.errors };
  }
  throw new Error(`POST /api/spaces unexpected ${res.status}`);
}
