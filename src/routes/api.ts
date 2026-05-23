import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { fetchLeads } from '../services/leadService';
import { fetchHistorico } from '../services/mensagemService';

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

export default router;
