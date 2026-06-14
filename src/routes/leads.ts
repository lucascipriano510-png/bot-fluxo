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

router.get('/leads', async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchLeads(req.storeId!) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/leads', async (req, res) => {
  const { phone, nome, interesse, status_comercial, kanban_stage, valor_potencial, cidade, origem } =
    req.body as Record<string, string>;

  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return res.status(400).json({ ok: false, error: 'Telefone inválido (mínimo 10 dígitos).' });
  if (!nome?.trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório.' });

  const VALID_TEMP = ['QUENTE', 'MORNO', 'FRIO'];
  const VALID_STAGE = ['novo', 'interessado', 'escolhendo', 'carrinho', 'pagamento', 'finalizado'];

  const payload = {
    store_id:         req.storeId!,
    phone:            normalizePhone(digits),
    nome:             nome.trim(),
    interesse:        interesse?.trim() || null,
    status_comercial: VALID_TEMP.includes(status_comercial) ? status_comercial : 'FRIO',
    kanban_stage:     VALID_STAGE.includes(kanban_stage) ? kanban_stage : 'novo',
    valor_potencial:  valor_potencial ? Number(valor_potencial) : null,
    cidade:           cidade?.trim() || null,
    origem:           origem?.trim() || 'manual',
    status:           'qualificado',
    qualificado_em:   new Date().toISOString(),
    atualizado_em:    new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('bot_leads')
      .upsert(payload, { onConflict: 'store_id,phone' })
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────
router.get('/recovery', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_leads')
      .select('*')
      .eq('store_id', req.storeId!)
      .in('status_comercial', ['MORNO', 'FRIO'])
      .order('atualizado_em', { ascending: false, nullsFirst: false })
      .limit(30);
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.get('/recovery/today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('bot_leads')
      .select('*')
      .eq('store_id', req.storeId!)
      .lte('proxima_acao', today)
      .order('proxima_acao', { ascending: true })
      .limit(20);
    if (error) throw error;
    const filtered = (data || []).filter(l => l.status !== 'concluido' && l.status !== 'perdido');
    res.json({ ok: true, data: filtered });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

// ── Lead actions ──────────────────────────────────────────────────────────────
router.post('/leads/:id/convert', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_leads')
      .update({ status: 'concluido', status_comercial: 'QUENTE', kanban_stage: 'finalizado', atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (error) throw error;
    const { data: convLead } = await supabase
      .from('bot_leads')
      .select('phone, interesse, valor_potencial, total_purchases, lifetime_value')
      .eq('id', req.params.id)
      .single();
    if (convLead) {
      await supabase.from('lead_purchases').insert({
        store_id:    req.storeId!,
        lead_id:     req.params.id,
        phone:       convLead.phone,
        produto:     convLead.interesse || 'Venda',
        valor:       convLead.valor_potencial || null,
        data_compra: new Date().toISOString(),
      });
      await supabase.from('bot_leads').update({
        total_purchases: (convLead.total_purchases || 0) + 1,
        lifetime_value:  Number(convLead.lifetime_value || 0) + Number(convLead.valor_potencial || 0),
      }).eq('id', req.params.id).eq('store_id', req.storeId!);
      if (convLead.phone) recordConversion(req.storeId!, convLead.phone, 'human_converted').catch(() => {});
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/leads/:id/lose', async (req, res) => {
  const { motivo } = req.body as { motivo?: string };
  try {
    const { data: lead } = await supabase.from('bot_leads').select('notes').eq('id', req.params.id).eq('store_id', req.storeId!).single();
    const ts = new Date().toISOString().slice(0, 10);
    const notaPerda = motivo?.trim() ? `[${ts}] Perdido: ${motivo.trim()}` : `[${ts}] Marcado como perdido`;
    const newNotes = lead?.notes ? `${lead.notes}\n${notaPerda}` : notaPerda;
    const { error } = await supabase
      .from('bot_leads')
      .update({ status: 'perdido', status_comercial: 'FRIO', notes: newNotes, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/leads/:id/note', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ ok: false, error: 'Texto obrigatório' });
  try {
    const { data: lead } = await supabase.from('bot_leads').select('notes').eq('id', req.params.id).eq('store_id', req.storeId!).single();
    const ts = new Date().toLocaleString('pt-BR');
    const newNotes = lead?.notes ? `${lead.notes}\n[${ts}] ${text.trim()}` : `[${ts}] ${text.trim()}`;
    const { error } = await supabase
      .from('bot_leads')
      .update({ notes: newNotes, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/leads/:id/followup-done', async (req, res) => {
  const { dias = 3 } = req.body as { dias?: number };
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + Number(dias));
  try {
    const { error } = await supabase
      .from('bot_leads')
      .update({ proxima_acao: nextDate.toISOString().slice(0, 10), atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Flow (effective) ──────────────────────────────────────────────────────────
router.get('/leads/:id', async (req, res) => {
  try {
    const { data: lead, error } = await supabase
      .from('bot_leads')
      .select('*')
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!)
      .single();
    if (error || !lead) return res.status(404).json({ ok: false, error: 'Lead não encontrado' });
    if (lead.conversion_score === null || lead.conversion_score === undefined) {
      lead.conversion_score = calculateLeadScore(lead);
    }
    const { data: messages } = await supabase
      .from('bot_mensagens')
      .select('*')
      .eq('store_id', req.storeId!)
      .eq('phone', lead.phone)
      .order('criado_em', { ascending: true })
      .limit(100);
    res.json({ ok: true, data: { ...lead, messages: messages || [] } });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.put('/leads/:id', async (req, res) => {
  try {
    const allowed = ['nome','interesse','status_comercial','proxima_acao','valor_potencial','cidade','tamanho','estilo','origem','status','notes','kanban_stage'] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    const { data, error } = await supabase
      .from('bot_leads')
      .update({ ...patch, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!)
      .select('*')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: 'Lead não encontrado' });
    res.json({ ok: true, data });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.patch('/leads/:id/stage', async (req, res) => {
  const { stage } = req.body as { stage?: string };
  // Funil novo + estágios legados (compat com dados antigos).
  const validStages = ['novo','interessado','negociando','comprou','perdido','escolhendo','carrinho','pagamento','finalizado'];
  if (!stage || !validStages.includes(stage)) {
    return res.status(400).json({ ok: false, error: 'Stage inválido' });
  }
  try {
    const patch: Record<string, unknown> = {
      kanban_stage: stage,
      atualizado_em: new Date().toISOString(),
      kanban_movido_manualmente_em: new Date().toISOString(),
      kanban_movido_por: 'manual',
    };
    // Sincroniza calor/status com o estágio escolhido manualmente.
    if (stage === 'negociando' || stage === 'pagamento' || stage === 'carrinho') patch.status_comercial = 'QUENTE';
    else if (stage === 'interessado' || stage === 'escolhendo') patch.status_comercial = 'MORNO';
    else if (stage === 'comprou' || stage === 'finalizado') { patch.status = 'concluido'; patch.status_comercial = 'QUENTE'; }
    else if (stage === 'perdido') { patch.status = 'perdido'; patch.status_comercial = 'FRIO'; }

    const { data, error } = await supabase
      .from('bot_leads')
      .update(patch)
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!)
      .select('id')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: 'Lead não encontrado' });
    updateLeadScore(req.storeId!, req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/leads/:id/timeline', async (req, res) => {
  try {
    const { data: lead } = await supabase
      .from('bot_leads').select('*').eq('id', req.params.id).eq('store_id', req.storeId!).single();
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead não encontrado' });

    const events: Array<{ type: string; title: string; detail?: string; at: string; icon: string }> = [];

    if (lead.first_contact_at || lead.qualificado_em || lead.criado_em) {
      events.push({
        type: 'contact', title: 'Primeiro contato',
        detail: lead.origem ? `Via ${lead.origem}` : undefined,
        at: lead.first_contact_at || lead.qualificado_em || lead.criado_em, icon: '👋',
      });
    }

    const { data: msgs } = await supabase
      .from('bot_mensagens').select('conteudo, direcao, criado_em, node')
      .eq('store_id', req.storeId!).eq('phone', lead.phone)
      .order('criado_em', { ascending: true }).limit(100);

    const totalMsgs  = (msgs || []).length;
    const clientMsgs = (msgs || []).filter((m: { direcao: string }) => m.direcao === 'entrada').length;
    if (totalMsgs > 0) {
      events.push({
        type: 'conversation', title: `${totalMsgs} mensagens trocadas`,
        detail: `${clientMsgs} do cliente`, at: (msgs as Array<{ criado_em: string }>)[0].criado_em, icon: '💬',
      });
    }

    const { data: purchases } = await supabase
      .from('lead_purchases').select('*').eq('store_id', req.storeId!).eq('lead_id', req.params.id)
      .order('data_compra', { ascending: false });
    for (const p of (purchases || [])) {
      events.push({
        type: 'purchase', title: `Compra: ${p.produto || 'Produto'}`,
        detail: p.valor ? `R$ ${Number(p.valor).toFixed(2)}` : undefined,
        at: p.data_compra, icon: '🛒',
      });
    }

    if (lead.status === 'concluido') {
      events.push({
        type: 'converted', title: 'Lead finalizado',
        detail: lead.kanban_stage === 'finalizado' ? 'Convertido ✅' : 'Encerrado',
        at: lead.atualizado_em, icon: lead.kanban_stage === 'finalizado' ? '🎉' : '🔚',
      });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json({ ok: true, data: events });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

// ── Lead purchases ────────────────────────────────────────────────────────────
router.get('/leads/:id/purchases', async (req, res) => {
  try {
    const { data } = await supabase
      .from('lead_purchases').select('*').eq('store_id', req.storeId!).eq('lead_id', req.params.id)
      .order('data_compra', { ascending: false });
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/leads/:id/purchases', async (req, res) => {
  const { produto, valor, notes } = req.body as { produto?: string; valor?: number; notes?: string };
  try {
    const { data: lead } = await supabase
      .from('bot_leads').select('phone, total_purchases, lifetime_value')
      .eq('id', req.params.id).eq('store_id', req.storeId!).single();
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead não encontrado' });

    const { error } = await supabase.from('lead_purchases').insert({
      store_id: req.storeId!, lead_id: req.params.id, phone: lead.phone,
      produto: produto || null, valor: valor || null, notes: notes || null,
      data_compra: new Date().toISOString(),
    });
    if (error) throw error;

    await supabase.from('bot_leads').update({
      total_purchases: (lead.total_purchases || 0) + 1,
      lifetime_value:  Number(lead.lifetime_value || 0) + Number(valor || 0),
    }).eq('id', req.params.id).eq('store_id', req.storeId!);

    await updateLeadScore(req.storeId!, req.params.id);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Brain da loja ─────────────────────────────────────────────────────────────

export default router;
