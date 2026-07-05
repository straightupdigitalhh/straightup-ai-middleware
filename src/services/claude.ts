import Anthropic from '@anthropic-ai/sdk';

// ─── Modelle ─────────────────────────────────────────────────────
// Per Env übersteuerbar, damit ein Modell-Generationswechsel (Retirement)
// keine Code-Änderung braucht – nur die Variable in Mittwald anpassen.

const ANALYSIS_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const FAST_MODEL = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5';

/** Ersten Text-Block extrahieren (Antworten können auch Thinking-Blöcke enthalten). */
function textFrom(response: Anthropic.Message): string {
  const block = response.content.find(b => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

// ─── Types ───────────────────────────────────────────────────────

export type ContentType = 'email' | 'transcript' | 'briefing' | 'general';
export type EmailCategory = 'decision' | 'requirement' | 'feedback' | 'open_item';

export interface RoutingResult {
  type: ContentType;
  title: string;
  summary: string;
  customerName: string;
  projectName?: string;
  decisions?: { decision: string; context: string; date: string }[];
  actionItems?: { task: string; assignee: string; dueDate?: string }[];
  newContacts?: { name: string; role: string; email?: string; phone?: string }[];
  emailCategory?: EmailCategory;
  participants?: string;
}

// ─── Service ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist das Wissensmanagement-System der Agentur straightup digital.
Deine Aufgabe: Eingehende Inhalte analysieren, strukturieren und für die Ablage in awork vorbereiten.

ROUTING-REGELN:

1. MEETING-TRANSKRIPT (type: "transcript")
   → Erstelle eine strukturierte Zusammenfassung mit:
   - participants: Wer war dabei (als Fließtext)
   - title: Kurzer, prägnanter Titel des Meetings
   - summary: Zusammenfassung der Kernthemen (2-4 Sätze)
   - decisions: Getroffene Entscheidungen (jeweils mit decision + context + date)
   - actionItems: Aufgaben mit task + assignee + dueDate (YYYY-MM-DD oder null)
   - newContacts: Neue Kontaktpersonen falls erwähnt

2. E-MAIL (type: "email")
   → Kategorisiere als emailCategory:
   - "decision": Eine Entscheidung wurde getroffen oder bestätigt
   - "requirement": Eine neue Anforderung oder Änderungswunsch
   - "feedback": Rückmeldung zu Arbeitsergebnissen
   - "open_item": Offene Frage oder ungeklärter Punkt
   → Extrahiere:
   - title: Kurze Beschreibung des E-Mail-Inhalts
   - summary: Kernaussage (1-2 Sätze)
   - decisions: Falls emailCategory = "decision"
   - actionItems: Falls sich daraus Aufgaben ergeben

3. ANGEBOT/BRIEFING (type: "briefing")
   → Erstelle eine kompakte Zusammenfassung:
   - title: Titel des Angebots/Briefings
   - summary: Projektumfang, Budget (falls genannt), Zeitrahmen, besondere Anforderungen
   - actionItems: Falls sich daraus nächste Schritte ergeben

4. ALLGEMEINE INFO (type: "general")
   → Strukturiere nach Relevanz:
   - title: Kurze Beschreibung
   - summary: Aufbereitete Information

WICHTIG:
- Antworte AUSSCHLIESSLICH als valides JSON (kein Markdown, kein Text drumherum)
- Verwende das RoutingResult-Format
- Alle Datumsangaben als "YYYY-MM-DD"
- Wenn kein Projekt erkennbar ist, setze projectName auf null
- Bei Deadlines im Text relative Angaben (z.B. "nächste Woche") in absolute Daten umrechnen basierend auf dem heutigen Datum`;

// ─── Customer Auto-Detection ────────────────────────────────────

export interface CustomerDetection {
  customerName: string;
  projectName?: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function detectCustomer(
  emailContent: string,
  fromAddress: string,
  subject: string,
  knownCustomers: string[]
): Promise<CustomerDetection> {
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 256,
    system: `Du ordnest E-Mails einem bekannten Kunden zu. Antworte AUSSCHLIESSLICH als JSON.`,
    messages: [{
      role: 'user',
      content: `Bekannte Kunden: ${knownCustomers.join(', ')}

E-Mail:
  Von: ${fromAddress}
  Betreff: ${subject}
  Inhalt (Auszug): ${emailContent.substring(0, 500)}

Welchem Kunden gehört diese E-Mail? Antworte als JSON:
{"customerName": "...", "projectName": "..." oder null, "confidence": "high"|"medium"|"low"}

Regeln:
- Wenn der Absender-Domain oder Name klar zu einem Kunden passt → "high"
- Wenn der Inhalt auf einen Kunden hindeutet → "medium"
- Wenn unklar → customerName: "Unbekannt", confidence: "low"`
    }],
  });

  const text = textFrom(response) || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  try {
    return JSON.parse(jsonMatch ? jsonMatch[0] : text) as CustomerDetection;
  } catch {
    return { customerName: 'Unbekannt', confidence: 'low' };
  }
}

// ─── Content Routing ────────────────────────────────────────────

export async function routeContent(
  content: string,
  contentType: ContentType,
  customerName: string,
  projectName?: string,
  additionalContext?: string
): Promise<RoutingResult> {
  const anthropic = new Anthropic();

  const today = new Date().toISOString().split('T')[0];

  const userMessage = `Heutiges Datum: ${today}
Inhaltstyp: ${contentType}
Kunde: ${customerName}
${projectName ? `Projekt: ${projectName}` : 'Kein spezifisches Projekt angegeben'}
${additionalContext ? `Zusatzkontext: ${additionalContext}` : ''}

--- INHALT ---
${content}
--- ENDE ---

Analysiere und strukturiere diesen Inhalt gemäß den Routing-Regeln. Antworte als JSON.`;

  const response = await anthropic.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 4096,
    // Reine JSON-Extraktion: Thinking aus, damit die 4096 Tokens der
    // Antwort gehören (Sonnet 5 denkt sonst standardmäßig mit).
    thinking: { type: 'disabled' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = textFrom(response);

  // JSON aus der Antwort extrahieren (falls in Codeblock)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

  try {
    return JSON.parse(jsonStr) as RoutingResult;
  } catch (e) {
    throw new Error(`Claude-Antwort ist kein valides JSON:\n${text}`);
  }
}
