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
