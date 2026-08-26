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
  },
});
