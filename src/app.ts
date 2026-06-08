import 'dotenv/config';
import path from 'path';
import express from 'express';
import { processMessage } from './bot/engine';
import { getOrCreateSession } from './services/sessionService';
import { parseWebhookPayload, sendMessage } from './providers/messaging';
import { checkRateLimit } from './utils/rateLimiter';
import { getStoreContext, getStoreBySlug } from './services/storeService';
import { resolveStoreBySlug } from './middleware/auth';
import apiRouter from './routes/api';

const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || '';
const TYPING_DELAY_MS = Number(process.env.TYPING_DELAY_MS ?? 800);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const app = express();

// CORS — painel Vercel precisa bater no servidor Render
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const isAllowed =
    origin === 'https://bot.fluxooutlet.com.br' ||
    origin === 'http://localhost:3000' ||
    origin === 'http://localhost:5173' ||
    /^https:\/\/bot-fluxo.*\.vercel\.app$/.test(origin) ||
    /^https:\/\/.*\.fluxooutlet\.com\.br$/.test(origin);
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// ── Painel visual ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API routes ────────────────────────────────────────────────────────────────
// /api/config e /api/health são públicos (sem auth).
// O requireAuth é aplicado dentro do router para todas as outras rotas.
app.use('/api', apiRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  res.json({ ok: true, bot: 'bot-fluxo', version: '2.0.0' });
});

// ── Webhook multi-tenant: /webhook/:storeSlug ─────────────────────────────────
// Cada loja registra seu webhook com a URL: /webhook/<slug-da-loja>
// Ex: /webhook/fluxo-outlet  /webhook/lava-jato-x
app.post('/webhook/:storeSlug', resolveStoreBySlug, async (req, res) => {
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = parseWebhookPayload(req.body);
  if (!parsed) return res.status(400).json({ error: 'Payload não reconhecido' });

  if (!checkRateLimit(parsed.phone)) {
    return res.json({ ok: true, ratelimited: true });
  }

  try {
    const storeId = req.storeId!;
    const session = await getOrCreateSession(storeId, parsed.phone);
    const response = await processMessage(session, parsed.text);
    if (response.text) {
      if (TYPING_DELAY_MS > 0) await sleep(TYPING_DELAY_MS + Math.random() * 400);
      await sendMessage(parsed.phone, response.text, storeId);
    }
    return res.json({ ok: true, nextNode: response.nextNode });
  } catch (err) {
    console.error('[webhook/:storeSlug]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Webhook legado: /webhook (usa LOJA_WHATSAPP do env) ──────────────────────
app.post('/webhook', async (req, res) => {
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = parseWebhookPayload(req.body);
  if (!parsed) return res.status(400).json({ error: 'Payload não reconhecido' });

  if (!checkRateLimit(parsed.phone)) {
    return res.json({ ok: true, ratelimited: true });
  }

  try {
    const storeCtx = await getStoreContext();
    const session  = await getOrCreateSession(storeCtx.storeId, parsed.phone);
    const response = await processMessage(session, parsed.text);
    if (response.text) {
      if (TYPING_DELAY_MS > 0) await sleep(TYPING_DELAY_MS + Math.random() * 400);
      await sendMessage(parsed.phone, response.text, storeCtx.storeId);
    }
    return res.json({ ok: true, nextNode: response.nextNode });
  } catch (err) {
    console.error('[webhook]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

export default app;
