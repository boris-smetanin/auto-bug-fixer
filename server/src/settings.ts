import type { GlobalSettings } from '@abf/shared';
import { getDb } from './core/db.js';

type SettingsRow = {
  id: number;
  app_log_retention_days: number;
};

function rowToSettings(row: SettingsRow): GlobalSettings {
  return { appLogRetentionDays: row.app_log_retention_days };
}

export function getSettings(): GlobalSettings {
  const row = getDb()
    .prepare('SELECT * FROM settings WHERE id = 1')
    .get() as SettingsRow | undefined;
  if (!row) throw new Error('settings row missing');
  return rowToSettings(row);
}

export function updateSettings(fields: Partial<GlobalSettings>): GlobalSettings {
  const current = getSettings();
  const merged: GlobalSettings = {
    appLogRetentionDays: fields.appLogRetentionDays ?? current.appLogRetentionDays,
  };
  const row = getDb()
    .prepare(
      `UPDATE settings
       SET app_log_retention_days = ?
       WHERE id = 1
       RETURNING *`,
    )
    .get(merged.appLogRetentionDays) as SettingsRow | undefined;
  if (!row) throw new Error('settings row missing on update');
  return rowToSettings(row);
}
