/**
 * Promote an existing account to owner (and instructor).
 *
 * This is how the first admin is created in production: sign up through the
 * normal form, then run this against that address. It deliberately does not
 * create an account or set a password — nothing here can mint a login, so
 * running it is not a way in.
 *
 *   npx tsx scripts/make-owner.ts tom@masterstouchacademy.com
 *
 * Against production, prefix the real connection string:
 *   DATABASE_URL="postgres://…" npx tsx scripts/make-owner.ts tom@…
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx scripts/make-owner.ts <email>');
    process.exit(1);
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, tier: true },
  });

  if (!user) {
    console.error(`No account for ${email}.`);
    console.error('Sign up at /signup first — this script promotes, it does not create.');
    process.exit(1);
  }

  if (user.role === 'owner') {
    console.log(`${user.email} is already an owner.`);
    return;
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      // `owner` is a superset of `instructor` — one value, not two flags.
      role: 'owner',
      // Staff carry no membership tier. The owner used to be parked at 4,
      // which made them read as a Crew Leader subscriber everywhere; their
      // access comes from their role now. See isStaff() in src/lib/access.ts.
      tier: 1,
    },
    select: { email: true, firstName: true, lastName: true, tier: true, role: true },
  });

  console.log(`Promoted ${updated.firstName} ${updated.lastName} <${updated.email}>`);
  console.log(`  role: ${updated.role}  tier: ${updated.tier} (staff carry no membership)`);
  console.log('They can now reach /admin/classes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
