// ─── Werktagslogik (Mo–Fr, Feiertage Hamburg) ────────────────────
//
// Alle Funktionen arbeiten mit Datums-Strings "YYYY-MM-DD" in lokaler
// Betrachtung (Europe/Berlin) – Uhrzeiten spielen hier keine Rolle.

/** Ostersonntag nach Gauß/Anonymous-Gregorian-Algorithmus. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=März, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Gesetzliche Feiertage in Hamburg für ein Jahr, als "YYYY-MM-DD". */
export function hamburgHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`,              // Neujahr
    iso(addDays(easter, -2)),     // Karfreitag
    iso(addDays(easter, 1)),      // Ostermontag
    `${year}-05-01`,              // Tag der Arbeit
    iso(addDays(easter, 39)),     // Christi Himmelfahrt
    iso(addDays(easter, 50)),     // Pfingstmontag
    `${year}-10-03`,              // Tag der Deutschen Einheit
    `${year}-10-31`,              // Reformationstag (Hamburg seit 2018)
    `${year}-12-25`,              // 1. Weihnachtstag
    `${year}-12-26`,              // 2. Weihnachtstag
  ]);
}

/** Mo–Fr und kein Hamburger Feiertag. Erwartet "YYYY-MM-DD". */
export function isWorkday(dateStr: string): boolean {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const weekday = date.getUTCDay(); // 0=So, 6=Sa
  if (weekday === 0 || weekday === 6) return false;
  return !hamburgHolidays(date.getUTCFullYear()).has(dateStr);
}

/** Der letzte Werktag VOR dem angegebenen Datum (Montag → Freitag davor). */
export function previousWorkday(dateStr: string): string {
  let date = new Date(`${dateStr}T12:00:00Z`);
  do {
    date = addDays(date, -1);
  } while (!isWorkday(iso(date)));
  return iso(date);
}

/** Heutiges Datum in Europe/Berlin als "YYYY-MM-DD". */
export function todayInBerlin(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}
