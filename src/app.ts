import 'dotenv/config';
import path from 'path';
import express from 'express';
import { processMessage } from './bot/engine';
import { getOrCreateSession, resetSession } from './services/sessionService';
import { parseWebhookPayload, sendMessage } from './providers/messaging';
import { FLOW_MAP } from './bot/flowMap';
import { saveMensagem } from './services/mensagemService';
import { checkRateLimit } from './utils/rateLimiter';
import { getStoreContext } from './services/storeService';
import apiRouter from './routes/api';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const TYPING_DELAY_MS = Number(process.env.TYPING_DELAY_MS ?? 800);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const app = express();
app.use(express.json());

// ── Painel visual (local dev) ─────────────────────────────────────────────────
// Na Vercel, public/ é servido pelo CDN antes de chegar no Lambda.
// Localmente, o Express precisa servir os arquivos estáticos.
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, '..', 'public')));
}

// ── API routes (dados para o painel) ─────────────────────────────────────────
app.use('/api', apiRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  res.json({ ok: true, bot: 'bot-fluxo', version: '1.0.0' });
});

// ── Webhook: recebe mensagens do provider WhatsApp ────────────────────────────
app.post('/webhook', async (req, res) => {
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const parsed = parseWebhookPayload(req.body);
  if (!parsed) return res.status(400).json({ error: 'Payload não reconhecido' });

  if (!checkRateLimit(parsed.phone)) {
    console.warn(`[webhook] rate limit atingido para ${parsed.phone}`);
    return res.json({ ok: true, ratelimited: true });
  }

  try {
    const storeCtx = await getStoreContext();
    const session  = await getOrCreateSession(storeCtx.storeId, parsed.phone);
    const response = await processMessage(session, parsed.text);
    if (TYPING_DELAY_MS > 0) await sleep(TYPING_DELAY_MS + Math.random() * 400);
    await sendMessage(parsed.phone, response.text);
    return res.json({ ok: true, nextNode: response.nextNode });
  } catch (err) {
    console.error('[webhook]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Envio manual / simulador do painel ───────────────────────────────────────
app.post('/send', async (req, res) => {
  const { phone, text } = req.body as { phone?: string; text?: string };
  if (!phone || !text) return res.status(400).json({ error: 'phone e text obrigatórios' });

  if (!checkRateLimit(phone)) {
    return res.status(429).json({ ok: false, error: 'Muitas mensagens. Aguarde um momento.' });
  }

  try {
    const storeCtx = await getStoreContext();
    const session  = await getOrCreateSession(storeCtx.storeId, phone);
    const response = await processMessage(session, text);
    return res.json({ ok: true, reply: response.text, nextNode: response.nextNode });
  } catch (err) {
    console.error('[send]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Iniciar chat (simulador visual) ──────────────────────────────────────────
app.post('/start', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });

  try {
    const storeCtx = await getStoreContext();
    await resetSession(storeCtx.storeId, phone);
    const node = FLOW_MAP['INICIO'];
    const text = typeof node.message === 'function'
      ? node.message({ _storeName: storeCtx.name })
      : node.message;
    await saveMensagem({ store_id: storeCtx.storeId, phone, direcao: 'saida', conteudo: text, node: 'INICIO' });
    return res.json({ ok: true, text, nextNode: 'INICIO' });
  } catch (err) {
    console.error('[start]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Reset de sessão (painel) ──────────────────────────────────────────────────
app.post('/reset', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });

  try {
    const { storeId } = await getStoreContext();
    await resetSession(storeId, phone);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[reset]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

export default app;
