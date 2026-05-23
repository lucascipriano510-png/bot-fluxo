import 'dotenv/config';
import path from 'path';
import express from 'express';
import { processMessage } from './bot/engine';
import { getOrCreateSession, resetSession } from './services/sessionService';
import { parseWebhookPayload, sendMessage } from './providers/messaging';
import apiRouter from './routes/api';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

app.use(express.json());

// ── Painel visual ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

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

  try {
    const session = await getOrCreateSession(parsed.phone);
    const response = await processMessage(session, parsed.text);
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

  try {
    const session = await getOrCreateSession(phone);
    const response = await processMessage(session, text);
    return res.json({ ok: true, reply: response.text, nextNode: response.nextNode });
  } catch (err) {
    console.error('[send]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Reset de sessão (painel) ──────────────────────────────────────────────────
app.post('/reset', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });

  try {
    await resetSession(phone);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[reset]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 bot-fluxo rodando em http://localhost:${PORT}`);
  console.log(`   Painel visual: http://localhost:${PORT}`);
  console.log(`   POST /webhook  → provider WhatsApp`);
  console.log(`   POST /send     → teste manual`);
  console.log(`   POST /reset    → resetar sessão\n`);
});
