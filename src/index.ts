import 'dotenv/config';
import express from 'express';
import emailRouter from './routes/email.js';
import transcriptRouter from './routes/transcript.js';
import healthRouter from './routes/health.js';
import { MicrosoftGraphClient } from './services/microsoft-graph.js';
import { EmailPoller, setPollerInstance, getPollerInstance } from './services/email-poller.js';

// ─── Konfiguration prüfen ────────────────────────────────────────

const requiredEnvVars = ['AWORK_API_TOKEN', 'ANTHROPIC_API_KEY', 'API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Umgebungsvariable ${envVar} fehlt!`);
    process.exit(1);
  }
}

// ─── Express App ─────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || '3500', 10);

// JSON + URL-encoded Body Parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ─── Auth Middleware ─────────────────────────────────────────────
// Alle /api/* Endpoints werden mit X-API-Key geschützt.
// Der Health-Check ist öffentlich.

app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    console.warn(`🔒 Unautorisierter Zugriff von ${req.ip}: ${req.method} ${req.path}`);
    res.status(401).json({ error: 'Unauthorized – X-API-Key fehlt oder ungültig' });
    return;
  }

  next();
});

// ─── Request Logging ─────────────────────────────────────────────

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─── Routes ──────────────────────────────────────────────────────

app.use(healthRouter);      // GET /health (öffentlich)
app.use(emailRouter);       // POST /api/email (auth)
app.use(transcriptRouter);  // POST /api/transcript (auth)

// ─── 404 Handler ─────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    error: 'Endpoint nicht gefunden',
    availableEndpoints: {
      'GET /health': 'Health-Check',
      'POST /api/email': 'E-Mail verarbeiten → awork',
      'POST /api/transcript': 'Transkript verarbeiten → awork',
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
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

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
    process.exit(0);
  });
}
