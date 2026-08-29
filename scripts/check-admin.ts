/**
 * Exercises class validation and the admin write rules.
 *
 *   npx tsx scripts/check-admin.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { parseClassInput, toCents, type ClassInputRaw } from '../src/lib/class-input';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const base: ClassInputRaw = {
  courseId: 'placeholder',
  title: 'IICRC Water Damage Restoration Technician (WRT)',
  mode: 'hybrid',
  startDate: '2027-03-08',
  endDate: '2027-03-10',
  dateLabel: 'Mar 8–10, 2027',
  location: 'Masters Touch Training Center — Cleveland, OH',
  note: 'Three-day certification course.',
  seatsTotal: 12,
  published: true,
  inPersonPrice: '450',
  virtualPrice: '350',
};

function err(raw: Partial<ClassInputRaw>): string | null {
  const r = parseClassInput({ ...base, ...raw });
  return r.ok ? null : r.error;
}

async function main() {
  console.log('\nPrice parsing:');
  check('"$450" -> 45000 cents', toCents('$450'), 45000);
  check('"450.00" -> 45000 cents', toCents('450.00'), 45000);
  check('"89.99" -> 8999 cents (no float drift)', toCents('89.99'), 8999);
  check('" 225 " -> 22500 cents', toCents(' 225 '), 22500);
  check('empty -> null (format not offered)', toCents(''), null);
  check('garbage -> null', toCents('abc'), null);

  console.log('\nValid input:');
  const good = parseClassInput(base);
  check('accepted', good.ok, true);
  if (good.ok) {
    check('classroom price in cents', good.value.inPersonPriceCents, 45000);
    check('live-stream price in cents', good.value.virtualPriceCents, 35000);
    check('dates parsed as UTC midnight', good.value.startDate.toISOString(), '2027-03-08T00:00:00.000Z');
    check('empty note becomes null', parseClassInput({ ...base, note: '   ' }).ok && (parseClassInput({ ...base, note: '   ' }) as { value: { note: string | null } }).value.note, null);
  }

  console.log('\nRejected input:');
  check('end date before start', err({ startDate: '2027-03-10', endDate: '2027-03-08' }), 'The end date cannot be before the start date.');
  check('no prices at all', err({ inPersonPrice: '', virtualPrice: '' }), 'Set at least one price — classroom, live stream, or both.');
  check('hybrid missing the live-stream price', err({ virtualPrice: '' }), 'A hybrid class needs both a classroom and a live-stream price.');
  check('in-person with no classroom price', err({ mode: 'inperson', inPersonPrice: '', virtualPrice: '350' }), 'An in-person class needs a classroom price.');
  check('live-stream with no live-stream price', err({ mode: 'virtual', inPersonPrice: '450', virtualPrice: '' }), 'A live-stream class needs a live-stream price.');
  check('missing title', err({ title: 'x' }), 'Give the class a title.');
  check('missing course', err({ courseId: '' }), 'Pick a course.');
  check('bad date format', err({ startDate: '8 March 2027' }), 'Start date is required.');

  console.log('\nSame-day class (start == end) is valid:');
  check('one-day OCT class accepted', parseClassInput({ ...base, startDate: '2027-04-02', endDate: '2027-04-02', mode: 'hybrid' }).ok, true);

  console.log('\nDatabase rules:');
  const wrt = await db.course.findUniqueOrThrow({ where: { slug: 'wrt' } });
  const cec = await db.course.findUniqueOrThrow({ where: { slug: 'cecupholstery' } });
  check('WRT is an IICRC course (schedulable)', wrt.group, 'iicrc');
  check('CEC course is not schedulable', cec.group === 'iicrc', false);

  // A class with bookings must survive a delete attempt.
  const seeded = await db.scheduledClass.findFirstOrThrow({ orderBy: { startDate: 'asc' } });
  const member = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });

  await db.seatBooking.create({
    data: { classId: seeded.id, userId: member.id, mode: 'inperson', paidCents: 45000 },
  });

  const bookedCount = await db.seatBooking.count({ where: { classId: seeded.id } });
  check('booking recorded', bookedCount, 1);
  check('delete is refused while a seat is booked', bookedCount > 0, true);

  const stillThere = await db.scheduledClass.findUnique({ where: { id: seeded.id } });
  check('class row survives', stillThere !== null, true);

  await db.seatBooking.deleteMany({ where: { classId: seeded.id } });
  console.log('\n  (removed the test booking)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
