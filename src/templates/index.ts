import { RoutingResult } from '../services/claude.js';

// ─── Meeting-Doc ─────────────────────────────────────────────────

export function renderMeetingDoc(result: RoutingResult, date: string): string {
  const decisionsRows = (result.decisions || [])
    .map(d => `<tr><td>${d.decision}</td><td>${d.context}</td></tr>`)
    .join('\n    ');

  const actionRows = (result.actionItems || [])
    .map(a => `<tr><td>${a.task}</td><td>${a.assignee}</td><td>${a.dueDate || '–'}</td></tr>`)
    .join('\n    ');

  const contactRows = (result.newContacts || [])
    .map(c => `<li><strong>${c.name}</strong> (${c.role})${c.email ? ` – ${c.email}` : ''}${c.phone ? ` – ${c.phone}` : ''}</li>`)
    .join('\n    ');

  return `<h1>Meeting: ${date} – ${result.title}</h1>
<p><strong>Kunde:</strong> ${result.customerName}${result.projectName ? ` | <strong>Projekt:</strong> ${result.projectName}` : ''}</p>

<h2>Teilnehmer</h2>
<p>${result.participants || '<em>nicht angegeben</em>'}</p>

<h2>Zusammenfassung</h2>
<p>${result.summary}</p>

${result.decisions?.length ? `<h2>Entscheidungen</h2>
<table border="1" cellpadding="8" cellspacing="0">
  <tr><th>Entscheidung</th><th>Kontext</th></tr>
  ${decisionsRows}
</table>` : ''}

${result.actionItems?.length ? `<h2>Action Items</h2>
<table border="1" cellpadding="8" cellspacing="0">
  <tr><th>Aufgabe</th><th>Verantwortlich</th><th>Deadline</th></tr>
  ${actionRows}
</table>` : ''}

${result.newContacts?.length ? `<h2>Neue Kontakte</h2>
<ul>
  ${contactRows}
</ul>
<p><em>⚠️ Bitte Ansprechpartner-Dokument prüfen und ggf. aktualisieren.</em></p>` : ''}

<hr>
<p><em>Automatisch erstellt am ${new Date().toISOString().split('T')[0]} durch straightup Wissenssystem</em></p>`;
}

// ─── E-Mail-Log-Eintrag ──────────────────────────────────────────

export function renderEmailLogEntry(result: RoutingResult, from: string, date: string): string {
  const categoryLabels: Record<string, string> = {
    decision: '🟢 Entscheidung',
    requirement: '🔵 Anforderung',
    feedback: '🟡 Feedback',
    open_item: '🔴 Offener Punkt',
  };

  return `
<hr>
<h3>${date} – ${result.title}</h3>
<p><strong>Kategorie:</strong> ${categoryLabels[result.emailCategory || 'open_item'] || result.emailCategory}</p>
<p><strong>Von:</strong> ${from}</p>
<p><strong>Zusammenfassung:</strong> ${result.summary}</p>
${result.actionItems?.length ? `<p><strong>Action Items:</strong></p>
<ul>${result.actionItems.map(a => `<li>${a.task} → ${a.assignee}${a.dueDate ? ` (bis ${a.dueDate})` : ''}</li>`).join('\n')}</ul>` : ''}
<p><em>Verarbeitet am ${new Date().toISOString().split('T')[0]}</em></p>`;
}

// ─── Entscheidungslog-Eintrag ────────────────────────────────────

export function renderDecisionLogEntry(
  decision: { decision: string; context: string; date: string },
  source: string
): string {
  return `
<hr>
<h3>${decision.date} – ${decision.decision}</h3>
<p><strong>Quelle:</strong> ${source}</p>
<p><strong>Kontext:</strong> ${decision.context}</p>
<p><em>Hinzugefügt am ${new Date().toISOString().split('T')[0]}</em></p>`;
}

// ─── Briefing-Zusammenfassung ────────────────────────────────────

export function renderBriefingDoc(result: RoutingResult, date: string): string {
  const actionRows = (result.actionItems || [])
    .map(a => `<tr><td>${a.task}</td><td>${a.assignee}</td><td>${a.dueDate || '–'}</td></tr>`)
    .join('\n    ');

  return `<h1>Briefing: ${result.title}</h1>
<p><strong>Kunde:</strong> ${result.customerName}${result.projectName ? ` | <strong>Projekt:</strong> ${result.projectName}` : ''}</p>
<p><strong>Datum:</strong> ${date}</p>

<h2>Zusammenfassung</h2>
<p>${result.summary}</p>

${result.actionItems?.length ? `<h2>Nächste Schritte</h2>
<table border="1" cellpadding="8" cellspacing="0">
  <tr><th>Aufgabe</th><th>Verantwortlich</th><th>Deadline</th></tr>
  ${actionRows}
</table>` : ''}

<hr>
<p><em>Automatisch erstellt am ${new Date().toISOString().split('T')[0]} durch straightup Wissenssystem</em></p>`;
}

// ─── Meeting-Übersicht-Eintrag ───────────────────────────────────

export function renderMeetingIndexEntry(
  date: string,
  title: string,
  participants: string
): string {
  return `<tr><td>${date}</td><td>${title}</td><td>${participants}</td><td>✅ Verarbeitet</td></tr>`;
}
