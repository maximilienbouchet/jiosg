function toDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function getMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toDateStr(d);
}

export function getSunday(dateStr: string): string {
  return addDays(getMonday(dateStr), 6);
}

export function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d
    .toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

/**
 * Format a compact date range string.
 * Same month: "22 — 24 FEB"
 * Cross-month: "28 FEB — 3 MAR"
 * Returns null if no meaningful range (end is null, or same day as start).
 */
/**
 * Returns the Thu → Sun digest window for a given SGT date.
 * Used by production send, test script, and preview script.
 */
export function getDigestWindow(todaySgt: string): { start: string; end: string } {
  return { start: todaySgt, end: addDays(todaySgt, 3) };
}

export function formatDateRange(startStr: string, endStr: string | null): string | null {
  if (!endStr) return null;
  const startDate = startStr.split("T")[0];
  const endDate = endStr.split("T")[0];
  if (startDate === endDate) return null;

  const s = new Date(startDate + "T00:00:00");
  const e = new Date(endDate + "T00:00:00");
  const sMonth = s.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const eMonth = e.toLocaleDateString("en-US", { month: "short" }).toUpperCase();

  if (sMonth === eMonth) {
    return `${s.getDate()} \u2014 ${e.getDate()} ${sMonth}`;
  }
  return `${s.getDate()} ${sMonth} \u2014 ${e.getDate()} ${eMonth}`;
}
