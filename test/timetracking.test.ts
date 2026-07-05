import { describe, it, expect, vi } from 'vitest';
import { AworkTimeEntry, AworkUser, aworkUserEmail } from '../src/services/awork.js';
import {
  summarizeByUser, formatHours, renderPersonalEmail, renderDigestEmail,
  createTimetrackingAutomations, Mailer,
} from '../src/services/timetracking.js';
import { RunContext } from '../src/core/scheduler.js';

const USERS: AworkUser[] = [
  { id: 'u1', firstName: 'Anna', lastName: 'Muster', userContactInfos: [{ type: 'email', subType: 'work', value: 'anna@straightup-digital.de' }] },
  { id: 'u2', firstName: 'Ben', lastName: 'Ohne-Mail', userContactInfos: [] },
  { id: 'u3', firstName: 'Alt', lastName: 'Deaktiviert', isDeactivated: true },
];

const ENTRIES: AworkTimeEntry[] = [
  { id: 't1', userId: 'u1', duration: 3600, project: { id: 'p1', name: 'Dentaversum – Web' } },
  { id: 't2', userId: 'u1', duration: 1800, project: { id: 'p1', name: 'Dentaversum – Web' } },
  { id: 't3', userId: 'u1', duration: 5400, project: { id: 'p2', name: 'Intern' } },
  { id: 't4', userId: 'u2', duration: 900, project: null },
];

describe('aworkUserEmail', () => {
  it('bevorzugt work-E-Mail, fällt auf erste zurück, null ohne Infos', () => {
    expect(aworkUserEmail(USERS[0])).toBe('anna@straightup-digital.de');
    expect(aworkUserEmail(USERS[1])).toBeNull();
    expect(aworkUserEmail({ id: 'x', firstName: null, lastName: null, userContactInfos: [
      { type: 'email', subType: 'private', value: 'privat@x.de' },
      { type: 'email', subType: 'work', value: 'work@x.de' },
      { type: 'phone', value: '040-123' },
    ] })).toBe('work@x.de');
  });
});

describe('summarizeByUser + formatHours', () => {
  it('gruppiert nach Nutzer und Projekt, sortiert Projekte nach Zeit', () => {
    const summaries = summarizeByUser(ENTRIES);
    const anna = summaries.get('u1')!;
    expect(anna.totalSeconds).toBe(10800);
    expect(anna.byProject).toEqual([
      { project: 'Dentaversum – Web', seconds: 5400 },
      { project: 'Intern', seconds: 5400 },
    ].sort((a, b) => b.seconds - a.seconds));
    expect(summaries.get('u2')!.byProject[0].project).toBe('Ohne Projekt');
    expect(summaries.get('u3')).toBeUndefined();
  });

  it('formatHours rundet auf Minuten', () => {
    expect(formatHours(0)).toBe('0:00 h');
    expect(formatHours(3600)).toBe('1:00 h');
    expect(formatHours(27900)).toBe('7:45 h');
    expect(formatHours(29)).toBe('0:00 h');
    expect(formatHours(31)).toBe('0:01 h');
  });
});

