import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  dataDir: process.env.DATA_DIR ?? path.resolve(__dirname, '../../data'),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  webDistPath: process.env.WEB_DIST_PATH ?? path.resolve(__dirname, '../../web/dist'),
  migrationsPath: process.env.MIGRATIONS_PATH ?? path.resolve(__dirname, './migrations'),
};
