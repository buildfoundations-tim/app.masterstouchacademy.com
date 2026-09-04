/**
 * Roll call, and the CE hours it awards.
 *
 * Attendance is not bookkeeping here — it is what turns a booked seat into
 * continuing-education credit. From the prototype, verbatim as the rule:
 * marking someone present awards the class CE hours; a late arrival gets the
 * class hours less two; a no-show earns none.
 *
 * Two decisions worth knowing:
 *
 *  1. **Hours are derived, never stored.** They are a function of the mark and
 *     the course's `ceHours`. Writing them onto the Attendance row would create
 *     a second copy that goes stale the moment a course's hours are corrected,
 *     and CE hours are the thing a member is audited on.
 *  2. **Only booked seats can be marked.** The roll is built from SeatBooking,
 *     so someone who never bought a seat cannot be given credit for the class
 *     by a mis-click.
 *
 * No `server-only`: the checks exercise these directly.
 */
import { db } from '@/lib/db';
import type { AttendanceStatus } from '@/generated/prisma/enums';

/** Hours docked from a late arrival. The prototype's rule, named. */
export const LATE_PENALTY_HOURS = 2;

/**
 * CE hours earned for one mark.
 *
 * Pure, and the single definition — the screen shows what this returns rather
 * than repeating the arithmetic, so the number a member sees and the number
 * their transcript would sum can never disagree.
 */
export function hoursEarned(status: AttendanceStatus | null, courseCeHours: number): number {
  if (status === 'present') return courseCeHours;
  // Never negative: a two-hour class does not owe hours back.
  if (status === 'late') return Math.max(0, courseCeHours - LATE_PENALTY_HOURS);
  return 0;
}

export type RollCallRow = {
  userId: string;
  name: string;
  email: string;
  company: string | null;
  mode: 'inperson' | 'virtual';
  formatLabel: string;
  status: AttendanceStatus | null;
  hours: number;
};

export type RollCall = {
  classId: string;
  title: string;
  dateLabel: string;
  location: string;
  startDate: Date;
  courseCode: string;
  ceHours: number;
  rows: RollCallRow[];
  counts: { booked: number; present: number; late: number; absent: number; unmarked: number };
  /** Total CE hours this class has awarded so far. */
  hoursAwarded: number;
};

/**
 * Classes that can be taken a roll for, nearest first.
 *
 * Published only, and only those with at least one booked seat — an empty class
 * is not a roll call, and listing it just makes the picker longer.
 */
export async function classesForRollCall() {
  const rows = await db.scheduledClass.findMany({
    where: { published: true, bookings: { some: {} } },
    orderBy: { startDate: 'desc' },
    select: {
      id: true, title: true, dateLabel: true, startDate: true, location: true,
      course: { select: { code: true, ceHours: true } },
      _count: { select: { bookings: true, attendance: true } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    dateLabel: c.dateLabel,
    startDate: c.startDate,
    location: c.location,
    courseCode: c.course.code,
    booked: c._count.bookings,
    marked: c._count.attendance,
    /** True once every booked seat has a mark. */
    complete: c._count.bookings > 0 && c._count.attendance >= c._count.bookings,
  }));
}

/** The roll for one class: who booked, how they are attending, what they earned. */
export async function rollCall(classId: string): Promise<RollCall | null> {
  const klass = await db.scheduledClass.findUnique({
    where: { id: classId },
    select: {
      id: true, title: true, dateLabel: true, startDate: true, location: true,
      course: { select: { code: true, ceHours: true } },
      bookings: {
        orderBy: { user: { lastName: 'asc' } },
        select: {
          mode: true,
          user: {
            select: { id: true, firstName: true, lastName: true, displayName: true, email: true, company: true },
          },
        },
      },
      attendance: { select: { userId: true, status: true } },
    },
  });

  if (!klass) return null;

  const marks = new Map(klass.attendance.map((a) => [a.userId, a.status]));
  const ceHours = klass.course.ceHours;

  const rows: RollCallRow[] = klass.bookings.map((b) => {
    const status = marks.get(b.user.id) ?? null;
    return {
      userId: b.user.id,
      name: b.user.displayName || `${b.user.firstName} ${b.user.lastName}`.trim(),
      email: b.user.email,
      company: b.user.company,
      mode: b.mode,
      formatLabel: b.mode === 'virtual' ? 'Live stream' : 'In the classroom',
      status,
      hours: hoursEarned(status, ceHours),
    };
  });

  const counts = {
    booked: rows.length,
    present: rows.filter((r) => r.status === 'present').length,
    late: rows.filter((r) => r.status === 'late').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    unmarked: rows.filter((r) => r.status === null).length,
  };

  return {
    classId: klass.id,
    title: klass.title,
    dateLabel: klass.dateLabel,
    location: klass.location,
    startDate: klass.startDate,
    courseCode: klass.course.code,
    ceHours,
    rows,
    counts,
    hoursAwarded: rows.reduce((a, r) => a + r.hours, 0),
  };
}

export type MarkResult = { ok: true; status: AttendanceStatus } | { ok: false; reason: string };

/**
 * Mark one student.
 *
 * Refuses anyone without a seat on this class. Attendance is what awards CE
 * hours, so the guard is not politeness — it is the difference between a
 * transcript that survives an audit and one that does not.
 */
export async function markAttendance(input: {
  classId: string;
  userId: string;
  status: AttendanceStatus;
}): Promise<MarkResult> {
  const booking = await db.seatBooking.findFirst({
    where: { classId: input.classId, userId: input.userId },
    select: { id: true },
  });
  if (!booking) return { ok: false, reason: 'That person does not hold a seat on this class.' };

  await db.attendance.upsert({
    where: { classId_userId: { classId: input.classId, userId: input.userId } },
    create: { classId: input.classId, userId: input.userId, status: input.status },
    update: { status: input.status, markedAt: new Date() },
  });

  return { ok: true, status: input.status };
}

/** Remove a mark, putting someone back to unmarked. Correcting a mis-click. */
export async function clearAttendance(input: { classId: string; userId: string }): Promise<void> {
  await db.attendance.deleteMany({ where: { classId: input.classId, userId: input.userId } });
}

/**
 * Mark every unmarked seat present.
 *
 * Deliberately does **not** overwrite existing marks: the button is for the
 * common case of a full room, and an instructor who has already flagged two
 * late arrivals should not lose that by pressing it.
 */
export async function markAllPresent(classId: string): Promise<{ marked: number }> {
  const [bookings, existing] = await Promise.all([
    db.seatBooking.findMany({ where: { classId }, select: { userId: true } }),
    db.attendance.findMany({ where: { classId }, select: { userId: true } }),
  ]);

  const already = new Set(existing.map((a) => a.userId));
  const todo = bookings.filter((b) => !already.has(b.userId));
  if (todo.length === 0) return { marked: 0 };

  await db.attendance.createMany({
    data: todo.map((b) => ({ classId, userId: b.userId, status: 'present' as const })),
  });

  return { marked: todo.length };
}
