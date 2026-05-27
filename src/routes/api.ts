import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase';
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

const router = Router();

// ── Config pública (sem auth) — bootstrapa o cliente Supabase no frontend ────
router.get('/config', (_req, res) => {
  res.json({
    supabaseUrl:      process.env.SUPABASE_URL,
    supabaseAnonKey:  process.env.SUPABASE_ANON_KEY || '',
  });
});

// ── Signup — cria loja + usuário sem autenticação prévia ─────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

router.post('/signup', async (req, res) => {
  const { nome, email, senha, nome_loja, whatsapp, business_type } = req.body as {
    nome?: string; email?: string; senha?: string;
    nome_loja?: string; whatsapp?: string; business_type?: string;
  };

  if (!nome?.trim() || !email?.trim() || !senha || !nome_loja?.trim() || !whatsapp?.trim()) {
    return res.status(400).json({ ok: false, error: 'Todos os campos são obrigatórios.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ ok: false, error: 'Senha deve ter pelo menos 6 caracteres.' });
  }

  const cleanPhone = whatsapp.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ ok: false, error: 'WhatsApp inválido. Use o formato com DDD e DDI (ex: 5534999999999).' });
  }

  const slug = slugify(nome_loja);

  try {
    // 1. Verifica duplicatas
    const { data: existing } = await supabase
      .from('stores')
      .select('id')
      .or(`slug.eq.${slug},whatsapp_number.eq.${cleanPhone}`)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ ok: false, error: 'Já existe uma loja com esse nome ou WhatsApp.' });
    }

    // 2. Cria usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email:           email.trim(),
      password:        senha,
      email_confirm:   true,
      user_metadata:   { nome: nome.trim() },
    });
    if (authError) {
      const msg = authError.message.includes('already registered')
        ? 'Esse e-mail já está cadastrado.'
        : authError.message;
      return res.status(400).json({ ok: false, error: msg });
    }

    // 3. Cria loja
    const newStoreId = randomUUID();
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({ id: newStoreId, slug, name: nome_loja.trim(), whatsapp_number: cleanPhone, is_active: true })
      .select('id')
      .single();
    if (storeError) throw storeError;

    // 4. Grava store_id no app_metadata do usuário (via GoTrue, sem PostgREST)
    const { error: metaError } = await supabase.auth.admin.updateUserById(
      authData.user.id,
      { app_metadata: { store_id: store.id, role: 'owner' } }
    );
    if (metaError) throw metaError;

    // 4b. Tenta inserir em store_users via RPC — falha silenciosa se PostgREST não tiver recarregado ainda
    await supabase.rpc('insert_store_user', {
      p_user_id: authData.user.id,
      p_store_id: store.id,
      p_role: 'owner',
    }).then(({ error }) => {
      if (error) console.warn('[signup] store_users RPC fallback failed (não crítico):', error.message);
    });

    // 5. Cria settings padrão para a loja
    await supabase.from('bot_settings').upsert([{
      store_id:        store.id,
      nome_loja:       nome_loja.trim(),
      whatsapp:        cleanPhone,
      saudacao:        `Olá! 👋 Bem-vindo à *${nome_loja.trim()}*.`,
      horario_inicio:  '09:00',
      horario_fim:     '18:00',
      bot_ativo:       true,
      ignorar_horario: false,
      fallback_humano: true,
      delay_resposta:  true,
    }], { onConflict: 'store_id' });

    // 6. Aplica preset de fluxo para o tipo de negócio escolhido
    const validTypes: BusinessType[] = ['varejo', 'servicos', 'agendamento', 'generico'];
    const bType: BusinessType = validTypes.includes(business_type as BusinessType)
      ? (business_type as BusinessType)
      : 'generico';
    const presetNodes = getPreset(bType);
    if (presetNodes.length > 0) {
      await supabase.from('bot_flow_config').insert(
        presetNodes.map(n => ({
          store_id:     store.id,
          node_id:      n.node_id,
          message:      n.message,
          options:      n.options,
          default_next: n.default_next,
        }))
      );
    }

    const protocol   = req.headers['x-forwarded-proto'] || 'https';
    const host       = req.headers['x-forwarded-host'] || req.get('host');
    const webhookUrl = `${protocol}://${host}/webhook/${slug}`;

    return res.json({ ok: true, slug, webhookUrl });

  } catch (err: unknown) {
    console.error('[/api/signup]', err);
    return res.status(500).json({ ok: false, error: 'Erro interno ao criar a loja. Tente novamente.' });
  }
});

