/**
 * Exercises roll call and the CE hours it awards.
 *
 * The properties under test:
 *
 *  1. **The hours rule, exactly.** Present earns the class hours, late earns
 *     them less two, absent and unmarked earn none — and late never goes
 *     negative on a short class. These hours are what a member is audited on.
 *  2. **Only a booked seat can be marked.** Attendance awards credit, so
 *     marking someone who never bought a seat would mint CE hours out of a
 *     mis-click.
 *  3. **"Mark everyone present" does not overwrite.** An instructor who has
 *     already flagged two late arrivals must not lose that by pressing it.
 *
 *   npx tsx scripts/check-attendance.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import {
  hoursEarned,
  rollCall,
  markAttendance,
  markAllPresent,
  clearAttendance,
  classesForRollCall,
  LATE_PENALTY_HOURS,
} from '../src/lib/attendance';

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
  const klass = await db.scheduledClass.findFirstOrThrow({
    where: { published: true },
    select: { id: true, courseId: true, course: { select: { ceHours: true } } },
  });
  const community = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });
  const pro = await db.user.findUniqueOrThrow({ where: { email: 'pro@example.com' } });
  const stranger = await db.user.findFirstOrThrow({ where: { role: 'owner' } });

  // Clean slate: two booked seats, nobody marked.
  await db.attendance.deleteMany({ where: { classId: klass.id } });
  await db.seatBooking.deleteMany({ where: { classId: klass.id } });
  await db.seatBooking.createMany({
    data: [
      { classId: klass.id, userId: community.id, mode: 'inperson', paidCents: 45000 },
      { classId: klass.id, userId: pro.id, mode: 'virtual', paidCents: 35000 },
    ],
  });

  const CE = klass.course.ceHours;

  console.log('\nThe hours rule:');
  check('present earns the class hours', hoursEarned('present', 14), 14);
  check('late earns them less two', hoursEarned('late', 14), 14 - LATE_PENALTY_HOURS);
  check('absent earns none', hoursEarned('absent', 14), 0);
  check('unmarked earns none', hoursEarned(null, 14), 0);
  check('late on a one-hour class does not go negative', hoursEarned('late', 1), 0);
  check('late on a zero-hour class stays zero', hoursEarned('late', 0), 0);

  console.log('\nAn untouched roll:');
  let roll = (await rollCall(klass.id))!;
  check('lists both booked seats', roll.rows.length, 2);
  check('nobody marked', roll.counts.unmarked, 2);
  check('no hours awarded', roll.hoursAwarded, 0);
  check('and the formats come through', roll.rows.map((r) => r.mode).sort(), ['inperson', 'virtual']);

  console.log('\nMarking:');
  check('present accepted', (await markAttendance({ classId: klass.id, userId: community.id, status: 'present' })).ok, true);
  check('late accepted', (await markAttendance({ classId: klass.id, userId: pro.id, status: 'late' })).ok, true);
  roll = (await rollCall(klass.id))!;
  check('counted present', roll.counts.present, 1);
  check('counted late', roll.counts.late, 1);
  check('none left unmarked', roll.counts.unmarked, 0);
  check(
    'hours are the sum of the rule, not a stored number',
    roll.hoursAwarded,
    CE + Math.max(0, CE - LATE_PENALTY_HOURS)
  );

  console.log('\n  Re-marking replaces rather than stacking:');
  await markAttendance({ classId: klass.id, userId: community.id, status: 'absent' });
  roll = (await rollCall(klass.id))!;
  check('still two rows', roll.rows.length, 2);
  check('now absent', roll.counts.absent, 1);
  check('no longer present', roll.counts.present, 0);
  check('one attendance row per person', await db.attendance.count({ where: { classId: klass.id, userId: community.id } }), 1);

  console.log('\n  Undo puts them back to unmarked, which is not the same as absent:');
  await clearAttendance({ classId: klass.id, userId: community.id });
  roll = (await rollCall(klass.id))!;
  check('unmarked again', roll.counts.unmarked, 1);
  check('and not counted absent', roll.counts.absent, 0);
  check('their row shows no status', roll.rows.find((r) => r.userId === community.id)?.status, null);

  console.log('\nSomeone without a seat cannot be given credit:');
  const intruder = await markAttendance({ classId: klass.id, userId: stranger.id, status: 'present' });
  check('refused', intruder.ok, false);
  check('with a reason', !intruder.ok && intruder.reason.includes('seat'), true);
  check('and nothing was written', await db.attendance.count({ where: { classId: klass.id, userId: stranger.id } }), 0);
  check('the roll is unchanged', (await rollCall(klass.id))!.rows.length, 2);

  console.log('\nMark everyone present leaves existing marks alone:');
  // pro is still 'late' from earlier; community is unmarked.
  const bulk = await markAllPresent(klass.id);
  check('only the unmarked seat was filled', bulk.marked, 1);
  roll = (await rollCall(klass.id))!;
  check('the late mark survived', roll.counts.late, 1);
  check('the unmarked one is now present', roll.counts.present, 1);
  check('pressing it again does nothing', (await markAllPresent(klass.id)).marked, 0);

  console.log('\nThe class picker:');
  const listed = await classesForRollCall();
  const thisOne = listed.find((k) => k.id === klass.id);
  check('includes a class with bookings', thisOne !== undefined, true);
  check('reports how many are booked', thisOne?.booked, 2);
  check('and knows the roll is finished', thisOne?.complete, true);
  check(
    'classes with no bookings are left out',
    listed.every((k) => k.booked > 0),
    true
  );

  check('an unknown class returns null rather than throwing', await rollCall('nope'), null);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

/** In a `finally`, so an abort cannot leave seats and marks for other suites. */
async function reset() {
  const klass = await db.scheduledClass.findFirst({ where: { published: true }, select: { id: true } });
  if (!klass) return;
  await db.attendance.deleteMany({ where: { classId: klass.id } });
  await db.seatBooking.deleteMany({ where: { classId: klass.id } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await reset();
    console.log('  (fixture reset)');
    await db.$disconnect();
  });
