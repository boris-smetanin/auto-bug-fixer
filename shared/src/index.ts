export type HealthResponse = {
  ok: true;
};

export type SpaceInput = {
  name?: string;
  githubOwner: string;
  githubRepo: string;
  githubToken: string;
  baseBranch?: string;
  sentryBaseUrl?: string;
  sentryOrgSlug: string;
  sentryProjectSlug: string;
  sentryAuthToken: string;
  extraSentryQuery?: string;
  tickIntervalSeconds?: number;
};

export type Space = {
  id: string;
  name: string;
  githubOwner: string;
  githubRepo: string;
  githubToken: string;
  baseBranch: string;
  sentryBaseUrl: string;
  sentryOrgSlug: string;
  sentryProjectSlug: string;
  sentryAuthToken: string;
  extraSentryQuery: string;
  tickIntervalSeconds: number;
  fixLoopRunning: boolean;
  /** Derived: true if any Fix Attempt for this Space is currently in_progress. */
  busy: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ValidationErrors = Record<string, string>;

export type AddSpaceErrorResponse = {
  errors: ValidationErrors;
};

export type FixAttemptState =
  | 'queued'
  | 'in_progress'
  | 'pr_opened'
  | 'failed';

export type GlobalSettings = {
  appLogRetentionDays: number;
};

export type FixAttemptFailureReason =
  | 'clone_error'
  | 'checkout_error'
  | 'sentry_api_error'
  | 'claude_timeout'
  | 'claude_error'
  | 'no_changes_produced'
  | 'push_error'
  | 'pr_creation_error'
  | 'orphaned'
  | 'unknown';

export type FixAttempt = {
  id: string;
  spaceId: string;
  sentryIssueId: string;
  state: FixAttemptState;
  branchName: string;
  prNumber: number | null;
  prUrl: string | null;
  failureReason: string | null;
  failureMessage: string | null;
  failureContext: unknown | null;
  logFilePath: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};
