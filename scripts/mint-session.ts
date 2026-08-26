/**
 * Mint a session cookie for a seeded user, for local testing without a browser.
 *
 * Mirrors createSession() in src/lib/auth.ts: a random token goes to the caller,
 * only its SHA-256 is stored. Dev convenience only — it is not imported by the
 * app and does nothing an authenticated user could not already do.
 *
 *   npx tsx scripts/mint-session.ts pro@example.com
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Wrapped in main() rather than using top-level await: this package is CommonJS,
// and esbuild (via tsx) cannot emit top-level await into a cjs output.
async function main() {
  const email = process.argv[2] ?? 'pro@example.com';

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error(`No user ${email}. Run: npm run db:seed`);
    process.exit(1);
  }

  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      userAgent: 'scripts/mint-session.ts',
    },
  });

  console.log(token);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
