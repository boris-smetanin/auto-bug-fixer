import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Info, Trash2 } from 'lucide-react';
import type { Space, SpaceInput, ValidationErrors } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { deleteSpace, getSpace, updateSpace } from '@/lib/api';

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

export function EditSpace() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [space, setSpace] = useState<Space | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getSpace(id);
      setSpace(s);
      setForm({
        name: s.name,
        githubOwner: s.githubOwner,
        githubRepo: s.githubRepo,
        githubToken: '',
        baseBranch: s.baseBranch,
        sentryBaseUrl: s.sentryBaseUrl,
        sentryOrgSlug: s.sentryOrgSlug,
        sentryProjectSlug: s.sentryProjectSlug,
        sentryAuthToken: '',
        extraSentryQuery: s.extraSentryQuery,
        tickIntervalSeconds: String(s.tickIntervalSeconds),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!space || !form) {
    return (
      <main className="mx-auto p-8 max-w-2xl">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
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

    const input: Partial<SpaceInput> = {
      name: form.name.trim() || undefined,
      githubOwner: form.githubOwner.trim() || undefined,
      githubRepo: form.githubRepo.trim() || undefined,
      githubToken: form.githubToken || undefined,
      baseBranch: form.baseBranch.trim() || undefined,
      sentryBaseUrl: form.sentryBaseUrl.trim() || undefined,
      sentryOrgSlug: form.sentryOrgSlug.trim() || undefined,
      sentryProjectSlug: form.sentryProjectSlug.trim() || undefined,
      sentryAuthToken: form.sentryAuthToken || undefined,
      extraSentryQuery: form.extraSentryQuery,
      tickIntervalSeconds: Number(form.tickIntervalSeconds),
    };

    try {
      const result = await updateSpace(id, input);
      if (result.ok) {
        navigate(`/spaces/${id}`);
        return;
      }
      setErrors(result.errors);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    const ok = window.confirm(
      `Delete Space "${space.name}"?\n\nThis removes the Space, its clone, its logs, and all Fix Attempts.\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSpace(id);
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const deleteDisabled = deleting || space.fixLoopRunning;

  return (
    <main className="mx-auto p-8 max-w-2xl">
      <div className="mb-6">
        <Link to={`/spaces/${id}`} className="text-sm text-neutral-500 hover:underline">
          ← Back to {space.name}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Space</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Name" error={errors.name}>
              <Input value={form.name} onChange={update('name')} disabled={submitting} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="GitHub owner" error={errors.githubOwner}>
                <Input
                  value={form.githubOwner}
                  onChange={update('githubOwner')}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="GitHub repo"
                error={errors.githubRepo}
                hint="Changing owner/repo triggers a re-clone."
              >
                <Input
                  value={form.githubRepo}
                  onChange={update('githubRepo')}
                  disabled={submitting}
                />
              </Field>
            </div>

            <Field
              label="GitHub PAT"
              error={errors.githubToken}
              hint="Leave blank to keep the existing token."
              info={
                <div className="space-y-1.5">
                  <p className="font-medium">Required permissions:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li><strong>Contents</strong>: Read and write</li>
                    <li><strong>Pull requests</strong>: Read and write</li>
                    <li><strong>Metadata</strong>: Read-only</li>
                  </ul>
                </div>
              }
            >
              <Input
                type="password"
                value={form.githubToken}
                onChange={update('githubToken')}
                placeholder="(unchanged)"
                disabled={submitting}
                autoComplete="off"
              />
            </Field>

            <Field label="Base branch" error={errors.baseBranch}>
              <Input
                value={form.baseBranch}
                onChange={update('baseBranch')}
                disabled={submitting}
              />
            </Field>

            <Field
              label="Sentry base URL"
              error={errors.sentryBaseUrl}
              hint="Override only for self-hosted Sentry."
            >
              <Input
                value={form.sentryBaseUrl}
                onChange={update('sentryBaseUrl')}
                disabled={submitting}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Sentry org slug" error={errors.sentryOrgSlug}>
                <Input
                  value={form.sentryOrgSlug}
                  onChange={update('sentryOrgSlug')}
                  disabled={submitting}
                />
              </Field>
              <Field label="Sentry project slug" error={errors.sentryProjectSlug}>
                <Input
                  value={form.sentryProjectSlug}
                  onChange={update('sentryProjectSlug')}
                  disabled={submitting}
                />
              </Field>
            </div>

            <Field
              label="Sentry auth token"
              error={errors.sentryAuthToken}
              hint="Leave blank to keep the existing token."
              info={
                <div className="space-y-1.5">
                  <p className="font-medium">Required scope:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li><strong>event:read</strong></li>
                  </ul>
                </div>
              }
            >
              <Input
                type="password"
                value={form.sentryAuthToken}
                onChange={update('sentryAuthToken')}
                placeholder="(unchanged)"
                disabled={submitting}
                autoComplete="off"
              />
            </Field>

            <Field label="Extra Sentry query" error={errors.extraSentryQuery}>
              <Input
                value={form.extraSentryQuery}
                onChange={update('extraSentryQuery')}
                disabled={submitting}
                placeholder="level:error environment:production"
              />
            </Field>

            <Field label="Tick interval (seconds)" error={errors.tickIntervalSeconds}>
              <Input
                type="number"
                min="1"
                value={form.tickIntervalSeconds}
                onChange={update('tickIntervalSeconds')}
                disabled={submitting}
              />
            </Field>

            {errors.body && <p className="text-sm text-red-600">{errors.body}</p>}
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save changes'}
              </Button>
              <Link to={`/spaces/${id}`}>
                <Button type="button" variant="ghost" disabled={submitting}>
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6 border-red-300 dark:border-red-900">
        <CardHeader>
          <CardTitle className="text-base text-red-700 dark:text-red-300">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {space.fixLoopRunning ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              <Info className="inline h-3.5 w-3.5 mr-1 mb-0.5" />
              Stop the Fix Loop before deleting this Space.
            </p>
          ) : (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Removes the Space, its clone, its logs, and all Fix Attempts. Cannot be undone.
            </p>
          )}
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={() => void onDelete()}
                disabled={deleteDisabled}
                className="bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300 dark:disabled:bg-red-900"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {deleting ? 'Deleting…' : 'Delete Space'}
              </Button>
            </TooltipTrigger>
            {space.fixLoopRunning && (
              <TooltipContent>Stop the Fix Loop first</TooltipContent>
            )}
          </Tooltip>
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
      {hint && !error && <p className="text-xs text-neutral-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
