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

const router = Router();

function errMsg(err: unknown): string {
  if (!err) return 'Erro desconhecido';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.details === 'string') return e.details;
    if (typeof e.hint   === 'string') return e.hint;
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

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
  const { nome, email, senha, nome_loja, whatsapp, business_type, invite_code } = req.body as {
    nome?: string; email?: string; senha?: string;
    nome_loja?: string; whatsapp?: string; business_type?: string; invite_code?: string;
  };

  if (!nome?.trim() || !email?.trim() || !senha || !nome_loja?.trim() || !whatsapp?.trim()) {
    return res.status(400).json({ ok: false, error: 'Todos os campos são obrigatórios.' });
  }
  if (!invite_code?.trim()) {
    return res.status(400).json({ ok: false, error: 'Código de convite obrigatório.' });
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
    // 1. Valida invite_code (backend — nunca apenas frontend)
    const { data: invite, error: inviteError } = await supabase
      .from('invite_codes')
      .select('id, status, max_uses, used_count, expires_at, plan')
      .eq('code', invite_code.trim().toUpperCase())
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) {
      return res.status(400).json({ ok: false, error: 'Código de convite inválido.' });
    }
    if (invite.status !== 'active') {
      return res.status(400).json({ ok: false, error: 'Código de convite inativo ou já utilizado.' });
    }
    if (invite.used_count >= invite.max_uses) {
      return res.status(400).json({ ok: false, error: 'Código de convite já atingiu o limite de usos.' });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ ok: false, error: 'Código de convite expirado.' });
    }

    // 2. Verifica duplicatas de loja
    const { data: existing } = await supabase
      .from('stores')
      .select('id')
      .or(`slug.eq.${slug},whatsapp_number.eq.${cleanPhone}`)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ ok: false, error: 'Já existe uma loja com esse nome ou WhatsApp.' });
    }

    // 3. Cria usuário no Supabase Auth
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

    // 4. Cria loja com status pending_payment e plano do invite_code
    const newStoreId = randomUUID();
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({
        id:              newStoreId,
        slug,
        name:            nome_loja.trim(),
        whatsapp_number: cleanPhone,
        is_active:       true,
        status:          'pending_payment',
        plan:            invite.plan || 'bot',
      })
      .select('id')
      .single();
    if (storeError) throw storeError;

    // 5. Grava store_id no app_metadata do usuário
    const { error: metaError } = await supabase.auth.admin.updateUserById(
      authData.user.id,
      { app_metadata: { store_id: store.id, role: 'owner' } }
    );
    if (metaError) throw metaError;

    // 5b. Insere em store_users via RPC
    await supabase.rpc('insert_store_user', {
      p_user_id:  authData.user.id,
      p_store_id: store.id,
      p_role:     'owner',
    }).then(({ error }) => {
      if (error) console.warn('[signup] store_users RPC fallback failed (não crítico):', error.message);
    });

    // 6. Cria settings padrão para a loja
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

    // 7. Aplica preset de fluxo para o tipo de negócio escolhido
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

    // 8. Incrementa uso do invite_code
    const newUsedCount = invite.used_count + 1;
    await supabase
      .from('invite_codes')
      .update({
        used_count: newUsedCount,
        status:     newUsedCount >= invite.max_uses ? 'used' : 'active',
        used_by:    authData.user.id,
        used_at:    new Date().toISOString(),
      })
      .eq('id', invite.id);

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

