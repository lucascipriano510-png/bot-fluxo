import { supabase } from '../lib/supabase';
import { BotMensagem } from '../types';

export async function saveMensagem(msg: Omit<BotMensagem, 'id' | 'criado_em'>): Promise<void> {
  const { error } = await supabase.from('bot_mensagens').insert([msg]);
  if (error) console.warn('[mensagemService] erro ao salvar mensagem:', error.message);
}

export async function fetchHistorico(phone: string, limit = 20): Promise<BotMensagem[]> {
  const { data, error } = await supabase
    .from('bot_mensagens')
    .select('*')
    .eq('phone', phone)
    .order('criado_em', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).reverse() as BotMensagem[];
}
