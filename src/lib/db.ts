/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter — the connection string no longer flows
 * from schema.prisma. `prisma.config.ts` covers the CLI; this covers runtime.
 *
 * The globalThis cache exists because Next dev reloads modules on every edit;
 * without it each reload opens a new pool and Postgres runs out of connections.
 */
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres database ' +
      '(locally: `npx prisma dev -d -n mta`, then `npx prisma dev ls` for the URL).'
  );
}

function createClient() {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
