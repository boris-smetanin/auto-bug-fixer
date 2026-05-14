import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAppLog, listAppLogs, type AppLogFile } from '@/lib/api';

export function AppLogsPage() {
  const [files, setFiles] = useState<AppLogFile[] | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listAppLogs();
      setFiles(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onView = async (date: string) => {
    setActiveDate(date);
    setContent(null);
    try {
      const text = await getAppLog(date);
      setContent(text);
    } catch (err) {
      setContent(`(error loading: ${err instanceof Error ? err.message : String(err)})`);
    }
  };

  return (
    <main className="mx-auto p-8 max-w-5xl">
      <div className="mb-6">
        <Link to="/settings" className="text-sm text-neutral-500 hover:underline">
          ← Back to Settings
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>App Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {files === null && <p className="text-sm text-neutral-500">Loading…</p>}
          {files?.length === 0 && (
            <p className="text-sm text-neutral-500">No app log files yet.</p>
          )}
          {files && files.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 dark:border-neutral-800">
                <tr className="text-left">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Size</th>
                  <th className="py-2 pr-4 font-medium">Modified</th>
                  <th className="py-2 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.date}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className="py-2 pr-4 font-mono">{f.date}</td>
                    <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                      {formatBytes(f.sizeBytes)}
                    </td>
                    <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                      {new Date(f.mtime).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => void onView(f.date)}
                        className="cursor-pointer text-neutral-700 hover:underline dark:text-neutral-300"
                      >
                        {activeDate === f.date ? 'reloading…' : 'view'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {activeDate && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">app-{activeDate}.log</CardTitle>
          </CardHeader>
          <CardContent>
            {content === null ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : (
              <pre className="max-h-[40rem] overflow-auto rounded bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed dark:bg-neutral-950 whitespace-pre-wrap break-words">
                {content || '(empty)'}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
