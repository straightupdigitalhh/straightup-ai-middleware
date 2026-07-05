import { AworkClient, AworkTimeEntry, AworkUser, aworkUserEmail } from './awork.js';
import { AutomationDefinition, RunContext } from '../core/scheduler.js';
import { isWorkday, previousWorkday, todayInBerlin } from './workdays.js';

// ─── Zeiterfassungs-Automationen ─────────────────────────────────
//
// 1. timetracking-personal: jede/r Mitarbeiter/in bekommt die eigenen
//    Zeiten des vorherigen Werktags – auch (gerade!) bei 0 Stunden.
// 2. timetracking-digest: alle Zeiten, gruppiert nach Mitarbeiter →
//    Projekt, an die konfigurierten Empfänger (Jan + Gabi).
//
// Settings (per PATCH auf automation_config.settings bzw. übers Hub):
// {
//   "digestRecipients": ["jan@…", "gabi@…"],   // Pflicht für den Digest
//   "userEmails": { "<awork-user-id>": "…" },  // Overrides, falls awork keine E-Mail kennt
//   "excludeUserIds": ["<awork-user-id>"],     // z. B. Freelancer, API-User
//   "targetHoursPerDay": 8,                    // Soll für den Lücken-Hinweis
//   "dryRun": true                              // nur ins Run-Log schreiben, nichts senden
// }

export interface Mailer {
  sendMail(to: string[], subject: string, htmlBody: string): Promise<void>;
}

interface Deps {
  awork: Pick<AworkClient, 'getUsers' | 'getTimeEntriesForDay'>;
  mailer: Mailer | null;
  /** "Heute" als YYYY-MM-DD – injizierbar für deterministische Tests. */
  today?: () => string;
}

// ─── Aggregation ─────────────────────────────────────────────────

export interface UserDaySummary {
  totalSeconds: number;
  byProject: { project: string; seconds: number }[];
}

