/**
 * Editing the catalogue: courses, their modules, and the lessons inside them.
 *
 * The point of this module is that the school's content stops needing a
 * developer and a database client. Everything the classroom renders — a
 * course's copy and price, its module outline, each lesson's body or video
 * key — is writable from here.
 *
 * ## Ordering is the hard part
 *
 * `Module` has `@@unique([courseId, position])` and `Lesson` has
 * `@@unique([moduleId, position])`. Those constraints are what stop two
 * lessons claiming slot 3, and they are checked **per statement**, not at the
 * end of the transaction. So the obvious swap —
 *
 *     UPDATE a SET position = 2;   -- boom: b already holds 2
 *     UPDATE b SET position = 1;
 *
 * fails on the first statement. Every reorder here therefore parks one row at a
 * negative position first, which no real row ever holds, and the three writes
 * run in a transaction so a crash cannot leave that placeholder behind.
 *
 * Deletes renumber what is left, so positions stay 0..n-1 with no gaps. Gaps
 * are not wrong exactly, but they make "move down" ambiguous and they leak into
 * any future code that treats position as an index.
 *
 * No `server-only`: the checks exercise these directly, and the ordering
 * invariants are the main thing worth asserting.
 */
import { db } from '@/lib/db';
import type { CourseGroup, LessonType } from '@/generated/prisma/enums';

/** Where a row is parked mid-swap. Never a resting value. */
const PARKED = -1;

export type Direction = 'up' | 'down';

export type BuilderResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { id?: string } : { value: T }))
  | { ok: false; reason: string };

/** Courses with enough shape to pick one to edit. */
export async function listCoursesForBuilder() {
  const rows = await db.course.findMany({
    orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true, slug: true, code: true, title: true, group: true, published: true,
      priceCents: true, hours: true, ceHours: true,
      modules: { select: { _count: { select: { lessons: true } } } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    code: c.code,
    title: c.title,
    group: c.group,
    published: c.published,
    priceCents: c.priceCents,
    hours: c.hours,
    ceHours: c.ceHours,
    moduleCount: c.modules.length,
    lessonCount: c.modules.reduce((a, m) => a + m._count.lessons, 0),
  }));
}

/** One course with its whole outline, in order. */
export async function courseOutline(courseId: string) {
  return db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true, slug: true, code: true, group: true, title: true, blurb: true,
      description: true, priceCents: true, priceLiveCents: true, hours: true,
      days: true, level: true, tag: true, ceHours: true, passingScore: true,
      published: true, sortOrder: true,
      modules: {
        orderBy: { position: 'asc' },
        select: {
          id: true, title: true, position: true,
          lessons: {
            orderBy: { position: 'asc' },
            select: {
              id: true, title: true, type: true, position: true,
              assetKey: true, durationSeconds: true, body: true, resourceUrl: true,
            },
          },
        },
      },
    },
  });
}

/* ── Course ──────────────────────────────────────────────── */

export type CourseMeta = {
  slug: string;
  code: string;
  group: CourseGroup;
  title: string;
  blurb: string;
  description: string;
  priceCents: number;
  priceLiveCents: number | null;
  hours: number;
  days: string;
  level: string;
  tag: string;
  ceHours: number;
  passingScore: number;
  published: boolean;
  sortOrder: number;
};

function validateMeta(meta: CourseMeta): string | null {
  if (!meta.title.trim()) return 'A course needs a title.';
  if (!meta.code.trim()) return 'A course needs a code, e.g. WRT.';
  if (!/^[a-z0-9-]+$/.test(meta.slug)) {
    return 'The slug is part of the URL: lowercase letters, numbers and hyphens only.';
  }
  if (meta.priceCents < 0) return 'A price cannot be negative.';
  if (meta.passingScore < 1 || meta.passingScore > 100) {
    return 'The passing score is a percentage between 1 and 100.';
  }
  return null;
}

