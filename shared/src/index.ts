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
