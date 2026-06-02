import { supabase } from '../lib/supabase';
import { BotLead } from '../types';

export async function registerLead(lead: Omit<BotLead, 'id' | 'qualificado_em'>): Promise<void> {
  const { error } = await supabase
    .from('bot_leads')
    .upsert(
      [{
        store_id:         lead.store_id,
        phone:            lead.phone,
        nome:             lead.nome,
        interesse:        lead.interesse,
        origem:           lead.origem,
        tamanho:          lead.tamanho,
        estilo:           lead.estilo,
        cidade:           lead.cidade,
        status_comercial: lead.status_comercial || 'MORNO',
        proxima_acao:     lead.proxima_acao,
        valor_potencial:  lead.valor_potencial,
        status:           lead.status || 'qualificado',
        kanban_stage:     lead.kanban_stage || (lead.status_comercial === 'QUENTE' ? 'interessado' : 'novo'),
        context:          lead.context || {},
        atualizado_em:    new Date().toISOString(),
      }],
      { onConflict: 'store_id,phone' },
    );

  if (error) console.warn('[leadService] erro ao salvar lead:', error.message);
}

// Cria ou atualiza lead de forma incremental — não exige funil completo.
export async function upsertLeadLight(params: {
  store_id: string;
  phone: string;
  nome?: string;
  interesse?: string;
  cidade?: string;
  tamanho?: string;
  valor_potencial?: number;
  status_comercial?: 'QUENTE' | 'MORNO' | 'FRIO';
  stage_hint?: string;
  context?: Record<string, string>;
}): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('bot_leads')
      .select('id, kanban_stage, status, interesse, nome, cidade, valor_potencial, status_comercial')
      .eq('store_id', params.store_id)
      .eq('phone', params.phone)
      .maybeSingle();

    const STAGE_ORDER = ['novo', 'interessado', 'escolhendo', 'carrinho', 'pagamento', 'finalizado'];
    const currentStageIdx = existing?.kanban_stage ? STAGE_ORDER.indexOf(existing.kanban_stage) : -1;
    const hintIdx = params.stage_hint ? STAGE_ORDER.indexOf(params.stage_hint) : 0;
    const newStage = STAGE_ORDER[Math.max(currentStageIdx, hintIdx, 0)];

    if (existing?.status === 'concluido') return;

    const payload = {
      store_id:            params.store_id,
      phone:               params.phone,
      nome:                params.nome      || existing?.nome      || null,
      interesse:           params.interesse || existing?.interesse || null,
      cidade:              params.cidade    || existing?.cidade    || null,
      tamanho:             params.tamanho   || null,
      valor_potencial:     params.valor_potencial || existing?.valor_potencial || null,
      status_comercial:    params.status_comercial || existing?.status_comercial || 'FRIO',
      kanban_stage:        newStage,
      status:              'em_conversa',
      last_interaction_at: new Date().toISOString(),
      context:             params.context || null,
      atualizado_em:       new Date().toISOString(),
    };

    if (existing?.id) {
      await supabase.from('bot_leads').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('bot_leads').insert({
        ...payload,
        first_contact_at: new Date().toISOString(),
        qualificado_em:   new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[leadService] upsertLeadLight error:', err);
  }
}

export async function fetchLeads(storeId: string, status?: string): Promise<BotLead[]> {
  let query = supabase
    .from('bot_leads')
    .select('*')
    .eq('store_id', storeId)
    .order('atualizado_em', { ascending: false, nullsFirst: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as BotLead[];
}

export async function fetchLeadsPorStatusComercial(
  storeId: string,
  statusComercial: string,
): Promise<BotLead[]> {
  const { data, error } = await supabase
    .from('bot_leads')
    .select('*')
    .eq('store_id', storeId)
    .eq('status_comercial', statusComercial)
    .order('atualizado_em', { ascending: false });
  if (error) throw error;
  return (data || []) as BotLead[];
}

export async function updateLeadStatus(
  storeId: string,
  phone: string,
  status: BotLead['status'],
): Promise<void> {
  const { error } = await supabase
    .from('bot_leads')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('store_id', storeId)
    .eq('phone', phone);
  if (error) throw error;
}
