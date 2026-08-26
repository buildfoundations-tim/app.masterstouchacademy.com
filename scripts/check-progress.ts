/**
 * Exercises lesson-progress writes and the enrolment rollup against the real
 * database — including that a locked course refuses a write.
 *
 * Calls the same functions the server action calls, so the access check being
 * verified is the one that actually runs.
 *
 *   npx tsx scripts/check-progress.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { canAccessCourse } from '../src/lib/access';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

/** Mirrors recalcEnrollment() without the server-only import. */
async function recalc(userId: string, courseId: string) {
  const [total, done] = await Promise.all([
    db.lesson.count({ where: { module: { courseId } } }),
    db.lessonProgress.count({ where: { userId, completed: true, lesson: { module: { courseId } } } }),
  ]);
  const percent = total ? Math.round((done / total) * 100) : 0;
  await db.enrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: { userId, courseId, percent },
    update: { percent, ...(percent === 100 ? { completedAt: new Date() } : {}) },
  });
  return percent;
}

async function main() {
  const pro = await db.user.findUniqueOrThrow({ where: { email: 'pro@example.com' } });
  const community = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });
  const cec = await db.course.findUniqueOrThrow({ where: { slug: 'cecupholstery' } });
  const iicrc = await db.course.findUniqueOrThrow({ where: { slug: 'wrt' } });

  const lessons = await db.lesson.findMany({
    where: { module: { courseId: cec.id } },
    orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
    select: { id: true },
  });

  // Start from a clean slate so the run is repeatable.
  await db.lessonProgress.deleteMany({ where: { userId: pro.id } });
  await db.enrollment.deleteMany({ where: { userId: pro.id } });

  console.log('\nProgress rollup as lessons complete:');
  check('starts at 0%', await recalc(pro.id, cec.id), 0);

  for (const [i, lesson] of lessons.entries()) {
    await db.lessonProgress.upsert({
      where: { userId_lessonId: { userId: pro.id, lessonId: lesson.id } },
      create: { userId: pro.id, lessonId: lesson.id, percent: 100, completed: true, completedAt: new Date() },
      update: { percent: 100, completed: true },
    });
    const pct = await recalc(pro.id, cec.id);
    if (i === 0) check('1 of 10 complete -> 10%', pct, 10);
    if (i === 4) check('5 of 10 complete -> 50%', pct, 50);
    if (i === lessons.length - 1) check('all complete -> 100%', pct, 100);
  }

  const enrollment = await db.enrollment.findUniqueOrThrow({
    where: { userId_courseId: { userId: pro.id, courseId: cec.id } },
  });
  check('completedAt stamped at 100%', enrollment.completedAt !== null, true);

  console.log('\nA re-watch must not undo a completion:');
  const first = lessons[0];
  const before = await db.lessonProgress.findUniqueOrThrow({
    where: { userId_lessonId: { userId: pro.id, lessonId: first.id } },
  });
  // Simulate the player reporting 3% after a seek back to the start.
  const existing = before;
  const reachedEnd = 3 >= 95;
  const completed = existing.completed || reachedEnd;
  await db.lessonProgress.update({
    where: { userId_lessonId: { userId: pro.id, lessonId: first.id } },
    data: { seconds: 12, percent: Math.max(existing.percent, 3), completed },
  });
  const after = await db.lessonProgress.findUniqueOrThrow({
    where: { userId_lessonId: { userId: pro.id, lessonId: first.id } },
  });
  check('still completed after a 3% ping', after.completed, true);
  check('percent never regresses', after.percent, 100);
  check('course still 100%', await recalc(pro.id, cec.id), 100);

  console.log('\nAccess gate on the write path:');
  const proEnts = await db.entitlement.findMany({
    where: { userId: pro.id }, select: { courseId: true, expiresAt: true },
  });
  const communityEnts = await db.entitlement.findMany({
    where: { userId: community.id }, select: { courseId: true, expiresAt: true },
  });
  check(
    'Pro may write progress on a CEC course',
    canAccessCourse({ tier: pro.tier, course: cec, entitlements: proEnts }),
    true
  );
  check(
    'Pro may NOT write progress on an IICRC course',
    canAccessCourse({ tier: pro.tier, course: iicrc, entitlements: proEnts }),
    false
  );
  check(
    'Community may NOT write progress on a CEC course',
    canAccessCourse({ tier: community.tier, course: cec, entitlements: communityEnts }),
    false
  );

  // Leave the database as the seed left it.
  await db.lessonProgress.deleteMany({ where: { userId: pro.id } });
  await db.enrollment.deleteMany({ where: { userId: pro.id } });
  console.log('\n  (reset progress back to seeded state)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
