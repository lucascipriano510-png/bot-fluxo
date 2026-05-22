import { supabase } from '../lib/supabase';
import { BotLead } from '../types';

export async function registerLead(lead: Omit<BotLead, 'id' | 'qualificado_em'>): Promise<void> {
  // Upsert por telefone: atualiza se já existir
  const { error } = await supabase
    .from('bot_leads')
    .upsert(
      [{
        phone: lead.phone,
        nome: lead.nome,
        interesse: lead.interesse,
        valor_potencial: lead.valor_potencial,
        status: lead.status || 'qualificado',
        context: lead.context || {},
      }],
      { onConflict: 'phone' },
    );

  if (error) console.warn('[leadService] erro ao salvar lead:', error.message);
}

export async function fetchLeads(status?: string): Promise<BotLead[]> {
  let query = supabase.from('bot_leads').select('*').order('qualificado_em', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as BotLead[];
}

export async function updateLeadStatus(phone: string, status: BotLead['status']): Promise<void> {
  const { error } = await supabase
    .from('bot_leads')
    .update({ status })
    .eq('phone', phone);
  if (error) throw error;
}
