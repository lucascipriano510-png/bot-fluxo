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

router.get('/settings', async (req, res) => {
  try {
    const data = await loadSettings(req.storeId!);
    const { setup_needed, ...cfg } = data as typeof data & { setup_needed?: boolean };
    res.json({ ok: true, data: cfg, setup_needed: setup_needed ?? false });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const allowed = [
      'nome_loja','whatsapp','saudacao',
      'horario_inicio','horario_fim',
      'bot_ativo','ignorar_horario','fallback_humano','delay_resposta',
      'business_type','city','state','delivery_info','payment_info',
      'instagram','site_url','catalog_url',
      'sales_tone','sales_instructions','return_policy','discount_rules',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo válido enviado' });
    }
    await saveSettings(req.storeId!, patch as Parameters<typeof saveSettings>[1]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Products ──────────────────────────────────────────────────────────────────
router.get('/knowledge', async (req, res) => {
  try {
    const { getStoreKnowledge } = await import('../services/storeKnowledgeService');
    const kb = await getStoreKnowledge(req.storeId!);
    res.json({ ok: true, knowledge: kb });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Site scan — escaneia homepage da loja configurada ────────────────────────
router.post('/knowledge/site/scan', async (req, res) => {
  try {
    const settings = await getRuntimeSettings(req.storeId!);
    const siteUrl  = settings.site_url;
    if (!siteUrl) {
      return res.json({ ok: false, error: 'site_url não configurado. Defina em Configurações → Perfil da Loja.' });
    }
    const { scanSite }                       = await import('../services/siteScanService');
    const { updateSiteScan, clearKnowledgeCache } = await import('../services/storeKnowledgeService');
    const result = await scanSite(siteUrl);
    updateSiteScan(req.storeId!, result);
    clearKnowledgeCache(req.storeId!);
    // Persiste resumo no banco para sobreviver a deploys e cold starts
    await saveSettings(req.storeId!, {
      site_scan_summary: result.rawSummary.slice(0, 2000),
      site_scan_title:   result.title || '',
      site_scan_at:      result.scannedAt,
    });
    res.json({ ok: true, result });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Canais — status de todos os conectores ───────────────────────────────────

export default router;
