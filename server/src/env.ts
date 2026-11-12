import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const env = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '..', '..', 'data')),
  publicDir: path.resolve(process.env.PUBLIC_DIR ?? path.join(here, '..', 'public')),
  /** Optional bootstrap credentials (only used when no admin exists yet). */
  adminUser: process.env.ADMIN_USER ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
};

fs.mkdirSync(env.dataDir, { recursive: true });
