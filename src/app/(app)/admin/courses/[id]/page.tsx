import Link from 'next/link';
import { notFound } from 'next/navigation';

import { courseOutline } from '@/lib/course-builder';
import { CourseMetaForm, AddModuleForm, LessonEditor, type CourseMetaValues } from './builder';
import { togglePublished, moduleAction, lessonAction } from '../actions';

export const metadata = { title: 'Admin · Course' };

const BLANK: CourseMetaValues = {
  id: null,
  slug: '',
  code: '',
  group: 'iicrc',
  title: '',
  blurb: '',
  description: '',
  priceCents: 0,
  priceLiveCents: null,
  hours: 0,
  days: '',
  level: '',
  tag: '',
  ceHours: 0,
  passingScore: 80,
  published: false,
  sortOrder: 0,
};

const TYPE_LABEL: Record<string, string> = {
  video: 'Video',
  text: 'Text',
  resource: 'Resource',
  quiz: 'Quiz',
};

/** A one-button form. Used for every reorder and delete in the outline. */
function Verb({
  action,
  fields,
  label,
  className = 'linkbtn',
  title,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  className?: string;
  title?: string;
}) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className={className} type="submit" title={title}>
        {label}
      </button>
    </form>
  );
}

export default async function AdminCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // /admin/courses/new is the create form rather than a separate route, so the
  // same component renders both and there is one place fields can drift.
  if (id === 'new') {
    return (
      <>
        <header className="topbar">
          <Link href="/admin/courses" className="faint" style={{ fontSize: 13 }}>
            ← Courses
          </Link>
          <h1 className="topbar__title">New course</h1>
        </header>
        <div className="page" style={{ maxWidth: 780 }}>
          <CourseMetaForm course={BLANK} />
        </div>
      </>
    );
  }

  const course = await courseOutline(id);
  if (!course) notFound();

  const lessonCount = course.modules.reduce((a, m) => a + m.lessons.length, 0);

  return (
    <>
      <header className="topbar">
        <Link href="/admin/courses" className="faint" style={{ fontSize: 13 }}>
          ← Courses
        </Link>
        <h1 className="topbar__title">
          {course.code} — {course.title}
        </h1>
      </header>

      <div className="page" style={{ maxWidth: 860 }}>
        <div className="card admin-panel">
          <div className="member-head">
            <div>
              <span className={`badge${course.published ? ' badge--done' : ' badge--locked'}`}>
                {course.published ? 'Live in the catalogue' : 'Draft'}
              </span>
              <p className="faint" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {lessonCount} lesson{lessonCount === 1 ? '' : 's'} · /{course.slug}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {course.published ? (
                <Link className="btn btn--outline btn--sm" href={`/classroom/${course.slug}`}>
                  View
                </Link>
              ) : null}
              <Verb
                action={togglePublished}
                fields={{ courseId: course.id, next: String(!course.published) }}
                label={course.published ? 'Unpublish' : 'Publish'}
                className={`btn btn--sm ${course.published ? 'btn--outline' : 'btn--dark'}`}
              />
            </div>
          </div>
          {lessonCount === 0 && !course.published ? (
            <p className="order-card__note">
              This course has no lessons yet, so it cannot be published — a buyer would get an empty
              page.
            </p>
          ) : null}
        </div>

        <h2 className="display" style={{ fontSize: 20, margin: '26px 0 12px' }}>
          Outline
        </h2>

        {course.modules.length === 0 ? (
          <div className="card" style={{ padding: 26, textAlign: 'center' }}>
            <p className="muted">No modules yet. Add the first one below.</p>
          </div>
        ) : (
          course.modules.map((m, mi) => (
            <div key={m.id} className="card admin-panel">
              <div className="outline__head">
                <form action={moduleAction} className="outline__rename">
                  <input type="hidden" name="courseId" value={course.id} />
                  <input type="hidden" name="moduleId" value={m.id} />
                  <input type="hidden" name="verb" value="rename" />
                  <span className="outline__num">{String(mi + 1).padStart(2, '0')}</span>
                  <input className="input outline__title" name="title" defaultValue={m.title} />
                  <button className="btn btn--outline btn--sm" type="submit">
                    Rename
                  </button>
                </form>
                <span className="outline__verbs">
                  <Verb
                    action={moduleAction}
                    fields={{ courseId: course.id, moduleId: m.id, verb: 'up' }}
                    label="↑"
                    className="mark"
                    title="Move up"
                  />
                  <Verb
                    action={moduleAction}
                    fields={{ courseId: course.id, moduleId: m.id, verb: 'down' }}
                    label="↓"
                    className="mark"
                    title="Move down"
                  />
                  <Verb
                    action={moduleAction}
                    fields={{ courseId: course.id, moduleId: m.id, verb: 'delete' }}
                    label="Delete"
                    className="linkbtn linkbtn--danger"
                    title="Deletes the module and its lessons"
                  />
                </span>
              </div>

              {m.lessons.length === 0 ? (
                <p className="faint" style={{ fontSize: 12.5, padding: '8px 0 12px' }}>
                  No lessons in this module yet.
                </p>
              ) : (
                <ul className="outline__lessons">
                  {m.lessons.map((l) => (
                    <li key={l.id}>
                      <span className="outline__lesson">
                        <span className="badge badge--locked">{TYPE_LABEL[l.type] ?? l.type}</span>
                        <span>{l.title}</span>
                        {l.type === 'video' && !l.assetKey ? (
                          <span className="faint" style={{ color: 'var(--danger)' }}>
                            no asset key
                          </span>
                        ) : null}
                      </span>
                      <span className="outline__verbs">
                        <LessonEditor
                          courseId={course.id}
                          moduleId={m.id}
                          lesson={{
                            id: l.id,
                            title: l.title,
                            type: l.type,
                            assetKey: l.assetKey,
                            durationSeconds: l.durationSeconds,
                            body: l.body,
                            resourceUrl: l.resourceUrl,
                          }}
                          label="edit"
                        />
                        <Verb
                          action={lessonAction}
                          fields={{ courseId: course.id, lessonId: l.id, verb: 'up' }}
                          label="↑"
                          className="mark"
                          title="Move up"
                        />
                        <Verb
                          action={lessonAction}
                          fields={{ courseId: course.id, lessonId: l.id, verb: 'down' }}
                          label="↓"
                          className="mark"
                          title="Move down"
                        />
                        <Verb
                          action={lessonAction}
                          fields={{ courseId: course.id, lessonId: l.id, verb: 'delete' }}
                          label="delete"
                          className="linkbtn linkbtn--danger"
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <LessonEditor
                courseId={course.id}
                moduleId={m.id}
                lesson={null}
                label="+ Add a lesson"
              />
            </div>
          ))
        )}

        <AddModuleForm courseId={course.id} />

        <CourseMetaForm
          course={{
            id: course.id,
            slug: course.slug,
            code: course.code,
            group: course.group,
            title: course.title,
            blurb: course.blurb,
            description: course.description,
            priceCents: course.priceCents,
            priceLiveCents: course.priceLiveCents,
            hours: course.hours,
            days: course.days,
            level: course.level,
            tag: course.tag,
            ceHours: course.ceHours,
            passingScore: course.passingScore,
            published: course.published,
            sortOrder: course.sortOrder,
          }}
        />
      </div>
    </>
  );
}
