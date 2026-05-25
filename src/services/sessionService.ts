import { supabase } from '../lib/supabase';
import { BotSession } from '../types';

// Sessão inativa por mais de SESSION_TIMEOUT_MINUTES volta ao INICIO automaticamente
const SESSION_TIMEOUT_MIN = Number(process.env.SESSION_TIMEOUT_MINUTES ?? 60);

export async function getOrCreateSession(phone: string): Promise<BotSession> {
  const { data, error } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    // Verifica timeout de inatividade
    if (data.current_node !== 'INICIO' && data.atualizado_em) {
      const elapsedMin = (Date.now() - new Date(data.atualizado_em).getTime()) / 60_000;
      if (elapsedMin > SESSION_TIMEOUT_MIN) {
        const { error: resetErr } = await supabase
          .from('bot_sessions')
          .update({ current_node: 'INICIO', context: {}, atualizado_em: new Date().toISOString() })
          .eq('phone', phone);
        if (resetErr) throw resetErr;
        return { ...data as BotSession, current_node: 'INICIO', context: {} };
      }
    }
    return data as BotSession;
  }

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
