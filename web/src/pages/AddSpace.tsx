import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import type { SpaceInput, ValidationErrors } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createSpace } from '@/lib/api';
import { parseGithubRepoText } from '@/lib/github';

type FormState = {
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
  tickIntervalSeconds: string;
};

const initialForm: FormState = {
  name: '',
  githubOwner: '',
  githubRepo: '',
  githubToken: '',
  baseBranch: 'main',
  sentryBaseUrl: 'https://sentry.io',
  sentryOrgSlug: '',
  sentryProjectSlug: '',
  sentryAuthToken: '',
  extraSentryQuery: '',
  tickIntervalSeconds: '60',
};

export function AddSpace() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Warn user before navigating away during clone
  useEffect(() => {
    if (!submitting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [submitting]);

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setErrors({});

    const tick = form.tickIntervalSeconds.trim();
    const input: SpaceInput = {
      name: form.name.trim() || undefined,
      githubOwner: form.githubOwner.trim(),
      githubRepo: form.githubRepo.trim(),
      githubToken: form.githubToken,
      baseBranch: form.baseBranch.trim() || undefined,
      sentryBaseUrl: form.sentryBaseUrl.trim() || undefined,
      sentryOrgSlug: form.sentryOrgSlug.trim(),
      sentryProjectSlug: form.sentryProjectSlug.trim(),
      sentryAuthToken: form.sentryAuthToken,
      extraSentryQuery: form.extraSentryQuery.trim() || undefined,
      tickIntervalSeconds: tick ? Number(tick) : undefined,
    };

    try {
      const result = await createSpace(input);
      if (result.ok) {
        navigate('/');
        return;
      }
      setErrors(result.errors);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const defaultName = form.githubOwner && form.githubRepo
    ? `${form.githubOwner}/${form.githubRepo}`
    : '';

  const onRepoPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const parsed = parseGithubRepoText(text);
    if (parsed) {
      e.preventDefault();
      setForm((prev) => ({
        ...prev,
        githubOwner: parsed.owner,
        githubRepo: parsed.repo,
      }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.githubOwner;
        delete next.githubRepo;
        return next;
      });
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <Link to="/" className="text-sm text-neutral-500 hover:underline">
          ← Back to Spaces
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new Space</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Name" error={errors.name} hint="Optional. Defaults to owner/repo.">
              <Input
                value={form.name}
                onChange={update('name')}
                placeholder={defaultName || 'Marketing Site'}
                disabled={submitting}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="GitHub owner" error={errors.githubOwner} hint="User or org. Paste a https://github.com/owner/repo URL to auto-fill both.">
                <Input
                  value={form.githubOwner}
                  onChange={update('githubOwner')}
                  onPaste={onRepoPaste}
                  placeholder="Ongage-Ltd"
                  disabled={submitting}
                  required
                />
              </Field>
              <Field label="GitHub repo" error={errors.githubRepo} hint="Repo name only — not the URL.">
                <Input
                  value={form.githubRepo}
                  onChange={update('githubRepo')}
                  onPaste={onRepoPaste}
                  placeholder="ma-dms"
                  disabled={submitting}
                  required
                />
              </Field>
            </div>

            <Field
              label="GitHub fine-grained PAT"
              error={errors.githubToken}
              hint="Fine-grained PAT scoped to this single repo with read+write."
              info={
                <div className="space-y-1.5">
                  <p className="font-medium">Required permissions for this repo:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <strong>Contents</strong>: Read and write
                      <span className="text-neutral-400"> — clone, push fix branch</span>
                    </li>
                    <li>
                      <strong>Pull requests</strong>: Read and write
                      <span className="text-neutral-400"> — open the fix PR</span>
                    </li>
                    <li>
                      <strong>Metadata</strong>: Read-only
                      <span className="text-neutral-400"> — auto-included with other repo perms</span>
                    </li>
                  </ul>
                  <p className="text-neutral-400">
                    Create at github.com/settings/tokens?type=beta
                  </p>
                </div>
              }
            >
              <Input
                type="password"
                value={form.githubToken}
                onChange={update('githubToken')}
                placeholder="github_pat_..."
                disabled={submitting}
                required
                autoComplete="off"
              />
            </Field>

            <Field label="Base branch" error={errors.baseBranch}>
              <Input
                value={form.baseBranch}
                onChange={update('baseBranch')}
                placeholder="main"
                disabled={submitting}
                required
              />
            </Field>

            <Field
              label="Sentry base URL"
              error={errors.sentryBaseUrl}
              hint="Override only for self-hosted Sentry. Default: https://sentry.io"
            >
              <Input
                value={form.sentryBaseUrl}
                onChange={update('sentryBaseUrl')}
                placeholder="https://sentry.io"
                disabled={submitting}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Sentry org slug" error={errors.sentryOrgSlug}>
                <Input
                  value={form.sentryOrgSlug}
                  onChange={update('sentryOrgSlug')}
                  placeholder="acme"
                  disabled={submitting}
                  required
                />
              </Field>
              <Field label="Sentry project slug" error={errors.sentryProjectSlug}>
                <Input
                  value={form.sentryProjectSlug}
                  onChange={update('sentryProjectSlug')}
                  placeholder="my-app"
                  disabled={submitting}
                  required
                />
              </Field>
            </div>

            <Field
              label="Sentry auth token"
              error={errors.sentryAuthToken}
              hint="Needs the event:read scope to fetch unresolved issues + events."
              info={
                <div className="space-y-1.5">
                  <p className="font-medium">Required scope:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <strong>event:read</strong>
                      <span className="text-neutral-400"> — fetch issues + latest event payload</span>
                    </li>
                  </ul>
                  <p className="text-neutral-400">
                    Generate at: Settings → Account → API → Auth Tokens
                  </p>
                </div>
              }
            >
              <Input
                type="password"
                value={form.sentryAuthToken}
                onChange={update('sentryAuthToken')}
                placeholder="sntrys_..."
                disabled={submitting}
                required
                autoComplete="off"
              />
            </Field>

            <Field
              label="Extra Sentry query"
              error={errors.extraSentryQuery}
              hint="Appended to is:unresolved. e.g. level:error environment:production"
            >
              <Input
                value={form.extraSentryQuery}
                onChange={update('extraSentryQuery')}
                placeholder="level:error environment:production"
                disabled={submitting}
              />
            </Field>

            <Field
              label="Tick interval (seconds)"
              error={errors.tickIntervalSeconds}
              hint="How often to poll Sentry."
            >
              <Input
                type="number"
                min="1"
                value={form.tickIntervalSeconds}
                onChange={update('tickIntervalSeconds')}
                disabled={submitting}
              />
            </Field>

            {errors.body && (
              <p className="text-sm text-red-600">{errors.body}</p>
            )}
            {submitError && (
              <p className="text-sm text-red-600">{submitError}</p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Validating & cloning…' : 'Add Space'}
              </Button>
              <Link to="/">
                <Button type="button" variant="ghost" disabled={submitting}>
                  Cancel
                </Button>
              </Link>
              {submitting && (
                <span className="text-xs text-neutral-500">
                  Cloning repository — may take a minute.
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function Field({
  label,
  hint,
  error,
  info,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {info && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="More info"
                className="inline-flex cursor-help text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-left text-[11px] leading-snug">
              {info}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
      {hint && !error && (
        <p className="text-xs text-neutral-500">{hint}</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
