/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter — the connection string no longer flows
 * from schema.prisma. `prisma.config.ts` covers the CLI; this covers runtime.
 *
 * Construction is LAZY, behind a Proxy. Reading DATABASE_URL at module scope
 * broke `next build`: collecting route configuration imports every module, so a
 * build machine without database credentials failed before it rendered
 * anything. A build has no business needing them. The error now surfaces on
 * first real query instead — same message, at a point where it is true.
 *
 * The globalThis cache exists because Next dev reloads modules on every edit;
 * without it each reload opens a new pool and Postgres runs out of connections.
 */
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres database ' +
        '(locally: `npx prisma dev -d -n mta`, then `npx prisma dev ls` for the URL).'
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function client(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const created = createClient();
  // Cache in dev to survive hot reloads; in production the module is evaluated
  // once per instance anyway, but caching keeps the two paths identical.
  globalForPrisma.prisma = created;
  return created;
}

/**
 * The Prisma client. Behaves exactly like a PrismaClient — the Proxy only
 * defers construction to the first property access.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(client(), prop, receiver);
    return typeof value === 'function' ? value.bind(client()) : value;
  },
  has(_target, prop) {
    return Reflect.has(client(), prop);
  },
});
