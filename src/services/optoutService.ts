import { supabase } from '../lib/supabase';

export async function isOptedOut(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('bot_optouts')
    .select('phone')
    .eq('phone', phone)
    .maybeSingle();
  return !!data;
}

export async function registerOptOut(phone: string): Promise<void> {
  await supabase
    .from('bot_optouts')
    .upsert([{ phone }], { onConflict: 'phone' });

  // Remove dados do lead e reinicia sessão (LGPD)
  await Promise.all([
    supabase.from('bot_leads').delete().eq('phone', phone),
    supabase
      .from('bot_sessions')
      .update({ current_node: 'INICIO', context: {}, atualizado_em: new Date().toISOString() })
      .eq('phone', phone),
  ]);
}

export async function removeOptOut(phone: string): Promise<void> {
  await supabase.from('bot_optouts').delete().eq('phone', phone);
}
