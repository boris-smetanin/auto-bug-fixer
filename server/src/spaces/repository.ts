import type { Space } from '@abf/shared';
import { getDb } from '../db.js';

type SpaceRow = {
  id: string;
  name: string;
  github_owner: string;
  github_repo: string;
  github_token: string;
  base_branch: string;
  sentry_base_url: string;
  sentry_org_slug: string;
  sentry_project_slug: string;
  sentry_auth_token: string;
  extra_sentry_query: string;
  tick_interval_seconds: number;
  fix_loop_running: number;
  created_at: string;
  updated_at: string;
};

function rowToSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    githubToken: row.github_token,
    baseBranch: row.base_branch,
    sentryBaseUrl: row.sentry_base_url,
    sentryOrgSlug: row.sentry_org_slug,
    sentryProjectSlug: row.sentry_project_slug,
    sentryAuthToken: row.sentry_auth_token,
    extraSentryQuery: row.extra_sentry_query,
    tickIntervalSeconds: row.tick_interval_seconds,
    fixLoopRunning: row.fix_loop_running === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type NewSpace = Omit<Space, 'fixLoopRunning' | 'createdAt' | 'updatedAt'>;

export function insertSpace(s: NewSpace): Space {
  const stmt = getDb().prepare(`
    INSERT INTO spaces (
      id, name, github_owner, github_repo, github_token, base_branch,
      sentry_base_url, sentry_org_slug, sentry_project_slug, sentry_auth_token,
      extra_sentry_query, tick_interval_seconds
    ) VALUES (
      @id, @name, @githubOwner, @githubRepo, @githubToken, @baseBranch,
      @sentryBaseUrl, @sentryOrgSlug, @sentryProjectSlug, @sentryAuthToken,
      @extraSentryQuery, @tickIntervalSeconds
    )
    RETURNING *
  `);
  return rowToSpace(stmt.get(s) as SpaceRow);
}

export function listSpaces(): Space[] {
  const rows = getDb()
    .prepare('SELECT * FROM spaces ORDER BY created_at DESC')
    .all() as SpaceRow[];
  return rows.map(rowToSpace);
}

export function findSpaceById(id: string): Space | undefined {
  const row = getDb()
    .prepare('SELECT * FROM spaces WHERE id = ?')
    .get(id) as SpaceRow | undefined;
  return row ? rowToSpace(row) : undefined;
}

export function updateSpace(id: string, fields: NewSpace): Space {
  const stmt = getDb().prepare(`
    UPDATE spaces SET
      name = @name,
      github_owner = @githubOwner,
      github_repo = @githubRepo,
      github_token = @githubToken,
      base_branch = @baseBranch,
      sentry_base_url = @sentryBaseUrl,
      sentry_org_slug = @sentryOrgSlug,
      sentry_project_slug = @sentryProjectSlug,
      sentry_auth_token = @sentryAuthToken,
      extra_sentry_query = @extraSentryQuery,
      tick_interval_seconds = @tickIntervalSeconds,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = @id
    RETURNING *
  `);
  return rowToSpace(stmt.get({ ...fields, id }) as SpaceRow);
}

export function deleteSpace(id: string): void {
  getDb().prepare('DELETE FROM spaces WHERE id = ?').run(id);
}

export function setFixLoopRunning(id: string, running: boolean): void {
  getDb()
    .prepare(
      `UPDATE spaces
       SET fix_loop_running = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(running ? 1 : 0, id);
}
