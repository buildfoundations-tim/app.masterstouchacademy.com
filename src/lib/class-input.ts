/**
 * Validation for a scheduled class.
 *
 * Deliberately free of `server-only` and of any database import: the admin
 * action and the test suite both call parseClassInput, so the rules that ship
 * are the rules under test. Anything requiring the database (the owner check,
 * the write itself) stays in the action.
 */
import { z } from 'zod';

export type ClassMode = 'hybrid' | 'inperson' | 'virtual';

export type ParsedClass = {
  id?: string;
  courseId: string;
  title: string;
  mode: ClassMode;
  startDate: Date;
  endDate: Date;
  dateLabel: string;
  location: string;
  note: string | null;
  seatsTotal: number;
  published: boolean;
  inPersonPriceCents: number | null;
  virtualPriceCents: number | null;
};

export type ParseResult = { ok: true; value: ParsedClass } | { ok: false; error: string };

/** Accepts "$450", "450", "450.00", " 450 ". Empty means "format not offered". */
export function toCents(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const Shape = z.object({
  id: z.string().optional(),
  courseId: z.string().min(1, 'Pick a course.'),
  title: z.string().trim().min(3, 'Give the class a title.'),
  mode: z.enum(['hybrid', 'inperson', 'virtual']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date is required.'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date is required.'),
  dateLabel: z.string().trim().min(3, 'Add the date label shown on the site.'),
  location: z.string().trim().min(3, 'Add a location.'),
  note: z.string().trim().optional(),
  seatsTotal: z.coerce.number().int().min(0).max(500),
  published: z.boolean(),
});

export type ClassInputRaw = {
  id?: string;
  courseId: unknown;
  title: unknown;
  mode: unknown;
  startDate: unknown;
  endDate: unknown;
  dateLabel: unknown;
  location: unknown;
  note?: unknown;
  seatsTotal: unknown;
  published: boolean;
  inPersonPrice: unknown;
  virtualPrice: unknown;
};

export function parseClassInput(raw: ClassInputRaw): ParseResult {
  const parsed = Shape.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  if (parsed.data.endDate < parsed.data.startDate) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  const inPersonPriceCents = toCents(raw.inPersonPrice);
  const virtualPriceCents = toCents(raw.virtualPrice);

  if (inPersonPriceCents === null && virtualPriceCents === null) {
    return { ok: false, error: 'Set at least one price — classroom, live stream, or both.' };
  }
  if (parsed.data.mode === 'inperson' && inPersonPriceCents === null) {
    return { ok: false, error: 'An in-person class needs a classroom price.' };
  }
  if (parsed.data.mode === 'virtual' && virtualPriceCents === null) {
    return { ok: false, error: 'A live-stream class needs a live-stream price.' };
  }
  // A hybrid class is sold in both formats, so it needs both prices — otherwise
  // the schedule renders a format members cannot see a price for.
  if (parsed.data.mode === 'hybrid' && (inPersonPriceCents === null || virtualPriceCents === null)) {
    return { ok: false, error: 'A hybrid class needs both a classroom and a live-stream price.' };
  }

  return {
    ok: true,
    value: {
      id: parsed.data.id,
      courseId: parsed.data.courseId,
      title: parsed.data.title,
      mode: parsed.data.mode,
      startDate: new Date(`${parsed.data.startDate}T00:00:00Z`),
      endDate: new Date(`${parsed.data.endDate}T00:00:00Z`),
      dateLabel: parsed.data.dateLabel,
      location: parsed.data.location,
      note: parsed.data.note?.trim() || null,
      seatsTotal: parsed.data.seatsTotal,
      published: parsed.data.published,
      inPersonPriceCents,
      virtualPriceCents,
    },
  };
}
