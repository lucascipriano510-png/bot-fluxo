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

router.get('/wa/status', async (req, res) => {
  await initBaileys(req.storeId!).catch(() => {});
  const s = getWaState();
  if (s.status === 'unavailable') {
    return res.json({ ok: true, status: 'unavailable', qr: null, message: 'WhatsApp requer servidor dedicado (Railway/Render/VPS). Não disponível na Vercel.' });
  }
  res.json({ ok: true, status: s.status, qr: s.qr });
});

router.get('/wa/qr', async (req, res) => {
  await initBaileys(req.storeId!).catch(() => {});
  const s = getWaState();
  res.json({ ok: true, status: s.status, qr: s.qr });
});

router.get('/wa/conversations', async (req, res) => {
  try {
    const { data } = await supabase
      .from('wa_conversations')
      .select('*')
      .eq('store_id', req.storeId!)
      .or('is_group.eq.false,is_group.is.null')
      .order('last_time', { ascending: false });
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/wa/cleanup', async (req, res) => {
  try {
    const { error } = await supabase
      .from('wa_conversations')
      .delete()
      .eq('store_id', req.storeId!)
      .or('is_group.eq.true,phone.like.%@%');
    res.json({ ok: !error, error: error?.message });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.get('/wa/messages/:phone', async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const { data } = await supabase
      .from('wa_messages')
      .select('*')
      .eq('store_id', req.storeId!)
      .eq('phone', phone)
      .order('timestamp', { ascending: true })
      .limit(100);
    // Mark as read
    await supabase.from('wa_conversations')
      .update({ unread_count: 0 })
      .eq('store_id', req.storeId!)
      .eq('phone', phone);
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/wa/send', async (req, res) => {
  const { phone, text } = req.body as { phone?: string; text?: string };
  if (!phone?.trim() || !text?.trim()) {
    return res.status(400).json({ ok: false, error: 'phone e text obrigatórios' });
  }
  if (getWaState().status === 'unavailable') {
    return res.json({ ok: false, error: 'WhatsApp requer servidor dedicado.' });
  }
  try {
    await sendWaMessage(phone.trim(), text.trim(), req.storeId!);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/wa/disconnect', async (_req, res) => {
  await disconnectBaileys().catch(() => {});
  res.json({ ok: true });
});

router.post('/wa/backfill-leads', async (req, res) => {
  try {
    const storeId = req.storeId!;
    const { data: convs, error } = await supabase
      .from('wa_conversations')
      .select('phone, name, last_message')
      .eq('store_id', storeId)
      .eq('is_group', false)
      .is('lead_id', null);

    if (error) throw error;
    if (!convs || convs.length === 0) return res.json({ ok: true, created: 0, skipped: 0 });

    let created = 0;
    let skipped = 0;
    for (const conv of convs) {
      const { data: inserted, error: insertErr } = await supabase.from('bot_leads').upsert({
        store_id:         storeId,
        phone:            conv.phone,
        nome:             conv.name || conv.phone,
        origem:           'whatsapp_inbox',
        status_comercial: 'FRIO',
        interesse:        (conv.last_message || '').slice(0, 100),
        kanban_stage:     'novo',
        status:           'qualificado',
        qualificado_em:   new Date().toISOString(),
        atualizado_em:    new Date().toISOString(),
      }, { onConflict: 'store_id,phone' }).select('id').single();

      if (insertErr || !inserted) {
        console.error('[backfill-leads] erro:', { phone: conv.phone, error: insertErr?.message });
        skipped++;
        continue;
      }

      await supabase.from('wa_conversations')
        .update({ lead_id: inserted.id })
        .eq('store_id', storeId)
        .eq('phone', conv.phone);

      created++;
    }

    res.json({ ok: true, created, skipped, total: convs.length });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

export default router;
