/**
 * Exercises the course builder, and mostly its ordering.
 *
 * Module and Lesson both carry a unique constraint on (parent, position). That
 * constraint is checked per statement, so the naive swap — set A to B's slot,
 * then B to A's — fails on the first write. Every assertion about `move` and
 * `delete` below is really an assertion that the park-then-swap dance holds,
 * because the failure mode is a 500 in the middle of an edit.
 *
 * The invariant asserted after every mutation: positions are 0..n-1, in order,
 * with no gaps and no duplicates.
 *
 *   npx tsx scripts/check-builder.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import {
  listCoursesForBuilder,
  courseOutline,
  saveCourse,
  setPublished,
  addModule,
  renameModule,
  deleteModule,
  moveModule,
  addLesson,
  saveLesson,
  deleteLesson,
  moveLesson,
  type CourseMeta,
} from '../src/lib/course-builder';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const SLUG = 'zz-builder-fixture';

const META: CourseMeta = {
  slug: SLUG,
  code: 'ZZB',
  group: 'cec',
  title: 'Builder fixture',
  blurb: 'Created by check-builder.ts',
  description: 'Deleted again at the end of the run.',
  priceCents: 12300,
  priceLiveCents: null,
  hours: 4,
  days: 'Self-paced',
  level: 'Intro',
  tag: 'CEC',
  ceHours: 4,
  passingScore: 80,
  published: false,
  sortOrder: 999,
};

/** Positions must always be 0..n-1 in listed order. */
async function positions(courseId: string): Promise<number[]> {
  const outline = await courseOutline(courseId);
  return outline!.modules.map((m) => m.position);
}

async function lessonPositions(courseId: string, moduleIndex: number): Promise<number[]> {
  const outline = await courseOutline(courseId);
  return outline!.modules[moduleIndex].lessons.map((l) => l.position);
}

async function moduleTitles(courseId: string): Promise<string[]> {
  const outline = await courseOutline(courseId);
  return outline!.modules.map((m) => m.title);
}

