import type {
  FixAttempt,
  GlobalSettings,
  Space,
  SpaceInput,
  ValidationErrors,
} from '@abf/shared';

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

export type UpdateSpaceResult =
  | { ok: true; space: Space }
  | { ok: false; errors: ValidationErrors };

export async function updateSpace(
  id: string,
  input: Partial<SpaceInput>,
): Promise<UpdateSpaceResult> {
  const res = await fetch(apiUrl(`/api/spaces/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.ok) return { ok: true, space: (await res.json()) as Space };
  if (res.status === 400) {
    const body = (await res.json()) as { errors: ValidationErrors };
    return { ok: false, errors: body.errors };
  }
  throw new Error(`PATCH /api/spaces/${id} unexpected ${res.status}`);
}

export async function deleteSpace(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/spaces/${id}`), { method: 'DELETE' });
  if (res.status === 204) return;
  if (res.status === 409) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? 'cannot delete while loop is running');
  }
  throw new Error(`DELETE /api/spaces/${id} failed: ${res.status}`);
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

export type FixAttemptsPage = {
  rows: FixAttempt[];
  total: number;
};

export async function listFixAttempts(
  spaceId: string,
  limit = 20,
  offset = 0,
): Promise<FixAttemptsPage> {
  const url = new URL(apiUrl(`/api/spaces/${spaceId}/fix-attempts`), window.location.origin);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`list fix attempts failed: ${res.status}`);
  return res.json() as Promise<FixAttemptsPage>;
}

export async function getFixAttempt(
  spaceId: string,
  fixAttemptId: string,
): Promise<FixAttempt> {
  const res = await fetch(apiUrl(`/api/spaces/${spaceId}/fix-attempts/${fixAttemptId}`));
  if (!res.ok) throw new Error(`get fix attempt failed: ${res.status}`);
  return res.json() as Promise<FixAttempt>;
}

export async function triggerFixAttempt(
  spaceId: string,
  sentryIssueId: string,
): Promise<FixAttempt> {
  const res = await fetch(apiUrl(`/api/spaces/${spaceId}/fix-attempts`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentryIssueId }),
  });
  if (res.ok) return res.json() as Promise<FixAttempt>;
  const body = (await res.json().catch(() => ({ error: 'unknown' }))) as {
    error?: string;
  };
  throw new Error(body.error ?? `trigger failed: ${res.status}`);
}

export async function retryFixAttempt(
  spaceId: string,
  fixAttemptId: string,
): Promise<FixAttempt> {
  const res = await fetch(
    apiUrl(`/api/spaces/${spaceId}/fix-attempts/${fixAttemptId}/retry`),
    { method: 'POST' },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'unknown' }))) as {
      error?: string;
    };
    throw new Error(body.error ?? `retry failed: ${res.status}`);
  }
  return res.json() as Promise<FixAttempt>;
}

export async function softDeleteFixAttempt(
  spaceId: string,
  fixAttemptId: string,
): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/spaces/${spaceId}/fix-attempts/${fixAttemptId}`),
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'unknown' }))) as {
      error?: string;
    };
    throw new Error(body.error ?? `delete failed: ${res.status}`);
  }
}

export async function getFixAttemptLogText(
  spaceId: string,
  fixAttemptId: string,
): Promise<string> {
  const res = await fetch(
    apiUrl(`/api/spaces/${spaceId}/fix-attempts/${fixAttemptId}/logs`),
  );
  if (!res.ok) throw new Error(`get logs failed: ${res.status}`);
  return res.text();
}

export async function getSettings(): Promise<GlobalSettings> {
  const res = await fetch(apiUrl('/api/settings'));
  if (!res.ok) throw new Error(`get settings failed: ${res.status}`);
  return res.json() as Promise<GlobalSettings>;
}

export type UpdateSettingsResult =
  | { ok: true; settings: GlobalSettings }
  | { ok: false; errors: ValidationErrors };

export async function updateSettings(
  fields: Partial<GlobalSettings>,
): Promise<UpdateSettingsResult> {
  const res = await fetch(apiUrl('/api/settings'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (res.ok) return { ok: true, settings: (await res.json()) as GlobalSettings };
  if (res.status === 400) {
    const body = (await res.json()) as { errors: ValidationErrors };
    return { ok: false, errors: body.errors };
  }
  throw new Error(`PATCH /api/settings unexpected ${res.status}`);
}

export type AppLogFile = {
  date: string;
  filename: string;
  sizeBytes: number;
  mtime: string;
};

export async function listAppLogs(): Promise<AppLogFile[]> {
  const res = await fetch(apiUrl('/api/app-logs'));
  if (!res.ok) throw new Error(`list app logs failed: ${res.status}`);
  return res.json() as Promise<AppLogFile[]>;
}

export async function getAppLog(date: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/app-logs/${date}`));
  if (!res.ok) throw new Error(`get app log failed: ${res.status}`);
  return res.text();
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
