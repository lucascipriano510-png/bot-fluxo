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

router.get('/webhook-url', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stores')
      .select('slug')
      .eq('id', req.storeId!)
      .single();
    if (error || !data) return res.status(404).json({ ok: false, error: 'Loja não encontrada' });
    const protocol   = req.headers['x-forwarded-proto'] || 'https';
    const host       = req.headers['x-forwarded-host'] || req.get('host');
    const webhookUrl = `${protocol}://${host}/webhook/${data.slug}`;
    res.json({ ok: true, webhookUrl, slug: data.slug });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Integrations — Evolution API ──────────────────────────────────────────────
router.get('/integrations/evolution', async (req, res) => {
  try {
    const { data } = await supabase
      .from('bot_settings')
      .select('evolution_url, evolution_instance, evolution_token')
      .eq('store_id', req.storeId!)
      .maybeSingle();

    const configured = !!(data?.evolution_url && data?.evolution_instance && data?.evolution_token);
    // Mascara o token para não expor no frontend
    const token = (data?.evolution_token as string) || '';
    const maskedToken = token.length > 4
      ? '*'.repeat(token.length - 4) + token.slice(-4)
      : '*'.repeat(token.length);

    res.json({
      ok: true,
      data: {
        evolution_url:      (data?.evolution_url      as string) || '',
        evolution_instance: (data?.evolution_instance as string) || '',
        evolution_token_masked: maskedToken,
        configured,
      },
    });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/integrations/evolution', async (req, res) => {
  const { evolution_url, evolution_instance, evolution_token } = req.body as {
    evolution_url?: string; evolution_instance?: string; evolution_token?: string;
  };
  if (!evolution_url?.trim() || !evolution_instance?.trim() || !evolution_token?.trim()) {
    return res.status(400).json({ ok: false, error: 'URL, instância e token são obrigatórios.' });
  }
  try {
    const { error } = await supabase
      .from('bot_settings')
      .upsert([{
        store_id:           req.storeId!,
        evolution_url:      evolution_url.trim().replace(/\/$/, ''),
        evolution_instance: evolution_instance.trim(),
        evolution_token:    evolution_token.trim(),
        updated_at:         new Date().toISOString(),
      }], { onConflict: 'store_id' });
    if (error) throw error;
    invalidateCredCache(req.storeId!);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/integrations/evolution/test', async (req, res) => {
  try {
    const { data } = await supabase
      .from('bot_settings')
      .select('evolution_url, evolution_instance, evolution_token')
      .eq('store_id', req.storeId!)
      .maybeSingle();

    if (!data?.evolution_url || !data?.evolution_instance || !data?.evolution_token) {
      return res.json({ ok: false, error: 'Salve as credenciais antes de testar.' });
    }

    const baseUrl  = (data.evolution_url as string).replace(/\/$/, '');
    const instance = data.evolution_instance as string;
    const token    = data.evolution_token    as string;

    const testUrl = `${baseUrl}/instance/connectionState/${instance}`;
    const resp = await fetch(testUrl, {
      headers: { apikey: token },
      signal:  AbortSignal.timeout(8_000),
    });

    if (resp.status === 404) {
      return res.json({ ok: false, error: `Instância "${instance}" não encontrada no servidor Evolution API.` });
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.json({ ok: false, error: `Evolution API retornou ${resp.status}. Verifique URL e token. ${body.slice(0, 120)}` });
    }

    const json = await resp.json() as Record<string, unknown>;
    const state = (json?.instance as Record<string, unknown>)?.state ?? json?.state ?? json?.status ?? 'unknown';

    if (state === 'open' || state === 'ONLINE' || state === 'connected') {
      return res.json({ ok: true, message: `Instância "${instance}" conectada ao WhatsApp.`, state });
    }
    if (state === 'close' || state === 'OFFLINE' || state === 'disconnected') {
      return res.json({ ok: false, error: `Instância "${instance}" está desconectada (${state}). Escaneie o QR code no Evolution API Manager.`, state });
    }
    return res.json({ ok: true, message: `Instância "${instance}" encontrada. Estado: ${state}.`, state });
  } catch (err: unknown) {
    const msg = errMsg(err);
    if (msg.includes('TimeoutError') || msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      return res.json({ ok: false, error: 'Timeout: Evolution API não respondeu em 8s. Verifique a URL.' });
    }
    return res.json({ ok: false, error: msg });
  }
});

// ── Store Knowledge — inteligência da loja ───────────────────────────────────
router.get('/channels', async (req, res) => {
  try {
    const { getAllChannels } = await import('../services/channelContextService');
    const { data } = await supabase
      .from('bot_settings')
      .select('evolution_url, evolution_instance')
      .eq('store_id', req.storeId!)
      .maybeSingle();
    const evolutionConfigured = !!(data?.evolution_url && data?.evolution_instance);
    const aiConfigured        = !!(process.env.AI_ASSIST_PROVIDER && process.env.AI_ASSIST_KEY);
    const channels            = getAllChannels({ evolutionConfigured, aiConfigured });
    res.json({ ok: true, channels });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── IA Assist — status e teste ───────────────────────────────────────────────
router.get('/integrations/ai', (_req, res) => {
  const provider    = process.env.AI_ASSIST_PROVIDER || '';
  const key         = process.env.AI_ASSIST_KEY      || '';
  const model       = process.env.AI_ASSIST_MODEL    || 'gemini-2.5-flash';
  const configured  = !!(provider && key);
  res.json({ ok: true, configured, provider: provider || 'gemini', model });
});

router.post('/integrations/ai/test', async (_req, res) => {
  try {
    const { testAiConnection } = await import('../services/aiAssistService');
    const result = await testAiConnection();
    if (result.ok) {
      res.json({ ok: true, message: `IA Generativa (${result.provider} / ${result.model}) funcionando!`, reply: result.reply });
    } else {
      res.json({ ok: false, error: result.error });
    }
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/integrations/site-purchases/sync', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const limit = Number((req.body as { limit?: number })?.limit) || 500;
    const summary = await syncSitePurchases(limit);
    res.json(summary);
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});


export default router;
