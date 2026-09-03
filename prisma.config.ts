// Prisma 7 CLI configuration.
//
// The connection URL lives here rather than in schema.prisma — Prisma 7 removed
// `url` from the datasource block. This file is used by the CLI (migrate,
// studio, db push). The runtime client gets its connection through a driver
// adapter instead; see src/lib/db.ts.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
    // Prisma replays every migration into a throwaway shadow database to detect
    // drift. `prisma dev` exposes one on the next port up; without pointing at
    // it, migrate reuses the main database and fails with "type already exists".
    // Unset in production — hosted Postgres providers handle this themselves.
    // `|| undefined` rather than a bare read: Prisma rejects an empty string
    // with P1013 instead of treating it as unset, and an empty value is exactly
    // what a hosting platform hands you for a variable that is not configured.
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] || undefined,
  },
});
