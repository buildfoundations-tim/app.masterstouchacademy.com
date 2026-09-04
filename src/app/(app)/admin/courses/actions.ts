'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireOwner } from '@/lib/admin';
import {
  saveCourse, setPublished,
  addModule, renameModule, deleteModule, moveModule,
  addLesson, saveLesson, deleteLesson, moveLesson,
  type CourseMeta, type LessonInput, type Direction,
} from '@/lib/course-builder';
import type { CourseGroup, LessonType } from '@/generated/prisma/enums';
import type { BuilderState } from './state';

/**
 * Course-builder actions.
 *
 * requireOwner() first in every one: the /admin layout gates the pages, but a
 * server action is a public endpoint that the layout never runs for.
 *
 * Prices arrive as dollars because that is what a person types, and are turned
 * into cents here — the database never sees a float.
 */

function cents(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function int(value: FormDataEntryValue | null, fallback = 0): number {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function text(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim();
}

function metaFrom(formData: FormData): CourseMeta {
  const live = text(formData.get('priceLive'));
  return {
    slug: text(formData.get('slug')).toLowerCase(),
    code: text(formData.get('code')).toUpperCase(),
    group: (text(formData.get('group')) === 'cec' ? 'cec' : 'iicrc') as CourseGroup,
    title: text(formData.get('title')),
    blurb: text(formData.get('blurb')),
    description: text(formData.get('description')),
    priceCents: cents(formData.get('price')),
    // Empty means "no live-stream option", which is different from free.
    priceLiveCents: live === '' ? null : cents(live),
    hours: int(formData.get('hours')),
    days: text(formData.get('days')),
    level: text(formData.get('level')),
    tag: text(formData.get('tag')),
    ceHours: int(formData.get('ceHours')),
    passingScore: int(formData.get('passingScore'), 80),
    published: false, // publishing is its own action, with its own guard
    sortOrder: int(formData.get('sortOrder')),
  };
}

export async function saveCourseMeta(
  _prev: BuilderState,
  formData: FormData
): Promise<BuilderState> {
  await requireOwner();

  const id = text(formData.get('courseId')) || null;
  const meta = metaFrom(formData);

  // Keep whatever the publish toggle already decided; this form does not own it.
  const wasPublished = text(formData.get('published')) === 'true';
  const result = await saveCourse(id, { ...meta, published: wasPublished });

  if (!result.ok) return { error: result.reason, note: null };

  revalidatePath('/admin/courses');
  if (!id) redirect(`/admin/courses/${result.id}`);

  revalidatePath(`/admin/courses/${id}`);
  return { error: null, note: 'Saved.' };
}

export async function togglePublished(formData: FormData): Promise<void> {
  await requireOwner();

  const courseId = text(formData.get('courseId'));
  const next = text(formData.get('next')) === 'true';
  if (!courseId) return;

  await setPublished(courseId, next);
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function createModule(
  _prev: BuilderState,
  formData: FormData
): Promise<BuilderState> {
  await requireOwner();

  const courseId = text(formData.get('courseId'));
  const result = await addModule(courseId, text(formData.get('title')));
  revalidatePath(`/admin/courses/${courseId}`);

  return result.ok ? { error: null, note: 'Module added.' } : { error: result.reason, note: null };
}

/** Rename, delete and move all arrive from small single-button forms. */
export async function moduleAction(formData: FormData): Promise<void> {
  await requireOwner();

  const courseId = text(formData.get('courseId'));
  const moduleId = text(formData.get('moduleId'));
  const verb = text(formData.get('verb'));
  if (!moduleId) return;

  if (verb === 'rename') await renameModule(moduleId, text(formData.get('title')));
  else if (verb === 'delete') await deleteModule(moduleId);
  else if (verb === 'up' || verb === 'down') await moveModule(moduleId, verb as Direction);

  revalidatePath(`/admin/courses/${courseId}`);
}

function lessonFrom(formData: FormData): LessonInput {
  const duration = text(formData.get('durationSeconds'));
  return {
    title: text(formData.get('title')),
    type: (text(formData.get('type')) || 'text') as LessonType,
    assetKey: text(formData.get('assetKey')) || null,
    durationSeconds: duration === '' ? null : int(duration),
    body: text(formData.get('body')) || null,
    resourceUrl: text(formData.get('resourceUrl')) || null,
  };
}

export async function upsertLesson(
  _prev: BuilderState,
  formData: FormData
): Promise<BuilderState> {
  await requireOwner();

  const courseId = text(formData.get('courseId'));
  const lessonId = text(formData.get('lessonId'));
  const moduleId = text(formData.get('moduleId'));
  const input = lessonFrom(formData);

  const result = lessonId
    ? await saveLesson(lessonId, input)
    : await addLesson(moduleId, input);

  revalidatePath(`/admin/courses/${courseId}`);
  return result.ok
    ? { error: null, note: lessonId ? 'Lesson saved.' : 'Lesson added.' }
    : { error: result.reason, note: null };
}

export async function lessonAction(formData: FormData): Promise<void> {
  await requireOwner();

  const courseId = text(formData.get('courseId'));
  const lessonId = text(formData.get('lessonId'));
  const verb = text(formData.get('verb'));
  if (!lessonId) return;

  if (verb === 'delete') await deleteLesson(lessonId);
  else if (verb === 'up' || verb === 'down') await moveLesson(lessonId, verb as Direction);

  revalidatePath(`/admin/courses/${courseId}`);
}
