import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { fetchLeads } from '../services/leadService';
import { fetchHistorico } from '../services/mensagemService';
import { FLOW_MAP } from '../bot/flowMap';

const router = Router();

router.get('/sessions', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_sessions')
      .select('*')
      .order('atualizado_em', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/sessions]', msg);
    res.json({ ok: false, data: [], error: msg });
  }
});

router.get('/leads', async (_req, res) => {
  try {
    const data = await fetchLeads();
    res.json({ ok: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/leads]', msg);
    res.json({ ok: false, data: [], error: msg });
  }
});

router.get('/messages/:phone', async (req, res) => {
  try {
    const data = await fetchHistorico(req.params.phone, 60);
    res.json({ ok: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/messages]', msg);
    res.json({ ok: false, data: [], error: msg });
  }
});

// Leads parados no meio do funil (MORNO ou FRIO) — usados na aba de recuperação
router.get('/recovery', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_leads')
      .select('*')
      .in('status_comercial', ['MORNO', 'FRIO'])
      .order('atualizado_em', { ascending: false, nullsFirst: false })
      .limit(30);
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, data: [], error: msg });
  }
});

router.get('/flow', (_req, res) => {
  try {
    const data = Object.values(FLOW_MAP).map(n => ({
      id: n.id,
      message: typeof n.message === 'function' ? n.message({}) : n.message,
      options: (n.options || []).map(o => ({ trigger: o.trigger.source, next: o.next, data: o.data || null })),
      default: n.default || null,
      action: n.action || null,
      terminal: n.terminal || false,
    }));
    res.json({ ok: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, data: [], error: msg });
  }
});

export default router;