export function summarizeByUser(entries: AworkTimeEntry[]): Map<string, UserDaySummary> {
  const byUser = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const project = entry.project?.name || 'Ohne Projekt';
    const projects = byUser.get(entry.userId) || new Map<string, number>();
    projects.set(project, (projects.get(project) || 0) + (entry.duration || 0));
    byUser.set(entry.userId, projects);
  }

  const result = new Map<string, UserDaySummary>();
  for (const [userId, projects] of byUser) {
    const byProject = [...projects.entries()]
      .map(([project, seconds]) => ({ project, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    result.set(userId, {
      totalSeconds: byProject.reduce((sum, p) => sum + p.seconds, 0),
      byProject,
    });
  }
  return result;
}

export function formatHours(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')} h`;
}

export function displayName(user: AworkUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unbenannt';
}

function formatDateDe(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('de-DE', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── E-Mail-Rendering ────────────────────────────────────────────

const TABLE_STYLE = 'border-collapse:collapse;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px';
const CELL_STYLE = 'padding:6px 12px;border-bottom:1px solid #eee;text-align:left';

export function renderPersonalEmail(
  firstName: string,
  day: string,
  summary: UserDaySummary | undefined,
  targetHours: number,
): { subject: string; html: string } {
  const dateLabel = formatDateDe(day);
  const total = summary?.totalSeconds || 0;
  const subject = `Deine awork-Zeiten vom ${dateLabel}`;

  let body: string;
  if (!summary || total === 0) {
    body = `<p>für <strong>${dateLabel}</strong> sind in awork <strong>keine Zeiten</strong> von dir erfasst.</p>
<p>Falls du gearbeitet hast: bitte kurz nachtragen – so bleiben Projekte und Abrechnung sauber. 🙏</p>`;
  } else {
    const rows = summary.byProject.map(p =>
      `<tr><td style="${CELL_STYLE}">${escapeHtml(p.project)}</td><td style="${CELL_STYLE};text-align:right">${formatHours(p.seconds)}</td></tr>`,
    ).join('\n');
    body = `<p>deine erfassten Zeiten für <strong>${dateLabel}</strong>:</p>
<table style="${TABLE_STYLE}">
<tr><th style="${CELL_STYLE}">Projekt</th><th style="${CELL_STYLE};text-align:right">Zeit</th></tr>
${rows}
<tr><td style="${CELL_STYLE}"><strong>Gesamt</strong></td><td style="${CELL_STYLE};text-align:right"><strong>${formatHours(total)}</strong></td></tr>
</table>`;
    if (targetHours > 0 && total < targetHours * 3600) {
      const gap = targetHours * 3600 - total;
      body += `\n<p>Das sind <strong>${formatHours(gap)}</strong> weniger als die üblichen ${targetHours} Stunden – falls noch etwas fehlt, bitte kurz nachtragen. 🙏</p>`;
    }
  }

  const html = `<p>Moin ${escapeHtml(firstName)},</p>\n${body}\n<p style="color:#888;font-size:12px">Automatische Erinnerung des straightup Hubs · Zeiten in awork pflegen</p>`;
  return { subject, html };
}

export function renderDigestEmail(
  day: string,
  users: AworkUser[],
  summaries: Map<string, UserDaySummary>,
): { subject: string; html: string } {
  const dateLabel = formatDateDe(day);
  const subject = `awork-Zeiten aller Mitarbeiter – ${dateLabel}`;

  // 0-Stunden-Tage zuerst (Auffälligkeiten), danach aufsteigend nach Gesamtzeit
  const sorted = [...users].sort((a, b) =>
    (summaries.get(a.id)?.totalSeconds || 0) - (summaries.get(b.id)?.totalSeconds || 0),
  );

  const blocks = sorted.map(user => {
    const summary = summaries.get(user.id);
    const name = escapeHtml(displayName(user));
    if (!summary || summary.totalSeconds === 0) {
      return `<tr><td style="${CELL_STYLE}"><strong>${name}</strong></td><td style="${CELL_STYLE}">–</td><td style="${CELL_STYLE};text-align:right;color:#c62828"><strong>0:00 h</strong></td></tr>`;
    }
    const projectRows = summary.byProject.map(p =>
      `<tr><td style="${CELL_STYLE}"></td><td style="${CELL_STYLE}">${escapeHtml(p.project)}</td><td style="${CELL_STYLE};text-align:right">${formatHours(p.seconds)}</td></tr>`,
    ).join('\n');
    return `<tr><td style="${CELL_STYLE}"><strong>${name}</strong></td><td style="${CELL_STYLE}"></td><td style="${CELL_STYLE};text-align:right"><strong>${formatHours(summary.totalSeconds)}</strong></td></tr>\n${projectRows}`;
  }).join('\n');

  const totalAll = [...summaries.values()].reduce((sum, s) => sum + s.totalSeconds, 0);
  const html = `<p>Erfasste awork-Zeiten für <strong>${dateLabel}</strong> (0-Stunden zuerst):</p>
<table style="${TABLE_STYLE}">
<tr><th style="${CELL_STYLE}">Mitarbeiter</th><th style="${CELL_STYLE}">Projekt</th><th style="${CELL_STYLE};text-align:right">Zeit</th></tr>
${blocks}
<tr><td style="${CELL_STYLE}"><strong>Gesamt (alle)</strong></td><td style="${CELL_STYLE}"></td><td style="${CELL_STYLE};text-align:right"><strong>${formatHours(totalAll)}</strong></td></tr>
</table>
<p style="color:#888;font-size:12px">Automatischer Digest des straightup Hubs</p>`;
  return { subject, html };
}

// ─── Gemeinsame Lauf-Vorbereitung ────────────────────────────────

interface Prepared {
  reportDate: string;
  users: AworkUser[];
  summaries: Map<string, UserDaySummary>;
}

async function prepare(deps: Deps, ctx: RunContext): Promise<Prepared | string> {
  const today = (deps.today || todayInBerlin)();
  if (!isWorkday(today)) {
    return `Heute (${today}) ist kein Werktag – keine Mails`;
  }
  const reportDate = previousWorkday(today);
  ctx.log(`Berichtstag: ${reportDate}`);

  const excludeUserIds = new Set((ctx.settings.excludeUserIds as string[]) || []);
  const allUsers = await deps.awork.getUsers();
  const users = allUsers.filter(u => !u.isDeactivated && !u.isArchived && !excludeUserIds.has(u.id));
  const entries = await deps.awork.getTimeEntriesForDay(reportDate);
  ctx.log(`${users.length} aktive Mitarbeiter, ${entries.length} Zeiteinträge`);

  return { reportDate, users, summaries: summarizeByUser(entries) };
}

async function send(deps: Deps, ctx: RunContext, to: string[], subject: string, html: string): Promise<void> {
  if (ctx.settings.dryRun === true) {
    ctx.log(`[DRY-RUN] an ${to.join(', ')}: "${subject}"`);
    return;
  }
  if (!deps.mailer) {
    throw new Error('Mail-Versand nicht konfiguriert (MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET/MS_USER_EMAIL setzen, Permission Mail.Send)');
  }
  await deps.mailer.sendMail(to, subject, html);
  ctx.log(`Mail an ${to.join(', ')}: "${subject}"`);
}

// ─── Automations-Definitionen ────────────────────────────────────

export function createTimetrackingAutomations(deps: Deps): AutomationDefinition[] {
  const personal: AutomationDefinition = {
    id: 'timetracking-personal',
    name: 'Zeiterfassung: persönliche Erinnerung',
    description: 'Mailt jedem Mitarbeiter die eigenen awork-Zeiten des vorherigen Werktags (08:55, Mo–Fr)',
    defaultCron: '55 8 * * 1-5',
    async run(ctx) {
      const prepared = await prepare(deps, ctx);
      if (typeof prepared === 'string') return prepared;
      const { reportDate, users, summaries } = prepared;

      const emailOverrides = (ctx.settings.userEmails as Record<string, string>) || {};
      const targetHours = typeof ctx.settings.targetHoursPerDay === 'number' ? ctx.settings.targetHoursPerDay : 8;

      let sent = 0;
      let skipped = 0;
      for (const user of users) {
        const email = emailOverrides[user.id] || aworkUserEmail(user);
        if (!email) {
          skipped++;
          ctx.log(`⚠ Keine E-Mail für ${displayName(user)} (${user.id}) – übersprungen (userEmails-Setting pflegen)`);
          continue;
        }
        const { subject, html } = renderPersonalEmail(
          user.firstName || displayName(user), reportDate, summaries.get(user.id), targetHours,
        );
        await send(deps, ctx, [email], subject, html);
        sent++;
      }
      return `${sent} Mail(s) für ${reportDate} verschickt${skipped ? `, ${skipped} ohne E-Mail übersprungen` : ''}`;
    },
  };

  const digest: AutomationDefinition = {
    id: 'timetracking-digest',
    name: 'Zeiterfassung: Management-Digest',
    description: 'Alle Zeiten des vorherigen Werktags, gruppiert nach Mitarbeiter und Projekt (08:55, Mo–Fr)',
    defaultCron: '55 8 * * 1-5',
    async run(ctx) {
      const recipients = (ctx.settings.digestRecipients as string[]) || [];
      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error('Settings unvollständig: digestRecipients (z. B. ["jan@…", "gabi@…"]) konfigurieren');
      }

      const prepared = await prepare(deps, ctx);
      if (typeof prepared === 'string') return prepared;
      const { reportDate, users, summaries } = prepared;

      const { subject, html } = renderDigestEmail(reportDate, users, summaries);
      await send(deps, ctx, recipients, subject, html);
      return `Digest für ${reportDate} an ${recipients.length} Empfänger verschickt`;
    },
  };

  return [personal, digest];
}
