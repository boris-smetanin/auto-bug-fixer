import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GlobalSettings, ValidationErrors } from '@abf/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSettings, updateSettings } from '@/lib/api';

export function SettingsPage() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [retention, setRetention] = useState<string>('');
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setRetention(String(s.appLogRetentionDays));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSaved(false);
    setErrors({});
    try {
      const result = await updateSettings({
        appLogRetentionDays: Number(retention),
      });
      if (result.ok) {
        setSettings(result.settings);
        setRetention(String(result.settings.appLogRetentionDays));
        setSaved(true);
      } else {
        setErrors(result.errors);
      }
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto p-8 max-w-2xl">
      <div className="mb-6">
        <Link to="/" className="text-sm text-neutral-500 hover:underline">
          ← Back to Spaces
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Global Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}
          {settings && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="retention">App log retention (days)</Label>
                <Input
                  id="retention"
                  type="number"
                  min="1"
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                  disabled={submitting}
                />
                <p className="text-xs text-neutral-500">
                  How long to keep daily app log files (<code>/data/logs/app-YYYY-MM-DD.log</code>).
                  Files older than this are removed by a hourly cleanup task.
                </p>
                {errors.appLogRetentionDays && (
                  <p className="text-xs text-red-600">{errors.appLogRetentionDays}</p>
                )}
              </div>
              {errors.form && <p className="text-sm text-red-600">{errors.form}</p>}
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save'}
                </Button>
                {saved && (
                  <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</span>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <Link to="/app-logs" className="text-sm text-neutral-500 hover:underline">
          View app logs →
        </Link>
      </div>
    </main>
  );
}
