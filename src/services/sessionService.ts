import { supabase } from '../lib/supabase';
import { BotSession } from '../types';

export async function getOrCreateSession(phone: string): Promise<BotSession> {
  const { data, error } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;

  if (data) return data as BotSession;

  const { data: created, error: createErr } = await supabase
    .from('bot_sessions')
    .insert([{ phone, current_node: 'INICIO', context: {} }])
    .select()
    .single();

  if (createErr) throw createErr;
  return created as BotSession;
}

export async function updateSession(
  phone: string,
  nextNode: string,
  context: Record<string, string>,
): Promise<void> {
  const { error } = await supabase
    .from('bot_sessions')
    .update({
      current_node: nextNode,
      context,
      atualizado_em: new Date().toISOString(),
    })
    .eq('phone', phone);

  if (error) throw error;
}

export async function resetSession(phone: string): Promise<void> {
  const { error } = await supabase
    .from('bot_sessions')
    .update({ current_node: 'INICIO', context: {}, atualizado_em: new Date().toISOString() })
    .eq('phone', phone);

  if (error) throw error;
}
