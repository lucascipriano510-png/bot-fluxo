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

router.get('/health', (_req, res) => {
  const s = getWaState();
  res.json({ status: 'ok', whatsapp: s.status, timestamp: new Date().toISOString() });
});

// ── Config pública (sem auth) — bootstrapa o cliente Supabase no frontend ────
router.get('/config', (_req, res) => {
  res.json({
    supabaseUrl:      process.env.SUPABASE_URL,
    supabaseAnonKey:  process.env.SUPABASE_ANON_KEY || '',
    renderUrl:        (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '') || null,
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

export default router;
