import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { fetchLeads } from '../services/leadService';
import { fetchHistorico } from '../services/mensagemService';
import { FLOW_MAP } from '../bot/flowMap';
import { loadFlowConfig, invalidateFlowCache } from '../services/flowConfigService';

const router = Router();

// ── Sessions ──────────────────────────────────────────────────────────────────
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
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/leads', async (_req, res) => {
  try {
    res.json({ ok: true, data: await fetchLeads() });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────
router.get('/messages/:phone', async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchHistorico(req.params.phone, 60) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Recovery ──────────────────────────────────────────────────────────────────
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
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Flow (effective — merges DB config over code defaults) ────────────────────
router.get('/flow', async (_req, res) => {
  try {
    const flowConfig = await loadFlowConfig();
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
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Flow config: listar todos os overrides ────────────────────────────────────
router.get('/flow/config', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('bot_flow_config').select('*');
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Flow config: salvar override de um nó ────────────────────────────────────
router.post('/flow/config', async (req, res) => {
  const { nodeId, message, options, default_next } = req.body as {
    nodeId?: string;
    message?: string | null;
    options?: Array<{ trigger: string; next: string; data?: Record<string, string> }> | null;
    default_next?: string | null;
  };
  if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId obrigatório' });

  // Validação mínima: nodeId deve existir no FLOW_MAP
  if (!FLOW_MAP[nodeId as keyof typeof FLOW_MAP]) {
    return res.status(400).json({ ok: false, error: `Nó desconhecido: ${nodeId}` });
  }

  try {
    const { error } = await supabase.from('bot_flow_config').upsert(
      [{
        node_id:      nodeId,
        message:      message      || null,
        options:      options      || null,
        default_next: default_next || null,
      }],
      { onConflict: 'node_id' },
    );
    if (error) throw error;
    invalidateFlowCache();
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Flow config: resetar nó para o padrão do código ──────────────────────────
router.delete('/flow/config/:nodeId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_flow_config')
      .delete()
      .eq('node_id', req.params.nodeId);
    if (error) throw error;
    invalidateFlowCache();
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
