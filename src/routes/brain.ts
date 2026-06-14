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
import { errMsg, cronAuthorized, EDGE_BASE, EDGE_AUTH } from './_shared';

const router = Router();

router.get('/brain', async (req, res) => {
  try {
    const { data } = await supabase
      .from('store_brain')
      .select('*')
      .eq('store_id', req.storeId!)
      .single();
    res.json({ ok: true, data: data || null });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/brain/analyze', async (req, res) => {
  try {
    const result = await runStoreAnalysis(req.storeId!);
    res.json(result);
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/brain/cron', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .in('status', ['active', 'trial']);
    const results = [];
    for (const store of (stores || [])) {
      const result = await runStoreAnalysis(store.id);
      results.push({ storeId: store.id, ...result });
    }
    // Sincroniza compras do site → CRM no mesmo ciclo agendado (idempotente).
    const siteSync = await syncSitePurchases().catch((e) => ({ ok: false, error: String(e?.message || e) }));
    res.json({ ok: true, results, siteSync });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Integração de compras do site (Fase A: pull/cron) ──────────────────────────
// Lê os pedidos finalizados/cancelados do site (read-only) e liga aos leads do
// CRM pelo telefone. Idempotente. Autenticado por CRON_SECRET, igual a /brain/cron.
router.post('/brain/conversion', async (req, res) => {
  const { phone, type } = req.body as { phone?: string; type?: string };
  if (!phone) return res.status(400).json({ ok: false, error: 'phone obrigatório' });
  try {
    await recordConversion(req.storeId!, phone, (type as 'bot_converted' | 'human_converted') || 'bot_converted');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── WhatsApp (Baileys) ────────────────────────────────────────────────────────
// Baileys requer processo Node.js persistente — não funciona em Vercel serverless.
// O stub retorna 'unavailable' para o painel mostrar mensagem clara ao invés de quebrar.
router.post('/intelligence/analyze-all', requireAuth, async (req, res) => {
  const storeId = req.storeId!;

  // Conta leads para feedback imediato ao frontend
  const { data: allLeads } = await supabase
    .from('bot_leads').select('id').eq('store_id', storeId);
  const total = allLeads?.length ?? 0;

  // Dispara Edge Function sem await — roda independente do Render
  fetch(`${EDGE_BASE()}/analyze-all-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': EDGE_AUTH() },
    body: JSON.stringify({ storeId }),
  }).catch(e => console.error('[AI] Erro ao disparar analyze-all-leads:', e));

  console.log(`[AI] Edge Function analyze-all-leads disparada. Store: ${storeId}, leads: ${total}`);
  res.json({ ok: true, status: 'processing', total_leads: total, mensagem: `Analisando ${total} leads via Edge Function` });
});

router.post('/intelligence/analyze/:leadId', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${EDGE_BASE()}/analyze-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': EDGE_AUTH() },
      body: JSON.stringify({ leadId: req.params.leadId }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ ok: false, ...data });
    res.json({ ok: true, data });
  } catch (err: unknown) {
    console.error('[Intelligence] /analyze/:leadId error:', err);
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

router.get('/intelligence/status', requireAuth, async (req, res) => {
  try {
    const storeId = req.storeId!;
    const { count: total } = await supabase
      .from('bot_leads')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .not('last_message_at', 'is', null) as any;
    const { count: analisados } = await supabase
      .from('bot_leads')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .not('ai_analisado_em', 'is', null) as any;
    const { data: ultima } = await supabase
      .from('bot_leads')
      .select('ai_analisado_em')
      .eq('store_id', storeId)
      .not('ai_analisado_em', 'is', null)
      .order('ai_analisado_em', { ascending: false })
      .limit(1)
      .single();
    res.json({
      ok: true,
      total:     total || 0,
      analisados: analisados || 0,
      pendentes: (total || 0) - (analisados || 0),
      ultima_analise: ultima?.ai_analisado_em || null,
    });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// Endpoint para sugestão de resposta (UI no P12)
router.post('/intelligence/suggest-reply/:leadId', requireAuth, async (_req, res) => {
  res.json({ ok: false, error: 'UI a implementar no P12.' });
});

// ── Backfill: cria leads para conversas existentes sem lead no CRM ─────────

export default router;
