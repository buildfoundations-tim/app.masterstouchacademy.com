/**
 * Exercises the access rules against the real seeded database.
 *
 * These rules decide who can open what, so they get verified rather than
 * assumed. Run: npx tsx scripts/check-access.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { canAccessCourse, classDiscount, discountedCents, lockReason, TIER_LABEL } from '../src/lib/access';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

async function main() {
  const cec = await db.course.findUniqueOrThrow({ where: { slug: 'cecupholstery' } });
  const iicrc = await db.course.findUniqueOrThrow({ where: { slug: 'wrt' } });

  console.log('\nCourse access by tier (no purchases):');
  for (const tier of [1, 2, 3, 4]) {
    check(
      `tier ${tier} ${TIER_LABEL[tier]} -> CEC course`,
      canAccessCourse({ tier, course: cec, entitlements: [] }),
      tier >= 2
    );
    check(
      `tier ${tier} ${TIER_LABEL[tier]} -> IICRC course`,
      canAccessCourse({ tier, course: iicrc, entitlements: [] }),
      false // IICRC is a la carte at every tier, including Crew Leader
    );
  }

  console.log('\nPurchase overrides tier:');
  check(
    'tier 1 with a purchase -> IICRC course',
    canAccessCourse({ tier: 1, course: iicrc, entitlements: [{ courseId: iicrc.id, expiresAt: null }] }),
    true
  );
  check(
    'tier 1 with an EXPIRED purchase -> IICRC course',
    canAccessCourse({
      tier: 1,
      course: iicrc,
      entitlements: [{ courseId: iicrc.id, expiresAt: new Date('2020-01-01') }],
    }),
    false
  );
  check(
    'entitlement for a DIFFERENT course does not leak',
    canAccessCourse({ tier: 1, course: iicrc, entitlements: [{ courseId: cec.id, expiresAt: null }] }),
    false
  );

  console.log('\nLock reasons drive the paywall copy:');
  check('CEC locked -> upgrade or buy', lockReason({ tier: 1, course: cec, entitlements: [] }), 'upgrade-or-purchase');
  check('IICRC locked -> buy only', lockReason({ tier: 4, course: iicrc, entitlements: [] }), 'purchase-required');
  check('unlocked -> no reason', lockReason({ tier: 2, course: cec, entitlements: [] }), null);

  console.log('\nDiscounts:');
  check('tier 1 discount', classDiscount(1), 0);
  check('tier 2 discount', classDiscount(2), 0.1);
  check('tier 3 discount', classDiscount(3), 0.2);
  check('tier 4 discount', classDiscount(4), 0.2);
  check('$450 seat at Pro', discountedCents(45000, 2), 40500);
  check('$450 seat at Pro+', discountedCents(45000, 3), 36000);

  console.log('\nSeeded data sanity:');
  const counts = {
    courses: await db.course.count(),
    iicrc: await db.course.count({ where: { group: 'iicrc' } }),
    cec: await db.course.count({ where: { group: 'cec' } }),
    classes: await db.scheduledClass.count(),
    lessons: await db.lesson.count(),
  };
  check('11 courses', counts.courses, 11);
  check('6 IICRC + 5 CEC', [counts.iicrc, counts.cec], [6, 5]);
  check('3 scheduled classes', counts.classes, 3);
  check('10 lessons on the demo course', counts.lessons, 10);

  // CRT is the documented exception to the $100 live-stream rule.
  const crt = await db.course.findUniqueOrThrow({ where: { slug: 'crt' } });
  check('CRT live stream prices ABOVE the classroom seat', crt.priceLiveCents! > crt.priceCents, true);
  const others = await db.course.findMany({
    where: { group: 'iicrc', slug: { not: 'crt' }, priceLiveCents: { not: null } },
  });
  check(
    'every other IICRC course: live stream is exactly $100 under',
    others.every((c) => c.priceCents - c.priceLiveCents! === 10000),
    true
  );

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