export async function saveCourse(
  courseId: string | null,
  meta: CourseMeta
): Promise<BuilderResult> {
  const invalid = validateMeta(meta);
  if (invalid) return { ok: false, reason: invalid };

  // The slug is in the URL of a page members bookmark, so a collision has to be
  // caught here rather than surfacing as a unique-constraint error.
  const clash = await db.course.findFirst({
    where: { slug: meta.slug, ...(courseId ? { id: { not: courseId } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, reason: `Another course already uses the slug “${meta.slug}”.` };

  if (courseId) {
    await db.course.update({ where: { id: courseId }, data: meta });
    return { ok: true, id: courseId };
  }

  const created = await db.course.create({ data: meta, select: { id: true } });
  return { ok: true, id: created.id };
}

/**
 * Publishing gate.
 *
 * A published course appears in the catalogue and can be bought. One with no
 * lessons would take a member's money and show them an empty page, so that is
 * refused rather than left to be noticed later.
 */
export async function setPublished(
  courseId: string,
  published: boolean
): Promise<BuilderResult> {
  if (published) {
    const lessons = await db.lesson.count({ where: { module: { courseId } } });
    if (lessons === 0) {
      return { ok: false, reason: 'Add at least one lesson before publishing — otherwise a buyer gets an empty course.' };
    }
  }
  await db.course.update({ where: { id: courseId }, data: { published } });
  return { ok: true };
}

/* ── Modules ─────────────────────────────────────────────── */

export async function addModule(courseId: string, title: string): Promise<BuilderResult> {
  if (!title.trim()) return { ok: false, reason: 'A module needs a title.' };

  const last = await db.module.findFirst({
    where: { courseId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const created = await db.module.create({
    data: { courseId, title: title.trim(), position: (last?.position ?? -1) + 1 },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export async function renameModule(moduleId: string, title: string): Promise<BuilderResult> {
  if (!title.trim()) return { ok: false, reason: 'A module needs a title.' };
  await db.module.update({ where: { id: moduleId }, data: { title: title.trim() } });
  return { ok: true };
}

/** Deletes the module and its lessons, then closes the gap it left. */
export async function deleteModule(moduleId: string): Promise<BuilderResult> {
  const mod = await db.module.findUnique({ where: { id: moduleId }, select: { courseId: true } });
  if (!mod) return { ok: false, reason: 'That module is already gone.' };

  await db.$transaction(async (tx) => {
    await tx.module.delete({ where: { id: moduleId } });

    const rest = await tx.module.findMany({
      where: { courseId: mod.courseId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await renumber(tx, 'module', rest);
  });

  return { ok: true };
}

export async function moveModule(moduleId: string, direction: Direction): Promise<BuilderResult> {
  const mod = await db.module.findUnique({
    where: { id: moduleId },
    select: { id: true, courseId: true, position: true },
  });
  if (!mod) return { ok: false, reason: 'That module is already gone.' };

  const neighbour = await db.module.findFirst({
    where: {
      courseId: mod.courseId,
      position: direction === 'up' ? { lt: mod.position } : { gt: mod.position },
    },
    orderBy: { position: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, position: true },
  });
  // Already at the end. Not an error — the button is simply a no-op there.
  if (!neighbour) return { ok: true };

  await swap(
    (id, position) => db.module.update({ where: { id }, data: { position } }),
    mod,
    neighbour
  );
  return { ok: true };
}

/* ── Lessons ─────────────────────────────────────────────── */

export type LessonInput = {
  title: string;
  type: LessonType;
  assetKey: string | null;
  durationSeconds: number | null;
  body: string | null;
  resourceUrl: string | null;
};

function validateLesson(input: LessonInput): string | null {
  if (!input.title.trim()) return 'A lesson needs a title.';
  // Each type carries different content, and a lesson missing its own content
  // renders as a blank page in the player rather than failing loudly.
  if (input.type === 'video' && !input.assetKey?.trim()) {
    return 'A video lesson needs an asset key — the stable id the server resolves to a Vimeo video.';
  }
  if (input.type === 'text' && !input.body?.trim()) return 'A text lesson needs some body text.';
  if (input.type === 'resource' && !input.resourceUrl?.trim()) {
    return 'A resource lesson needs a link.';
  }
  if (input.durationSeconds !== null && input.durationSeconds < 0) {
    return 'A duration cannot be negative.';
  }
  return null;
}

export async function addLesson(moduleId: string, input: LessonInput): Promise<BuilderResult> {
  const invalid = validateLesson(input);
  if (invalid) return { ok: false, reason: invalid };

  const last = await db.lesson.findFirst({
    where: { moduleId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const created = await db.lesson.create({
    data: {
      moduleId,
      title: input.title.trim(),
      type: input.type,
      position: (last?.position ?? -1) + 1,
      assetKey: input.assetKey?.trim() || null,
      durationSeconds: input.durationSeconds,
      body: input.body?.trim() || null,
      resourceUrl: input.resourceUrl?.trim() || null,
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export async function saveLesson(lessonId: string, input: LessonInput): Promise<BuilderResult> {
  const invalid = validateLesson(input);
  if (invalid) return { ok: false, reason: invalid };

  await db.lesson.update({
    where: { id: lessonId },
    data: {
      title: input.title.trim(),
      type: input.type,
      assetKey: input.assetKey?.trim() || null,
      durationSeconds: input.durationSeconds,
      body: input.body?.trim() || null,
      resourceUrl: input.resourceUrl?.trim() || null,
    },
  });
  return { ok: true, id: lessonId };
}

export async function deleteLesson(lessonId: string): Promise<BuilderResult> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { moduleId: true },
  });
  if (!lesson) return { ok: false, reason: 'That lesson is already gone.' };

  await db.$transaction(async (tx) => {
    // LessonProgress cascades from the lesson, so a member's record of a
    // deleted lesson goes with it rather than dangling.
    await tx.lesson.delete({ where: { id: lessonId } });

    const rest = await tx.lesson.findMany({
      where: { moduleId: lesson.moduleId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await renumber(tx, 'lesson', rest);
  });

  return { ok: true };
}

export async function moveLesson(lessonId: string, direction: Direction): Promise<BuilderResult> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, moduleId: true, position: true },
  });
  if (!lesson) return { ok: false, reason: 'That lesson is already gone.' };

  const neighbour = await db.lesson.findFirst({
    where: {
      moduleId: lesson.moduleId,
      position: direction === 'up' ? { lt: lesson.position } : { gt: lesson.position },
    },
    orderBy: { position: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, position: true },
  });
  if (!neighbour) return { ok: true };

  await swap(
    (id, position) => db.lesson.update({ where: { id }, data: { position } }),
    lesson,
    neighbour
  );
  return { ok: true };
}

/* ── Ordering helpers ────────────────────────────────────── */

/**
 * Exchange two rows' positions without ever having both hold the same value.
 *
 * The park-then-swap dance exists because the unique constraint is checked per
 * statement. All three writes are one transaction, so an interruption cannot
 * strand a row at the parked position.
 */
async function swap(
  update: (id: string, position: number) => Promise<unknown>,
  a: { id: string; position: number },
  b: { id: string; position: number }
): Promise<void> {
  await db.$transaction([
    update(a.id, PARKED) as never,
    update(b.id, a.position) as never,
    update(a.id, b.position) as never,
  ]);
}

/**
 * Rewrite positions as 0..n-1 in the given order.
 *
 * Two passes, for the same reason as `swap`: assigning final positions directly
 * can collide with a row that has not moved yet, so everything is parked into a
 * disjoint negative range first.
 */
async function renumber(
  tx: {
    module: { update: (args: { where: { id: string }; data: { position: number } }) => Promise<unknown> };
    lesson: { update: (args: { where: { id: string }; data: { position: number } }) => Promise<unknown> };
  },
  table: 'module' | 'lesson',
  rows: Array<{ id: string }>
): Promise<void> {
  const model = table === 'module' ? tx.module : tx.lesson;

  for (const [i, row] of rows.entries()) {
    await model.update({ where: { id: row.id }, data: { position: -(i + 1) } });
  }
  for (const [i, row] of rows.entries()) {
    await model.update({ where: { id: row.id }, data: { position: i } });
  }
}
