import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DbInitOptions = {
  dataDir: string;
  migrationsPath: string;
};

export type Db = Database.Database;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) throw new Error('db not initialized; call initDb first');
  return db;
}

export function initDb(opts: DbInitOptions): Db {
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const dbPath = path.join(opts.dataDir, 'app.db');
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  ensureMigrationsTable(instance);
  applyPendingMigrations(instance, opts.migrationsPath);

  db = instance;
  console.log(`db ready at ${dbPath}`);
  return instance;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function ensureMigrationsTable(d: Db): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function applyPendingMigrations(d: Db, migrationsPath: string): void {
  if (!fs.existsSync(migrationsPath)) return;

  const files = fs
    .readdirSync(migrationsPath)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (d.prepare('SELECT name FROM migrations').all() as { name: string }[]).map((r) => r.name),
  );

  const insert = d.prepare('INSERT INTO migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf-8');
    const tx = d.transaction(() => {
      d.exec(sql);
      insert.run(file);
    });
    tx();
    console.log(`migration applied: ${file}`);
  }
}
