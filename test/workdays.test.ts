import { describe, it, expect } from 'vitest';
import { easterSunday, hamburgHolidays, isWorkday, previousWorkday } from '../src/services/workdays.js';

describe('easterSunday', () => {
  it('bekannte Ostertermine', () => {
    expect(easterSunday(2024).toISOString().split('T')[0]).toBe('2024-03-31');
    expect(easterSunday(2025).toISOString().split('T')[0]).toBe('2025-04-20');
    expect(easterSunday(2026).toISOString().split('T')[0]).toBe('2026-04-05');
    expect(easterSunday(2027).toISOString().split('T')[0]).toBe('2027-03-28');
  });
});

describe('hamburgHolidays', () => {
  it('enthält feste und bewegliche Feiertage 2026', () => {
    const holidays = hamburgHolidays(2026);
    expect(holidays.has('2026-01-01')).toBe(true);  // Neujahr
    expect(holidays.has('2026-04-03')).toBe(true);  // Karfreitag
    expect(holidays.has('2026-04-06')).toBe(true);  // Ostermontag
    expect(holidays.has('2026-05-14')).toBe(true);  // Himmelfahrt
    expect(holidays.has('2026-05-25')).toBe(true);  // Pfingstmontag
    expect(holidays.has('2026-10-31')).toBe(true);  // Reformationstag (HH)
    expect(holidays.has('2026-12-24')).toBe(false); // Heiligabend ist KEIN Feiertag
    // Bayern-only Feiertage sind NICHT drin
    expect(holidays.has('2026-01-06')).toBe(false); // Heilige Drei Könige
    expect(holidays.has('2026-06-04')).toBe(false); // Fronleichnam
  });
});

describe('isWorkday', () => {
  it('Wochenende nein, normaler Wochentag ja', () => {
    expect(isWorkday('2026-07-03')).toBe(true);  // Freitag
    expect(isWorkday('2026-07-04')).toBe(false); // Samstag
    expect(isWorkday('2026-07-05')).toBe(false); // Sonntag
    expect(isWorkday('2026-07-06')).toBe(true);  // Montag
  });

  it('Feiertag nein', () => {
    expect(isWorkday('2026-05-01')).toBe(false); // 1. Mai (Freitag)
    expect(isWorkday('2026-04-06')).toBe(false); // Ostermontag
  });
});

describe('previousWorkday', () => {
  it('Montag → Freitag davor', () => {
    expect(previousWorkday('2026-07-06')).toBe('2026-07-03');
  });

  it('Dienstag → Montag', () => {
    expect(previousWorkday('2026-07-07')).toBe('2026-07-06');
  });

  it('überspringt Feiertage: Dienstag nach Ostermontag → Gründonnerstag', () => {
    // 2026: Karfreitag 03.04., Ostermontag 06.04. → Di 07.04. berichtet Do 02.04.
    expect(previousWorkday('2026-04-07')).toBe('2026-04-02');
  });

  it('nach dem 1. Mai (Freitag 2026): Montag 04.05. → Donnerstag 30.04.', () => {
    expect(previousWorkday('2026-05-04')).toBe('2026-04-30');
  });
});
