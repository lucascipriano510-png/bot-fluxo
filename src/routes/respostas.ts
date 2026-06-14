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
import { errMsg, cronAuthorized, isMissingTable } from './_shared';

const router = Router();

router.get('/respostas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_respostas_rapidas')
      .select('*')
      .eq('store_id', req.storeId!)
      .order('prioridade', { ascending: false })
      .order('criado_em',  { ascending: true });
    if (isMissingTable(error)) return res.json({ ok: true, data: [], setup_needed: true });
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/respostas', async (req, res) => {
  const { titulo, gatilhos, resposta, ativo, prioridade } = req.body as {
    titulo?: string; gatilhos?: string | string[];
    resposta?: string; ativo?: boolean; prioridade?: number;
  };
  if (!titulo?.trim() || !resposta?.trim()) {
    return res.status(400).json({ ok: false, error: 'Título e resposta são obrigatórios.' });
  }
  const gatArray = Array.isArray(gatilhos)
    ? gatilhos.map(g => g.trim()).filter(Boolean)
    : String(gatilhos || '').split(',').map(g => g.trim()).filter(Boolean);

  try {
    const { data, error } = await supabase
      .from('bot_respostas_rapidas')
      .insert({
        store_id:   req.storeId!,
        titulo:     titulo.trim(),
        gatilhos:   gatArray,
        resposta:   resposta.trim(),
        ativo:      ativo !== false,
        prioridade: Number(prioridade) || 0,
      })
      .select('*')
      .single();
    if (isMissingTable(error)) {
      return res.status(503).json({ ok: false, setup_needed: true, error: 'Tabela bot_respostas_rapidas não existe. Execute o SQL de migração.' });
    }
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.put('/respostas/:id', async (req, res) => {
  const { titulo, gatilhos, resposta, ativo, prioridade } = req.body as {
    titulo?: string; gatilhos?: string | string[];
    resposta?: string; ativo?: boolean; prioridade?: number;
  };
  const gatArray = gatilhos !== undefined
    ? (Array.isArray(gatilhos)
        ? gatilhos.map(g => g.trim()).filter(Boolean)
        : String(gatilhos).split(',').map(g => g.trim()).filter(Boolean))
    : undefined;
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (titulo    !== undefined) patch.titulo    = titulo.trim();
  if (gatArray  !== undefined) patch.gatilhos  = gatArray;
  if (resposta  !== undefined) patch.resposta  = resposta.trim();
  if (ativo     !== undefined) patch.ativo     = ativo;
  if (prioridade !== undefined) patch.prioridade = Number(prioridade) || 0;

  try {
    const { data, error } = await supabase
      .from('bot_respostas_rapidas')
      .update(patch)
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!)
      .select('*')
      .single();
    if (isMissingTable(error)) return res.status(503).json({ ok: false, setup_needed: true, error: 'Tabela não encontrada.' });
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: 'Resposta não encontrada.' });
    res.json({ ok: true, data });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.delete('/respostas/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_respostas_rapidas')
      .delete()
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (isMissingTable(error)) return res.status(503).json({ ok: false, setup_needed: true });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Lead timeline ─────────────────────────────────────────────────────────────

export default router;
