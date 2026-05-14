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
  busy?: number;
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
    busy: row.busy === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type NewSpace = Omit<Space, 'fixLoopRunning' | 'busy' | 'createdAt' | 'updatedAt'>;

const SELECT_WITH_BUSY = `
  SELECT s.*, EXISTS(
    SELECT 1 FROM fix_attempts a
    WHERE a.space_id = s.id AND a.state = 'in_progress'
  ) AS busy
  FROM spaces s
`;

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
  // A brand-new Space has no fix_attempts yet, so busy is trivially false.
  const row = stmt.get(s) as SpaceRow;
  return rowToSpace({ ...row, busy: 0 });
}

export function listSpaces(): Space[] {
  const rows = getDb()
    .prepare(`${SELECT_WITH_BUSY} ORDER BY s.created_at DESC`)
    .all() as SpaceRow[];
  return rows.map(rowToSpace);
}

export function findSpaceById(id: string): Space | undefined {
  const row = getDb()
    .prepare(`${SELECT_WITH_BUSY} WHERE s.id = ?`)
    .get(id) as SpaceRow | undefined;
  return row ? rowToSpace(row) : undefined;
}

export function updateSpace(id: string, fields: NewSpace): Space {
  getDb()
    .prepare(`
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
    `)
    .run({ ...fields, id });
  // Refetch via findSpaceById to include the derived `busy` column.
  const updated = findSpaceById(id);
  if (!updated) throw new Error(`updateSpace: row ${id} not found after update`);
  return updated;
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
