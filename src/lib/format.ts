/** Shared formatting helpers. Prices are stored in cents everywhere. */

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

const dayMonth = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "SEP" / "09" for the date block on a class row. */
export function dateParts(d: Date): { month: string; day: string } {
  const [month, day] = dayMonth.format(d).replace(',', '').split(' ');
  return { month: month.toUpperCase(), day };
}

export function formatDate(d: Date): string {
  return longDate.format(d);
}

export function seatsLabel(total: number, booked: number): string {
  const left = Math.max(0, total - booked);
  if (left === 0) return 'Fully booked';
  return `${left} seat${left === 1 ? '' : 's'} left`;
}