async function main() {
  await wipeFixture();

  console.log('\nCreating a course:');
  const created = await saveCourse(null, META);
  check('created', created.ok, true);
  const courseId = created.ok ? created.id! : '';
  check('it appears in the builder list', (await listCoursesForBuilder()).some((c) => c.id === courseId), true);
  check('with no modules yet', (await courseOutline(courseId))!.modules.length, 0);

  console.log('\n  Validation refuses what the classroom could not render:');
  check('no title', (await saveCourse(courseId, { ...META, title: '  ' })).ok, false);
  check('no code', (await saveCourse(courseId, { ...META, code: '' })).ok, false);
  check('a slug with spaces', (await saveCourse(courseId, { ...META, slug: 'not a slug' })).ok, false);
  check('a slug with capitals', (await saveCourse(courseId, { ...META, slug: 'NotASlug' })).ok, false);
  check('a negative price', (await saveCourse(courseId, { ...META, priceCents: -1 })).ok, false);
  check('a passing score of 0', (await saveCourse(courseId, { ...META, passingScore: 0 })).ok, false);
  check('a passing score over 100', (await saveCourse(courseId, { ...META, passingScore: 101 })).ok, false);

  console.log('\n  A slug already in use is caught here, not by the database:');
  const existing = await db.course.findFirstOrThrow({ where: { slug: 'wrt' }, select: { slug: true } });
  const dupe = await saveCourse(courseId, { ...META, slug: existing.slug });
  check('refused', dupe.ok, false);
  check('with a reason naming the slug', !dupe.ok && dupe.reason.includes(existing.slug), true);
  check('and the course kept its own slug', (await courseOutline(courseId))!.slug, SLUG);

  console.log('\nModules:');
  check('add the first', (await addModule(courseId, 'One')).ok, true);
  await addModule(courseId, 'Two');
  await addModule(courseId, 'Three');
  check('three of them', await moduleTitles(courseId), ['One', 'Two', 'Three']);
  check('numbered from zero, no gaps', await positions(courseId), [0, 1, 2]);
  check('a module needs a title', (await addModule(courseId, '   ')).ok, false);

  console.log('\n  Moving — the swap the unique constraint makes awkward:');
  const outline1 = await courseOutline(courseId);
  await moveModule(outline1!.modules[2].id, 'up');
  check('the third moved up', await moduleTitles(courseId), ['One', 'Three', 'Two']);
  check('positions still 0..n-1', await positions(courseId), [0, 1, 2]);

  const outline2 = await courseOutline(courseId);
  await moveModule(outline2!.modules[0].id, 'down');
  check('the first moved down', await moduleTitles(courseId), ['Three', 'One', 'Two']);
  check('positions still 0..n-1', await positions(courseId), [0, 1, 2]);

  const outline3 = await courseOutline(courseId);
  check('moving the top one up is a harmless no-op', (await moveModule(outline3!.modules[0].id, 'up')).ok, true);
  check('nothing changed', await moduleTitles(courseId), ['Three', 'One', 'Two']);
  check('moving the last one down is too', (await moveModule(outline3!.modules[2].id, 'down')).ok, true);
  check('still nothing changed', await moduleTitles(courseId), ['Three', 'One', 'Two']);

  // Round trip: a module moved down and back up lands where it started. This
  // is what would catch a swap that silently drops or duplicates a row.
  //
  // The last module is excluded on purpose: "down" is a no-op there while "up"
  // is not, so down-then-up genuinely moves it. That is correct behaviour for
  // two buttons, just not a round trip.
  const beforeTrip = await moduleTitles(courseId);
  const trippable = (await courseOutline(courseId))!.modules.slice(0, -1);
  for (const m of trippable) {
    await moveModule(m.id, 'down');
    await moveModule(m.id, 'up');
  }
  check('a down-then-up round trip is identity', await moduleTitles(courseId), beforeTrip);
  check('and positions survived it', await positions(courseId), [0, 1, 2]);

  console.log('\n  Renaming:');
  const first = (await courseOutline(courseId))!.modules[0];
  check('renamed', (await renameModule(first.id, 'Renamed')).ok, true);
  check('it took', (await moduleTitles(courseId))[0], 'Renamed');
  check('an empty title is refused', (await renameModule(first.id, '')).ok, false);

  console.log('\nLessons:');
  const target = (await courseOutline(courseId))!.modules[0];
  check('a text lesson', (await addLesson(target.id, lesson('A', 'text'))).ok, true);
  await addLesson(target.id, lesson('B', 'text'));
  await addLesson(target.id, lesson('C', 'text'));
  check('three, numbered from zero', await lessonPositions(courseId, 0), [0, 1, 2]);

  console.log('\n  Each type must carry its own content:');
  check('a video lesson without an asset key', (await addLesson(target.id, { ...lesson('V', 'video'), assetKey: null })).ok, false);
  check('a text lesson without a body', (await addLesson(target.id, { ...lesson('T', 'text'), body: null })).ok, false);
  check('a resource lesson without a link', (await addLesson(target.id, { ...lesson('R', 'resource'), resourceUrl: null })).ok, false);
  check('a lesson without a title', (await addLesson(target.id, lesson('  ', 'text'))).ok, false);
  check('a negative duration', (await addLesson(target.id, { ...lesson('D', 'video'), assetKey: 'k', durationSeconds: -5 })).ok, false);
  check('none of those were written', (await lessonPositions(courseId, 0)).length, 3);

  console.log('\n  A well-formed video lesson goes in:');
  const vid = await addLesson(target.id, { ...lesson('V', 'video'), assetKey: 'wrt-01', durationSeconds: 930 });
  check('accepted', vid.ok, true);
  const withVideo = (await courseOutline(courseId))!.modules[0].lessons.find((l) => l.title === 'V');
  check('the asset key is stored, not a URL', withVideo?.assetKey, 'wrt-01');
  check('with its duration', withVideo?.durationSeconds, 930);

  console.log('\n  Moving lessons:');
  const lessons = (await courseOutline(courseId))!.modules[0].lessons;
  await moveLesson(lessons[3].id, 'up');
  check('the fourth moved up', (await courseOutline(courseId))!.modules[0].lessons.map((l) => l.title), ['A', 'B', 'V', 'C']);
  check('positions still 0..n-1', await lessonPositions(courseId, 0), [0, 1, 2, 3]);

  console.log('\n  Editing:');
  const toEdit = (await courseOutline(courseId))!.modules[0].lessons[0];
  check('saved', (await saveLesson(toEdit.id, { ...lesson('A renamed', 'text') })).ok, true);
  check('the title changed', (await courseOutline(courseId))!.modules[0].lessons[0].title, 'A renamed');
  check('an invalid edit is refused', (await saveLesson(toEdit.id, { ...lesson('X', 'video'), assetKey: null })).ok, false);
  check('and the lesson is untouched', (await courseOutline(courseId))!.modules[0].lessons[0].title, 'A renamed');

  console.log('\n  Deleting closes the gap:');
  const before = (await courseOutline(courseId))!.modules[0].lessons;
  await deleteLesson(before[1].id);
  const after = (await courseOutline(courseId))!.modules[0].lessons;
  check('one fewer', after.length, before.length - 1);
  check('the right one went', after.map((l) => l.title), ['A renamed', 'V', 'C']);
  check('no gap left behind', await lessonPositions(courseId, 0), [0, 1, 2]);
  check('deleting it again is refused, not a crash', (await deleteLesson(before[1].id)).ok, false);

  console.log('\nPublishing:');
  const empty = (await courseOutline(courseId))!.modules[1];
  check('a course with lessons can be published', (await setPublished(courseId, true)).ok, true);
  check('and it is', (await courseOutline(courseId))!.published, true);
  await setPublished(courseId, false);

  // Strip every lesson, then try again.
  for (const m of (await courseOutline(courseId))!.modules) {
    for (const l of m.lessons) await deleteLesson(l.id);
  }
  const emptyPublish = await setPublished(courseId, true);
  check('a course with no lessons is refused', emptyPublish.ok, false);
  check('with a reason a person can act on', !emptyPublish.ok && emptyPublish.reason.includes('lesson'), true);
  check('and it stayed unpublished', (await courseOutline(courseId))!.published, false);
  check('(the second module was empty all along)', empty.lessons.length, 0);

  console.log('\n  Deleting a module takes its lessons and closes the gap:');
  await addLesson((await courseOutline(courseId))!.modules[1].id, lesson('Only', 'text'));
  const lessonCountBefore = await db.lesson.count({ where: { module: { courseId } } });
  const doomed = (await courseOutline(courseId))!.modules[1];
  await deleteModule(doomed.id);
  check('the module is gone', await moduleTitles(courseId), ['Renamed', 'Two']);
  check('positions closed up', await positions(courseId), [0, 1]);
  check('its lesson went with it', await db.lesson.count({ where: { module: { courseId } } }), lessonCountBefore - 1);
  check('deleting it again is refused', (await deleteModule(doomed.id)).ok, false);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

function lesson(title: string, type: 'video' | 'text' | 'resource') {
  return {
    title,
    type,
    assetKey: type === 'video' ? 'key' : null,
    durationSeconds: null,
    body: type === 'text' ? 'Body copy.' : null,
    resourceUrl: type === 'resource' ? 'https://example.com/x.pdf' : null,
  };
}

/** The fixture is a whole course, so it is created and removed by id. */
async function wipeFixture() {
  const existing = await db.course.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (existing) await db.course.delete({ where: { id: existing.id } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await wipeFixture();
    console.log('  (fixture course removed)');
    await db.$disconnect();
  });