describe('renderPersonalEmail', () => {
  const summary = summarizeByUser(ENTRIES).get('u1');

  it('mit Zeiten: Tabelle + Gesamtsumme + Lücken-Hinweis unter Soll', () => {
    const { subject, html } = renderPersonalEmail('Anna', '2026-07-03', summary, 8);
    expect(subject).toContain('03.07.2026');
    expect(html).toContain('Moin Anna');
    expect(html).toContain('Dentaversum – Web');
    expect(html).toContain('3:00 h');           // Gesamt
    expect(html).toContain('5:00 h');           // Lücke zu 8h
    expect(html).toContain('nachtragen');
  });

  it('ohne Lücken-Hinweis bei erreichtem Soll', () => {
    const { html } = renderPersonalEmail('Anna', '2026-07-03', summary, 3);
    expect(html).not.toContain('weniger als');
  });

  it('0 Stunden: klare Nachtrag-Bitte', () => {
    const { html } = renderPersonalEmail('Ben', '2026-07-03', undefined, 8);
    expect(html).toContain('keine Zeiten');
    expect(html).toContain('nachtragen');
  });

  it('escapet Projektnamen (XSS)', () => {
    const evil = summarizeByUser([{ id: 't', userId: 'u', duration: 60, project: { id: 'p', name: '<script>alert(1)</script>' } }]).get('u');
    const { html } = renderPersonalEmail('X', '2026-07-03', evil, 0);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderDigestEmail', () => {
  it('0-Stunden-Nutzer zuerst, Projekte je Nutzer, Gesamtsumme', () => {
    const active = USERS.filter(u => !u.isDeactivated);
    const summaries = summarizeByUser(ENTRIES.filter(e => e.userId !== 'u2')); // Ben hat 0h
    const { subject, html } = renderDigestEmail('2026-07-03', active, summaries);
    expect(subject).toContain('03.07.2026');
    // Ben (0h) kommt vor Anna
    expect(html.indexOf('Ben Ohne-Mail')).toBeLessThan(html.indexOf('Anna Muster'));
    expect(html).toContain('0:00 h');
    expect(html).toContain('Gesamt (alle)');
  });
});

// ─── Automation-Läufe (awork + Mailer gemockt) ───────────────────

function makeCtx(settings: Record<string, unknown> = {}): RunContext & { lines: string[] } {
  const lines: string[] = [];
  return { lines, settings, log: (m: string) => lines.push(m) };
}

// Deterministisch: "heute" ist Montag, 06.07.2026 → Berichtstag Freitag, 03.07.2026
const MONDAY = '2026-07-06';
const REPORT_DAY = '2026-07-03';

function makeDeps(mailer: Mailer | null, today = MONDAY) {
  return {
    awork: {
      getUsers: vi.fn().mockResolvedValue(USERS),
      getTimeEntriesForDay: vi.fn().mockResolvedValue(ENTRIES),
    },
    mailer,
    today: () => today,
  };
}

describe('timetracking-Automationen', () => {
  it('personal: mailt Nutzer mit E-Mail, überspringt ohne, ignoriert deaktivierte', async () => {
    const mailer: Mailer = { sendMail: vi.fn().mockResolvedValue(undefined) };
    const deps = makeDeps(mailer);
    const [personal] = createTimetrackingAutomations(deps);
    const ctx = makeCtx();

    const summary = await personal.run(ctx);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1); // nur Anna
    expect(mailer.sendMail).toHaveBeenCalledWith(
      ['anna@straightup-digital.de'], expect.stringContaining('Deine awork-Zeiten'), expect.any(String),
    );
    expect(summary).toContain('1 Mail');
    expect(summary).toContain('1 ohne E-Mail übersprungen');
    expect(deps.awork.getTimeEntriesForDay).toHaveBeenCalledWith(REPORT_DAY);
  });

  it('personal: userEmails-Override und excludeUserIds greifen', async () => {
    const mailer: Mailer = { sendMail: vi.fn().mockResolvedValue(undefined) };
    const [personal] = createTimetrackingAutomations(makeDeps(mailer));
    const ctx = makeCtx({ userEmails: { u2: 'ben@straightup-digital.de' }, excludeUserIds: ['u1'] });

    const summary = await personal.run(ctx);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1); // nur Ben (u1 excluded)
    expect(mailer.sendMail).toHaveBeenCalledWith(['ben@straightup-digital.de'], expect.any(String), expect.any(String));
    expect(summary).toContain('1 Mail');
  });

  it('personal: dryRun sendet nichts, loggt aber', async () => {
    const mailer: Mailer = { sendMail: vi.fn() };
    const [personal] = createTimetrackingAutomations(makeDeps(mailer));
    const ctx = makeCtx({ dryRun: true });
    await personal.run(ctx);
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(ctx.lines.some(l => l.includes('[DRY-RUN]'))).toBe(true);
  });

  it('personal: ohne Mailer und ohne dryRun → verständlicher Fehler', async () => {
    const [personal] = createTimetrackingAutomations(makeDeps(null));
    await expect(personal.run(makeCtx())).rejects.toThrow(/Mail-Versand nicht konfiguriert/);
  });

  it('personal: am Wochenende/Feiertag läuft nichts', async () => {
    const mailer: Mailer = { sendMail: vi.fn() };
    const [personal] = createTimetrackingAutomations(makeDeps(mailer, '2026-07-04')); // Samstag
    const summary = await personal.run(makeCtx());
    expect(summary).toContain('kein Werktag');
    expect(mailer.sendMail).not.toHaveBeenCalled();

    const [holidayRun] = createTimetrackingAutomations(makeDeps(mailer, '2026-05-01')); // 1. Mai
    expect(await holidayRun.run(makeCtx())).toContain('kein Werktag');
  });

  it('digest: verlangt digestRecipients, sendet eine Mail an alle Empfänger', async () => {
    const mailer: Mailer = { sendMail: vi.fn().mockResolvedValue(undefined) };
    const [, digest] = createTimetrackingAutomations(makeDeps(mailer));

    await expect(digest.run(makeCtx())).rejects.toThrow(/digestRecipients/);

    const ctx = makeCtx({ digestRecipients: ['jan@straightup-digital.de', 'gabi@straightup-digital.de'] });
    const summary = await digest.run(ctx);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).toHaveBeenCalledWith(
      ['jan@straightup-digital.de', 'gabi@straightup-digital.de'],
      expect.stringContaining('awork-Zeiten aller Mitarbeiter'),
      expect.stringContaining('Anna Muster'),
    );
    expect(summary).toContain('2 Empfänger');
  });
});
