import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import emailRouter from './routes/email.js';
import transcriptRouter from './routes/transcript.js';
import healthRouter from './routes/health.js';
import lookupRouter from './routes/lookup.js';
import uiRouter from './routes/ui.js';
import feedbackAdminUiRouter from './routes/feedback-admin-ui.js';
import { createFeedbackAdminRouter } from './routes/feedback-admin.js';
import { createFeedbackRouter } from './routes/feedback.js';
import { FeedbackKeyStore } from './services/feedback-keys.js';
import { AworkClient } from './services/awork.js';
import { join } from 'path';
import { MicrosoftGraphClient } from './services/microsoft-graph.js';
import { EmailPoller, setPollerInstance, getPollerInstance } from './services/email-poller.js';
import { createApiAuth } from './services/auth.js';
import { openDb } from './core/db.js';
import { UserStore } from './core/users.js';
import { SessionStore } from './core/sessions.js';
import { Scheduler } from './core/scheduler.js';
import { createAuthRouter } from './routes/auth.js';
import { createUsersAdminRouter } from './routes/users-admin.js';
import { createAutomationsRouter } from './routes/automations.js';

// ─── Konfiguration prüfen ────────────────────────────────────────

const requiredEnvVars = ['AWORK_API_TOKEN', 'ANTHROPIC_API_KEY', 'API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Umgebungsvariable ${envVar} fehlt!`);
    process.exit(1);
  }
}

if (!process.env.AWORK_WORKSPACE_URL) {
  console.warn('⚠️  AWORK_WORKSPACE_URL nicht gesetzt – Ticket-Antworten enthalten keinen Task-Link');
}

// ─── Datenbank, Nutzer, Scheduler ────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || process.env.FEEDBACK_DATA_DIR || './data';
const db = openDb(join(DATA_DIR, 'middleware.db'));
const users = new UserStore(db);
const sessions = new SessionStore(db, users);
const scheduler = new Scheduler(db);

// Erst-Admin anlegen, solange es noch keine Nutzer gibt
if (users.count() === 0) {
  const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_INITIAL_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_INITIAL_PASSWORD) {
    users.create({
      email: ADMIN_EMAIL,
      name: ADMIN_NAME || ADMIN_EMAIL.split('@')[0],
      role: 'admin',
      password: ADMIN_INITIAL_PASSWORD,
    });
    console.log(`👤 Erst-Admin angelegt: ${ADMIN_EMAIL} (Passwort nach dem ersten Login ändern!)`);
  } else {
    console.warn('⚠️  Keine Nutzer vorhanden und ADMIN_EMAIL/ADMIN_INITIAL_PASSWORD nicht gesetzt – Session-Login bleibt inaktiv, X-API-Key funktioniert weiter');
  }
}

// Housekeeping: abgelaufene Sessions täglich aufräumen
scheduler.register({
  id: 'session-cleanup',
  name: 'Session-Aufräumen',
  description: 'Löscht abgelaufene Login-Sessions aus der Datenbank',
  defaultCron: '0 4 * * *',
  enabledByDefault: true,
  async run(ctx) {
    sessions.purgeExpired();
    ctx.log('Abgelaufene Sessions entfernt');
    return 'Abgelaufene Sessions entfernt';
  },
});

// ─── Feedback-Infrastruktur ──────────────────────────────────────

const feedbackKeyStore = new FeedbackKeyStore(join(DATA_DIR, 'feedback-keys.json'));
const aworkClient = new AworkClient(process.env.AWORK_API_TOKEN!);

// ─── Express App ─────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || '3500', 10);

// Hinter dem Mittwald-Proxy: req.ip soll die echte Client-IP sein (Rate-Limits).
app.set('trust proxy', 1);

// Security-Header. Inline-Scripts/-Styles der bestehenden Seiten erlauben –
// nach der Migration auf das Hub-Frontend auf 'self' verschärfen.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// ─── Feedback-Routen (Extension) ─────────────────────────────────
// VOR den globalen Body-Parsern: /feedback hat ein eigenes 20-MB-Limit.
// Auth läuft über projektspezifische X-Feedback-Keys, nicht den Master-Key.
app.use('/feedback', createFeedbackRouter({
  store: feedbackKeyStore,
  awork: aworkClient,
  workspaceUrl: process.env.AWORK_WORKSPACE_URL || '',
}));

