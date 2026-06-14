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

router.get('/reports', async (req, res) => {
  try {
    const storeId = req.storeId!;
    const since7  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: msgs7 }, { data: leads7 }, { data: allLeads }, { data: purch7 }, { data: allPurch }] = await Promise.all([
      supabase.from('bot_mensagens').select('criado_em,direcao').eq('store_id', storeId).gte('criado_em', since7),
      supabase.from('bot_leads').select('criado_em').eq('store_id', storeId).gte('criado_em', since7),
      supabase.from('bot_leads').select('status, total_purchases, lifetime_value').eq('store_id', storeId),
      supabase.from('lead_purchases').select('valor, data_compra, refunded_at').eq('store_id', storeId).gte('data_compra', since7),
      supabase.from('lead_purchases').select('valor, refunded_at').eq('store_id', storeId),
    ]);

    const labels: string[]  = [];
    const atendArr: number[] = [];
    const leadsArr: number[] = [];
    const fatArr: number[]   = [];
    const daysOfWeek = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      labels.push(daysOfWeek[d.getDay()]);
      const day = d.toISOString().slice(0, 10);
      atendArr.push((msgs7 || []).filter(m => m.direcao === 'entrada' && m.criado_em?.startsWith(day)).length);
      leadsArr.push((leads7 || []).filter(l => l.criado_em?.startsWith(day)).length);
      fatArr.push((purch7 || [])
        .filter(p => !p.refunded_at && p.data_compra?.startsWith(day))
        .reduce((s, p) => s + Number(p.valor || 0), 0));
    }

    // Resumo comercial (vendas ligadas pelo CRM)
    const revenueTotal = (allPurch || []).filter(p => !p.refunded_at).reduce((s, p) => s + Number(p.valor || 0), 0);
    const clientes     = (allLeads || []).filter(l => (l.total_purchases || 0) > 0).length;
    const ticketMedio  = clientes > 0 ? revenueTotal / clientes : 0;
    const conversao    = (allLeads || []).length > 0 ? Math.round((clientes / (allLeads || []).length) * 100) : 0;

    const inbound  = (msgs7 || []).filter(m => m.direcao === 'entrada').length;
    const outbound = (msgs7 || []).filter(m => m.direcao === 'saida').length;
    const taxaResposta = inbound > 0 ? Math.round((outbound / inbound) * 100) : 0;

    const hourCount: Record<number, number> = {};
    (msgs7 || []).filter(m => m.direcao === 'entrada').forEach(m => {
      if (!m.criado_em) return;
      const h = new Date(m.criado_em).getHours();
      hourCount[h] = (hourCount[h] || 0) + 1;
    });
    const peakHour = Object.entries(hourCount).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? null;

    const totalLeads   = (allLeads || []).length;
    const encaminhados = (allLeads || []).filter(l => l.status === 'encaminhado').length;
    const pctEncam     = totalLeads > 0 ? Math.round((encaminhados / totalLeads) * 100) : 0;

    res.json({
      ok: true,
      data: {
        labels,
        atendimentos: atendArr,
        leads: leadsArr,
        faturamento: fatArr,
        taxaResposta,
        peakHour: peakHour !== null ? `${peakHour}h` : '—',
        pctEncaminhados: pctEncam,
        totalMensagens: inbound,
        revenueTotal,
        clientes,
        ticketMedio,
        conversao,
      },
    });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Session takeover ──────────────────────────────────────────────────────────

export default router;
