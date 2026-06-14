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

router.get('/flow', async (req, res) => {
  try {
    const flowConfig = await loadFlowConfig(req.storeId!);
    const data = Object.values(FLOW_MAP).map(n => {
      const cfg = flowConfig.get(n.id);
      const opts = cfg?.options
        ? cfg.options.map(o => ({ trigger: o.trigger, next: o.next, data: o.data || null }))
        : (n.options || []).map(o => ({ trigger: o.trigger.source, next: o.next, data: o.data || null }));
      const msg = cfg?.message
        ? cfg.message
        : (typeof n.message === 'function' ? n.message({}) : n.message);
      return {
        id: n.id,
        message: msg,
        options: opts,
        default: cfg?.default_next || n.default || null,
        action: n.action || null,
        terminal: n.terminal || false,
        customized: !!(cfg?.message || cfg?.options || cfg?.default_next),
      };
    });
    res.json({ ok: true, data });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

// ── Flow config ───────────────────────────────────────────────────────────────
router.get('/flow/config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_flow_config')
      .select('*')
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/flow/config', async (req, res) => {
  const { nodeId, message, options, default_next } = req.body as {
    nodeId?: string;
    message?: string | null;
    options?: Array<{ trigger: string; next: string; data?: Record<string, string> }> | null;
    default_next?: string | null;
  };
  if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId obrigatório' });
  if (!FLOW_MAP[nodeId as keyof typeof FLOW_MAP]) {
    return res.status(400).json({ ok: false, error: `Nó desconhecido: ${nodeId}` });
  }
  try {
    const { error } = await supabase.from('bot_flow_config').upsert(
      [{ store_id: req.storeId!, node_id: nodeId, message: message || null, options: options || null, default_next: default_next || null }],
      { onConflict: 'store_id,node_id' },
    );
    if (error) throw error;
    invalidateFlowCache(req.storeId!);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.delete('/flow/config/:nodeId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_flow_config')
      .delete()
      .eq('store_id', req.storeId!)
      .eq('node_id', req.params.nodeId);
    if (error) throw error;
    invalidateFlowCache(req.storeId!);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

export default router;