// JSON + URL-encoded Body Parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ─── Session-Login (Hub) ─────────────────────────────────────────

app.use(createAuthRouter({ users, sessions }));

// ─── Auth Middleware ─────────────────────────────────────────────
// Alle /api/* Endpoints akzeptieren Session-Cookie ODER X-API-Key
// (timing-sicher, mit Brute-Force-Bremse pro IP). Health ist öffentlich.

app.use('/api', createApiAuth(process.env.API_KEY!, sessions));

// ─── Request Logging ─────────────────────────────────────────────

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─── Routes ──────────────────────────────────────────────────────

app.use(uiRouter);          // GET / (Web-Formular, öffentlich)
app.use(feedbackAdminUiRouter); // GET /feedback-admin (Verbindungen verwalten, öffentlich)
app.use(healthRouter);      // GET /health (öffentlich)
app.use(lookupRouter);      // GET /api/customers, /api/projects (auth)
app.use(emailRouter);       // POST /api/email (auth)
app.use(transcriptRouter);  // POST /api/transcript (auth)
app.use(createFeedbackAdminRouter({ store: feedbackKeyStore, awork: aworkClient })); // /api/feedback-keys (auth)
app.use(createUsersAdminRouter({ users, sessions }));  // /api/users (nur Admins)
app.use(createAutomationsRouter({ scheduler }));       // /api/automations (auth, steuern nur Admins)

// ─── 404 Handler ─────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    error: 'Endpoint nicht gefunden',
    availableEndpoints: {
      'GET /health': 'Health-Check',
      'POST /api/email': 'E-Mail verarbeiten → awork',
      'POST /api/transcript': 'Transkript verarbeiten → awork',
      'POST /api/feedback-keys': 'Feedback-Key anlegen',
      'GET /api/feedback-keys': 'Feedback-Keys auflisten',
      'GET /feedback-admin': 'Verbindungen verwalten',
      'POST /auth/login': 'Anmelden (Session)',
      'GET /api/automations': 'Automationen und Status',
      'GET /api/users': 'Nutzerverwaltung (Admin)',
    },
  });
});

// ─── Start ───────────────────────────────────────────────────────

// ─── Email Poller ───────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     straightup Wissenssystem – Middleware         ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║  🌐 Server läuft auf Port ${PORT}                   ║`);
  console.log('║                                                   ║');
  console.log('║  Endpoints:                                       ║');
  console.log('║    GET  /health          → Health-Check            ║');
  console.log('║    POST /api/email       → E-Mail verarbeiten      ║');
  console.log('║    POST /api/transcript  → Transkript verarbeiten  ║');
  console.log('║    POST /feedback/tickets → Extension-Feedback     ║');
  console.log('║    /api/feedback-keys     → Key-Verwaltung          ║');
  console.log('║    GET  /feedback-admin  → Verbindungen verwalten  ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  // Automationen planen (Cron, Europe/Berlin)
  scheduler.start();

  // E-Mail-Polling starten (nur wenn MS_* Variablen gesetzt sind)
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_USER_EMAIL } = process.env;
  if (MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MS_USER_EMAIL) {
    const graphClient = new MicrosoftGraphClient(MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_USER_EMAIL);
    const poller = new EmailPoller(graphClient, {
      pollInterval: parseInt(process.env.MS_POLL_INTERVAL || '180000', 10),
      triggerCategory: process.env.MS_TRIGGER_CATEGORY || '→ awork',
      processedCategory: '✅ verarbeitet',
    });
    setPollerInstance(poller);
    poller.start();
  } else {
    console.log('📭 E-Mail-Polling deaktiviert (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET oder MS_USER_EMAIL nicht gesetzt)');
  }
});

// ─── Graceful Shutdown ──────────────────────────────────────────

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} empfangen, fahre herunter...`);
    const poller = getPollerInstance();
    if (poller) poller.stop();
    scheduler.stop();
    db.close();
    process.exit(0);
  });
}
