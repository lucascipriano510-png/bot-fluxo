import 'dotenv/config';
import express from 'express';
import { processMessage } from './bot/engine';
import { getOrCreateSession } from './services/sessionService';
import { parseWebhookPayload, sendMessage } from './providers/messaging';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ ok: true, bot: 'bot-fluxo', version: '1.0.0' });
});

// ── Webhook principal (recebe mensagens do provider WhatsApp) ─────────────────
app.post('/webhook', async (req, res) => {
  // Valida secret se configurado
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = parseWebhookPayload(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'Payload não reconhecido' });
  }

  try {
    const session = await getOrCreateSession(parsed.phone);
    const response = await processMessage(session, parsed.text);
    await sendMessage(parsed.phone, response.text);
    return res.json({ ok: true, nextNode: response.nextNode });
  } catch (err) {
    console.error('[webhook] erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Endpoint manual: envia mensagem avulsa para testar ────────────────────────
app.post('/send', async (req, res) => {
  const { phone, text } = req.body as { phone?: string; text?: string };
  if (!phone || !text) return res.status(400).json({ error: 'phone e text obrigatórios' });

  try {
    const session = await getOrCreateSession(phone);
    const response = await processMessage(session, text);
    return res.json({ ok: true, reply: response.text, nextNode: response.nextNode });
  } catch (err) {
    console.error('[send] erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 bot-fluxo rodando em http://localhost:${PORT}`);
  console.log(`   POST /webhook → recebe mensagens do provider`);
  console.log(`   POST /send    → teste manual\n`);
});
