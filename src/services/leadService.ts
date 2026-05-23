import { supabase } from '../lib/supabase';
import { BotLead } from '../types';

export async function registerLead(lead: Omit<BotLead, 'id' | 'qualificado_em'>): Promise<void> {
  const { error } = await supabase
    .from('bot_leads')
    .upsert(
      [{
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
        context:          lead.context || {},
        atualizado_em:    new Date().toISOString(),
      }],
      { onConflict: 'phone' },
    );

  if (error) console.warn('[leadService] erro ao salvar lead:', error.message);
}

export async function fetchLeads(status?: string): Promise<BotLead[]> {
  let query = supabase.from('bot_leads').select('*').order('atualizado_em', { ascending: false, nullsFirst: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as BotLead[];
}

export async function fetchLeadsPorStatusComercial(statusComercial: string): Promise<BotLead[]> {
  const { data, error } = await supabase
    .from('bot_leads')
    .select('*')
    .eq('status_comercial', statusComercial)
    .order('atualizado_em', { ascending: false });
  if (error) throw error;
  return (data || []) as BotLead[];
}

export async function updateLeadStatus(phone: string, status: BotLead['status']): Promise<void> {
  const { error } = await supabase
    .from('bot_leads')
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq('phone', phone);
  if (error) throw error;
}
