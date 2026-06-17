import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase';
import { normalizePhone } from '../utils/phone';
import { fetchLeads } from '../services/leadService';
import { fetchHistorico } from '../services/mensagemService';
import { FLOW_MAP } from '../bot/flowMap';
import { loadFlowConfig, invalidateFlowCache } from '../services/flowConfigService';
import { getPreset, BusinessType } from '../bot/flowPresets';
import { getStoreContext, getStoreById } from '../services/storeService';
import { fetchProductsForPanel } from '../inventory/inventoryBridge';
import { loadSettings, saveSettings, getRuntimeSettings } from '../services/settingsService';
import { getOrCreateSession, resetSession } from '../services/sessionService';
import { processMessage } from '../bot/engine';
import { saveMensagem } from '../services/mensagemService';
import { checkRateLimit } from '../utils/rateLimiter';
import { requireAuth } from '../middleware/auth';
import { sendMessage, invalidateCredCache } from '../providers/messaging';
import { runStoreAnalysis } from '../services/analysisService';
import { recordConversion } from '../services/storeBrainService';
import { initBaileys, getWaState, sendWaMessage, disconnectBaileys } from '../whatsapp/baileys';
import { updateLeadScore, calculateLeadScore } from '../services/leadScoreService';
import { analyzeSingleLead, processAllLeads, processNewLeads } from '../services/leadIntelligence';
import { syncSitePurchases } from '../services/sitePurchaseService';
import { errMsg, cronAuthorized } from './_shared';

const router = Router();

router.get('/store', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, slug, name, status, plan, trial_ends_at')
      .eq('id', req.storeId!)
      .single();
    if (error || !data) {
      return res.status(404).json({ ok: false, error: 'Loja não encontrada' });
    }
    return res.json({ ok: true, data });
  } catch (err: unknown) {
    return res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Simulador (painel) — movido de app.ts para cair sob auth
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sim/reset', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  try {
    await resetSession(req.storeId!, phone);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[sim/reset]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/sim/start', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  try {
    const storeCtx = await getStoreById(req.storeId!);
    const settings = await getRuntimeSettings(req.storeId!);
    await resetSession(req.storeId!, phone);
    const node = FLOW_MAP['INICIO'];
    const ctx  = { _storeName: storeCtx.name, _saudacao: settings.saudacao };
    const text = typeof node.message === 'function' ? node.message(ctx) : node.message;
    await saveMensagem({ store_id: req.storeId!, phone, direcao: 'saida', conteudo: text, node: 'INICIO' });
    return res.json({ ok: true, text, nextNode: 'INICIO' });
  } catch (err) {
    console.error('[sim/start]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/chat', async (req, res) => {
  const { message, phone } = req.body as { message?: string; phone?: string };
  if (!phone || !message) {
    return res.status(400).json({ ok: false, error: 'phone e message são obrigatórios' });
  }
  if (!checkRateLimit(phone)) {
    return res.status(429).json({ ok: false, error: 'Muitas mensagens. Aguarde um momento.' });
  }
  try {
    const session  = await getOrCreateSession(req.storeId!, phone);
    // simulate:true → o "testar bot" funciona mesmo com o bot desligado pro WhatsApp
    const response = await processMessage(session, message, { simulate: true });
    return res.json({ ok: true, reply: response.text, nextNode: response.nextNode, intent: response.detectedIntent, confidence: response.confidence });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    if (e?.code === 'RATE_LIMITED') return res.status(429).json({ ok: false, error: e.message });
    console.error('[/api/chat]', err);
    return res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('store_id', req.storeId!)
      .order('atualizado_em', { ascending: false })
      .limit(100);
    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const phones = sessions.map(s => s.phone);
    const { data: msgs } = await supabase
      .from('bot_mensagens')
      .select('phone, conteudo, direcao, criado_em')
      .eq('store_id', req.storeId!)
      .in('phone', phones)
      .order('criado_em', { ascending: false });

    const lastByPhone = new Map<string, { phone: string; conteudo: string; direcao: string; criado_em: string }>();
    for (const m of (msgs || [])) {
      if (!lastByPhone.has(m.phone)) lastByPhone.set(m.phone, m);
    }

    const mapped = sessions.map(s => {
      const last = lastByPhone.get(s.phone);
      return {
        ...s,
        last_msg: last
          ? (last.direcao === 'saida' ? `Bot: ${last.conteudo}` : last.conteudo).slice(0, 60)
          : null,
      };
    });

    res.json({ ok: true, data: mapped });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/messages/:phone', async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchHistorico(req.storeId!, req.params.phone, 60) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

// ── Recovery ──────────────────────────────────────────────────────────────────
router.post('/sessions/:phone/assume', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_sessions')
      .update({ humano_ativo: true })
      .eq('store_id', req.storeId!)
      .eq('phone', req.params.phone);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/sessions/:phone/release', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_sessions')
      .update({ humano_ativo: false })
      .eq('store_id', req.storeId!)
      .eq('phone', req.params.phone);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/sessions/:phone/message', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ ok: false, error: 'Mensagem obrigatória' });
  try {
    await saveMensagem({
      store_id: req.storeId!,
      phone:    req.params.phone,
      direcao:  'saida',
      conteudo: text.trim(),
      node:     'HUMANO',
    });
    // Envia via WhatsApp (best-effort — não falha a requisição se Evolution API não configurado)
    const sent = await sendMessage(req.params.phone, text.trim(), req.storeId!);
    res.json({ ok: true, whatsappSent: sent.ok, whatsappError: sent.error });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Webhook URL da loja ───────────────────────────────────────────────────────

export default router;