// ── Health check (sem auth) ───────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'bot-api', env: process.env.NODE_ENV || 'production' });
});

// A partir daqui todas as rotas exigem autenticação
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Simulador (painel) — movido de app.ts para cair sob auth
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sim/reset', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  try {
    await resetSession(req.storeId!, phone);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[sim/reset]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/sim/start', async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  try {
    const storeCtx = await getStoreById(req.storeId!);
    const settings = await getRuntimeSettings(req.storeId!);
    await resetSession(req.storeId!, phone);
    const node = FLOW_MAP['INICIO'];
    const ctx  = { _storeName: storeCtx.name, _saudacao: settings.saudacao };
    const text = typeof node.message === 'function' ? node.message(ctx) : node.message;
    await saveMensagem({ store_id: req.storeId!, phone, direcao: 'saida', conteudo: text, node: 'INICIO' });
    return res.json({ ok: true, text, nextNode: 'INICIO' });
  } catch (err) {
    console.error('[sim/start]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/chat', async (req, res) => {
  const { message, phone } = req.body as { message?: string; phone?: string };
  if (!phone || !message) {
    return res.status(400).json({ ok: false, error: 'phone e message são obrigatórios' });
  }
  if (!checkRateLimit(phone)) {
    return res.status(429).json({ ok: false, error: 'Muitas mensagens. Aguarde um momento.' });
  }
  try {
    const session  = await getOrCreateSession(req.storeId!, phone);
    const response = await processMessage(session, message);
    return res.json({ ok: true, reply: response.text, nextNode: response.nextNode, intent: response.detectedIntent, confidence: response.confidence });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    if (e?.code === 'RATE_LIMITED') return res.status(429).json({ ok: false, error: e.message });
    console.error('[/api/chat]', err);
    return res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('store_id', req.storeId!)
      .order('atualizado_em', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchLeads(req.storeId!) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────
router.get('/messages/:phone', async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchHistorico(req.storeId!, req.params.phone, 60) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Recovery ──────────────────────────────────────────────────────────────────
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
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Flow (effective) ──────────────────────────────────────────────────────────
router.get('/flow', async (req, res) => {
  try {
    const flowConfig = await loadFlowConfig(req.storeId!);
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

// ── Flow config ───────────────────────────────────────────────────────────────
router.get('/flow/config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_flow_config')
      .select('*')
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true, data: data || [] });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: err instanceof Error ? err.message : String(err) });
  }
});

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
    const { error } = await supabase.from('bot_flow_config').upsert(
      [{ store_id: req.storeId!, node_id: nodeId, message: message || null, options: options || null, default_next: default_next || null }],
      { onConflict: 'store_id,node_id' },
    );
    if (error) throw error;
    invalidateFlowCache(req.storeId!);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/flow/config/:nodeId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_flow_config')
      .delete()
      .eq('store_id', req.storeId!)
      .eq('node_id', req.params.nodeId);
    if (error) throw error;
    invalidateFlowCache(req.storeId!);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const data = await loadSettings(req.storeId!);
    const { setup_needed, ...cfg } = data as typeof data & { setup_needed?: boolean };
    res.json({ ok: true, data: cfg, setup_needed: setup_needed ?? false });
  } catch (err: unknown) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const allowed = [
      'nome_loja','whatsapp','saudacao',
      'horario_inicio','horario_fim',
      'bot_ativo','ignorar_horario','fallback_humano','delay_resposta',
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
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Products ──────────────────────────────────────────────────────────────────
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
