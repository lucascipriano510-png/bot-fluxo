import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { fetchLeads } from '../services/leadService';
import { fetchHistorico } from '../services/mensagemService';
import { FLOW_MAP } from '../bot/flowMap';
import { loadFlowConfig, invalidateFlowCache } from '../services/flowConfigService';
import { getStoreContext } from '../services/storeService';
import { fetchProductsForPanel } from '../inventory/inventoryBridge';

const router = Router();

// ── Sessions ──────────────────────────────────────────────────────────────────
router.get('/sessions', async (_req, res) => {
  try {
    const { storeId } = await getStoreContext();
    const { data, error } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('store_id', storeId)
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
    const { storeId } = await getStoreContext();
    res.json({ ok: true, data: await fetchLeads(storeId) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────
router.get('/messages/:phone', async (req, res) => {
  try {
    const { storeId } = await getStoreContext();
    res.json({ ok: true, data: await fetchHistorico(storeId, req.params.phone, 60) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Recovery ──────────────────────────────────────────────────────────────────
router.get('/recovery', async (_req, res) => {
  try {
    const { storeId } = await getStoreContext();
    const { data, error } = await supabase
      .from('bot_leads')
      .select('*')
      .eq('store_id', storeId)
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
    const { storeId } = await getStoreContext();
    const flowConfig = await loadFlowConfig(storeId);
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
    const { storeId } = await getStoreContext();
    const { data, error } = await supabase
      .from('bot_flow_config')
      .select('*')
      .eq('store_id', storeId);
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

  if (!FLOW_MAP[nodeId as keyof typeof FLOW_MAP]) {
    return res.status(400).json({ ok: false, error: `Nó desconhecido: ${nodeId}` });
  }

  try {
    const { storeId } = await getStoreContext();
    const { error } = await supabase.from('bot_flow_config').upsert(
      [{
        store_id:     storeId,
        node_id:      nodeId,
        message:      message      || null,
        options:      options      || null,
        default_next: default_next || null,
      }],
      { onConflict: 'store_id,node_id' },
    );
    if (error) throw error;
    invalidateFlowCache(storeId);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Flow config: resetar nó para o padrão do código ──────────────────────────
router.delete('/flow/config/:nodeId', async (req, res) => {
  try {
    const { storeId } = await getStoreContext();
    const { error } = await supabase
      .from('bot_flow_config')
      .delete()
      .eq('store_id', storeId)
      .eq('node_id', req.params.nodeId);
    if (error) throw error;
    invalidateFlowCache(storeId);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Products (catálogo real do site via InventoryBridge) ──────────────────────
router.get('/products', async (req, res) => {
  try {
    const { category, q } = req.query as { category?: string; q?: string };
    const data = await fetchProductsForPanel({
      category: category && category !== 'all' ? category : undefined,
      q:        q && q.trim() ? q.trim() : undefined,
    });
    res.json({ ok: true, data, count: data.length });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