// ── Dados da loja autenticada ─────────────────────────────────────────────────
router.get('/store', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, slug, name, status, plan, trial_ends_at')
      .eq('id', req.storeId!)
      .single();
    if (error || !data) {
      return res.status(404).json({ ok: false, error: 'Loja não encontrada' });
    }
    return res.json({ ok: true, data });
  } catch (err: unknown) {
    return res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

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
    const { data: sessions, error } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('store_id', req.storeId!)
      .order('atualizado_em', { ascending: false })
      .limit(100);
    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const phones = sessions.map(s => s.phone);
    const { data: msgs } = await supabase
      .from('bot_mensagens')
      .select('phone, conteudo, direcao, criado_em')
      .eq('store_id', req.storeId!)
      .in('phone', phones)
      .order('criado_em', { ascending: false });

    const lastByPhone = new Map<string, { phone: string; conteudo: string; direcao: string; criado_em: string }>();
    for (const m of (msgs || [])) {
      if (!lastByPhone.has(m.phone)) lastByPhone.set(m.phone, m);
    }

    const mapped = sessions.map(s => {
      const last = lastByPhone.get(s.phone);
      return {
        ...s,
        last_msg: last
          ? (last.direcao === 'saida' ? `Bot: ${last.conteudo}` : last.conteudo).slice(0, 60)
          : null,
      };
    });

    res.json({ ok: true, data: mapped });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

// ── Leads ─────────────────────────────────────────────────────────────────────
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
    status:           'novo',
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
router.get('/messages/:phone', async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchHistorico(req.storeId!, req.params.phone, 60) });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
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
      .update({ status: 'concluido', status_comercial: 'CONVERTIDO', kanban_stage: 'finalizado', atualizado_em: new Date().toISOString() })
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
    res.json({ ok: false, data: [], error: errMsg(err) });
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
    res.json({ ok: false, data: [], error: errMsg(err) });
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
    res.json({ ok: false, error: errMsg(err) });
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
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const data = await loadSettings(req.storeId!);
    const { setup_needed, ...cfg } = data as typeof data & { setup_needed?: boolean };
    res.json({ ok: true, data: cfg, setup_needed: setup_needed ?? false });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const allowed = [
      'nome_loja','whatsapp','saudacao',
      'horario_inicio','horario_fim',
      'bot_ativo','ignorar_horario','fallback_humano','delay_resposta',
      'business_type','city','state','delivery_info','payment_info',
      'instagram','site_url','catalog_url',
      'sales_tone','sales_instructions','return_policy','discount_rules',
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
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Products ──────────────────────────────────────────────────────────────────
router.get('/products', async (req, res) => {
  try {
    const { category, q } = req.query as { category?: string; q?: string };
    const data = await fetchProductsForPanel(req.storeId!, {
      category: category && category !== 'all' ? category : undefined,
      q:        q && q.trim() ? q.trim() : undefined,
    });
    res.json({ ok: true, data, count: data.length });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/products', async (req, res) => {
  try {
    const {
      name, sku, price, promotional_price, category, subcategory, product_type, color, sizes, image_url, is_active, featured, stock,
      item_type, description, price_type, bot_instructions, tags, qualification_questions,
      duration_minutes, requires_scheduling, service_location, included_items,
    } = req.body as Record<string, unknown>;
    if (!String(name || '').trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
    const resolvedItemType = item_type ? String(item_type) : 'produto_fisico';
    const isKit      = resolvedItemType === 'pacote_combo';
    const isPhysical = resolvedItemType === 'produto_fisico';

    // Normaliza sizes: aceita array (kit/produto) ou null
    let sizesValue: unknown = sizes || null;
    if (isKit && !sizesValue) sizesValue = [];

    const { data: rows, error } = await supabase
      .from('products')
      .insert({
        store_id:                req.storeId!,
        name:                    String(name).trim(),
        sku:                     sku ? String(sku).trim() : null,
        price:                   price != null ? Number(price) : null,
        promotional_price:       promotional_price ? Number(promotional_price) : null,
        category:                category ? String(category).trim() : null,
        subcategory:             subcategory ? String(subcategory).trim() : null,
        product_type:            product_type ? String(product_type).trim() : null,
        color:                   color ? String(color).trim() : null,
        sizes:                   sizesValue,
        image_url:               image_url ? String(image_url).trim() : null,
        is_active:               is_active !== false,
        featured:                featured === true,
        stock:                   isPhysical ? (Number(stock) || 0) : null,
        item_type:               resolvedItemType,
        description:             description ? String(description).trim() : null,
        price_type:              price_type ? String(price_type) : 'fixo',
        bot_instructions:        bot_instructions ? String(bot_instructions).trim() : null,
        tags:                    Array.isArray(tags) ? tags : null,
        qualification_questions: qualification_questions ?? null,
        duration_minutes:        duration_minutes ? Number(duration_minutes) : null,
        requires_scheduling:     requires_scheduling === true,
        service_location:        service_location ? String(service_location).trim() : null,
        included_items:          included_items ? String(included_items).trim() : null,
      })
      // Não usar .single() — kit pode ter triggers/views que retornam múltiplas linhas
      .select('id,store_id,name,sku,price,promotional_price,category,subcategory,product_type,color,sizes,image_url,is_active,featured,stock,item_type,description,price_type,bot_instructions,tags,qualification_questions,duration_minutes,requires_scheduling,service_location,included_items,created_at,updated_at');
    if (error) throw error;
    const product = Array.isArray(rows) ? rows[0] : null;
    if (!product) return res.status(500).json({ ok: false, error: 'Produto não retornado após criar.' });
    res.json({ ok: true, data: product });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const allowed = [
      'name','sku','price','promotional_price','category','subcategory','product_type','color','sizes','image_url','is_active','featured','stock',
      'item_type','description','price_type','bot_instructions','tags','qualification_questions',
      'duration_minutes','requires_scheduling','service_location','included_items',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ ok: false, error: 'Nenhum campo enviado' });

    // Não usar .single() — kit pode retornar múltiplas linhas em alguns schemas de produção
    const { data: rows, error } = await supabase
      .from('products')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!)
      .select('id,store_id,name,sku,price,promotional_price,category,subcategory,product_type,color,sizes,image_url,is_active,featured,stock,item_type,description,price_type,bot_instructions,tags,qualification_questions,duration_minutes,requires_scheduling,service_location,included_items,created_at,updated_at');
    if (error) throw error;
    const product = Array.isArray(rows) ? rows[0] : null;
    if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    res.json({ ok: true, data: product });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Leads CRM ─────────────────────────────────────────────────────────────────
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
  const validStages = ['novo','interessado','escolhendo','carrinho','pagamento','finalizado'];
  if (!stage || !validStages.includes(stage)) {
    return res.status(400).json({ ok: false, error: 'Stage inválido' });
  }
  try {
    const patch: Record<string, unknown> = { kanban_stage: stage, atualizado_em: new Date().toISOString() };
    if (stage === 'pagamento' || stage === 'carrinho') patch.status_comercial = 'QUENTE';
    else if (stage === 'interessado' || stage === 'escolhendo') patch.status_comercial = 'MORNO';
    else if (stage === 'finalizado') { patch.status = 'concluido'; patch.status_comercial = 'QUENTE'; }

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
router.get('/reports', async (req, res) => {
  try {
    const storeId = req.storeId!;
    const since7  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: msgs7 }, { data: leads7 }, { data: allLeads }] = await Promise.all([
      supabase.from('bot_mensagens').select('criado_em,direcao').eq('store_id', storeId).gte('criado_em', since7),
      supabase.from('bot_leads').select('criado_em').eq('store_id', storeId).gte('criado_em', since7),
      supabase.from('bot_leads').select('status').eq('store_id', storeId),
    ]);

    const labels: string[]  = [];
    const atendArr: number[] = [];
    const leadsArr: number[] = [];
    const daysOfWeek = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      labels.push(daysOfWeek[d.getDay()]);
      const day = d.toISOString().slice(0, 10);
      atendArr.push((msgs7 || []).filter(m => m.direcao === 'entrada' && m.criado_em?.startsWith(day)).length);
      leadsArr.push((leads7 || []).filter(l => l.criado_em?.startsWith(day)).length);
    }

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
        taxaResposta,
        peakHour: peakHour !== null ? `${peakHour}h` : '—',
        pctEncaminhados: pctEncam,
        totalMensagens: inbound,
      },
    });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Session takeover ──────────────────────────────────────────────────────────
router.post('/sessions/:phone/assume', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_sessions')
      .update({ humano_ativo: true })
      .eq('store_id', req.storeId!)
      .eq('phone', req.params.phone);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/sessions/:phone/release', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bot_sessions')
      .update({ humano_ativo: false })
      .eq('store_id', req.storeId!)
      .eq('phone', req.params.phone);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/sessions/:phone/message', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ ok: false, error: 'Mensagem obrigatória' });
  try {
    await saveMensagem({
      store_id: req.storeId!,
      phone:    req.params.phone,
      direcao:  'saida',
      conteudo: text.trim(),
      node:     'HUMANO',
    });
    // Envia via WhatsApp (best-effort — não falha a requisição se Evolution API não configurado)
    const sent = await sendMessage(req.params.phone, text.trim(), req.storeId!);
    res.json({ ok: true, whatsappSent: sent.ok, whatsappError: sent.error });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Webhook URL da loja ───────────────────────────────────────────────────────
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
router.get('/knowledge', async (req, res) => {
  try {
    const { getStoreKnowledge } = await import('../services/storeKnowledgeService');
    const kb = await getStoreKnowledge(req.storeId!);
    res.json({ ok: true, knowledge: kb });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Site scan — escaneia homepage da loja configurada ────────────────────────
router.post('/knowledge/site/scan', async (req, res) => {
  try {
    const settings = await getRuntimeSettings(req.storeId!);
    const siteUrl  = settings.site_url;
    if (!siteUrl) {
      return res.json({ ok: false, error: 'site_url não configurado. Defina em Configurações → Perfil da Loja.' });
    }
    const { scanSite }                       = await import('../services/siteScanService');
    const { updateSiteScan, clearKnowledgeCache } = await import('../services/storeKnowledgeService');
    const result = await scanSite(siteUrl);
    updateSiteScan(req.storeId!, result);
    clearKnowledgeCache(req.storeId!);
    // Persiste resumo no banco para sobreviver a deploys e cold starts
    await saveSettings(req.storeId!, {
      site_scan_summary: result.rawSummary.slice(0, 2000),
      site_scan_title:   result.title || '',
      site_scan_at:      result.scannedAt,
    });
    res.json({ ok: true, result });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Canais — status de todos os conectores ───────────────────────────────────
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
  const model       = process.env.AI_ASSIST_MODEL    || 'gemini-1.5-flash';
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

// ── Respostas Rápidas CRUD ────────────────────────────────────────────────────
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || (err.message ?? '').includes('does not exist');
}

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
router.get('/brain', async (req, res) => {
  try {
    const { data } = await supabase
      .from('store_brain')
      .select('*')
      .eq('store_id', req.storeId!)
      .single();
    res.json({ ok: true, data: data || null });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/brain/analyze', async (req, res) => {
  try {
    const result = await runStoreAnalysis(req.storeId!);
    res.json(result);
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/brain/cron', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .in('status', ['active', 'trial']);
    const results = [];
    for (const store of (stores || [])) {
      const result = await runStoreAnalysis(store.id);
      results.push({ storeId: store.id, ...result });
    }
    res.json({ ok: true, results });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.post('/brain/conversion', async (req, res) => {
  const { phone, type } = req.body as { phone?: string; type?: string };
  if (!phone) return res.status(400).json({ ok: false, error: 'phone obrigatório' });
  try {
    await recordConversion(req.storeId!, phone, (type as 'bot_converted' | 'human_converted') || 'bot_converted');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── WhatsApp (Baileys) ────────────────────────────────────────────────────────
// Baileys requer processo Node.js persistente — não funciona em Vercel serverless.
// O stub retorna 'unavailable' para o painel mostrar mensagem clara ao invés de quebrar.
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

// ── Backfill: cria leads para conversas existentes sem lead no CRM ─────────
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
        status:           'novo',
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
